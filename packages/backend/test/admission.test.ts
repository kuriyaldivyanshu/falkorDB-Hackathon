import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ThreadlineError, type AcceptedAuthority, type GoalAdmissionInput } from '@threadline/shared';
import type { Graph } from 'falkordb';
import { readAdmissionByRequestId } from '../src/domain/admission.js';
import { sha256Hex } from '../src/storage/digest.js';
import type { GraphStore } from '../src/storage/graph.js';
import type { AuthenticatedPrincipal } from '../src/storage/identity.js';
import { sqlDouble } from './sql-double.js';

function admissionHarness(options: {failure?:Error;committed?:boolean;resolveFails?:boolean}) {
  const projectId=randomUUID(),graphEpoch=randomUUID(),requestId=randomUUID(),sourceId=randomUUID();
  const now=new Date();
  const input: GoalAdmissionInput = {projectId,requestId,fixtureId:'test',goalText:'authored goal',
    requirements:[{field:'max_age_seconds',type:'integer',value:600,minimum:0,maximum:3600,revision:1}],
    criteria:[{kind:'assertion',ref:'case',text:'authored criterion',required:true,expectedExitCode:0}]};
  const authority: AcceptedAuthority = {projectId,graphEpoch,goalId:randomUUID(),goalVersionId:randomUUID(),goalRevision:1,
    taskId:randomUUID(),taskStateId:randomUUID(),taskRevision:1,taskStatus:'ready',requirementRevision:1,
    constraints:[{constraintId:randomUUID(),versionId:randomUUID(),sourceId:randomUUID(),revision:1,field:'max_age_seconds',value:600}],
    criteria:[{criterionId:randomUUID(),ref:'case',text:'authored criterion',required:true}]};
  const inbox = {id:randomUUID(),request_id:requestId,request_digest:'digest',operation:'task.accept_goal',
    payload:{input,params:{},authority,sourceMessageId:sourceId},status:'pending',graph_epoch:graphEpoch,
    source_message_id:sourceId,graph_receipt_id:null,graph_event_seq:null,created_at:now,settled_at:null};
  const db=sqlDouble(text=>{
    if(text.includes('FROM threadline.projects p')) return [{project_id:projectId,graph_key:'graph',graph_epoch:graphEpoch,slug:'project',role:'owner'}];
    if(text.includes('FROM threadline.project_messages')) return [{body:input.goalText,body_digest:sha256Hex(input.goalText)}];
    if(text.includes('FROM threadline.command_inbox') || text.includes('UPDATE threadline.command_inbox')) return [inbox];
    if(text.includes('INSERT INTO threadline.graph_event_projection') || text.includes('INSERT INTO threadline.audit_events')) return [];
    assert.fail(`Unexpected admission statement: ${text}`);
  });
  let reads=0,writes=0;
  const graph = {
    roQuery:async()=>{
      reads+=1;
      if(reads===2 && options.resolveFails) throw new Error('connection lost while resolving');
      return {data:reads===2 && options.committed ? [{receipt_id:randomUUID(),request_digest:'digest',
        result_json:JSON.stringify(authority),event_seq:1,event_id:randomUUID(),event_kind:'goal.admitted',
        aggregate_id:authority.taskId,payload_json:'{}',payload_digest:sha256Hex('{}')}] : []};
    },
    query:async()=>{writes+=1;if(options.failure)throw options.failure;return {data:[]};},
  } as unknown as Graph;
  const graphs={graph:()=>graph} as unknown as GraphStore;
  const principal:AuthenticatedPrincipal={tenantId:randomUUID(),userId:randomUUID(),sessionId:randomUUID(),
    displayName:'test',tenantSlug:'test',expiresAt:now,idleExpiresAt:now};
  return {
    run:()=>readAdmissionByRequestId({db,graphs,clock:()=>now},principal,projectId,requestId),
    counts:()=>({reads,writes}),
  };
}

for(const failure of [
  Object.assign(new Error('connection reset'),{code:'ECONNRESET'}),
  Object.assign(new Error('deadline elapsed'),{name:'TimeoutError'}),
  Object.assign(new Error('cancelled'),{name:'AbortError'}),
  new Error('Query timed out'),
  new (class SocketClosedUnexpectedlyError extends Error {})(),
]) {
  test(`admission remains pending for ${failure.name}/${'code' in failure?failure.code:failure.message || failure.constructor.name}`,async()=>{
    const harness=admissionHarness({failure});
    assert.equal((await harness.run()).kind,'pending');
    assert.deepEqual(harness.counts(),{reads:2,writes:1});
  });
}

for(const failure of [new Error('Unique constraint violation'),new Error('Invalid Cypher syntax'),undefined]) {
  test(`admission conflicts after confirmed absence for ${failure?.message ?? 'guard no-op'}`,async()=>{
    const harness=admissionHarness({failure});
    await assert.rejects(harness.run,e=>e instanceof ThreadlineError && e.code==='authority_conflict');
    assert.deepEqual(harness.counts(),{reads:2,writes:1});
  });
}

test('admission remains pending if a deterministic failure cannot be resolved',async()=>{
  const harness=admissionHarness({failure:new Error('constraint violation'),resolveFails:true});
  assert.equal((await harness.run()).kind,'pending');
});

test('a committed receipt wins over a failed acknowledgement',async()=>{
  const harness=admissionHarness({failure:new Error('lost acknowledgement'),committed:true});
  assert.equal((await harness.run()).kind,'accepted');
  assert.deepEqual(harness.counts(),{reads:2,writes:1});
});
