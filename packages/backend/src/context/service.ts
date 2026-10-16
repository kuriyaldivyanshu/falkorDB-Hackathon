import {boundWorkingHistory,isMemoryItem} from '../runtime/history-window.js';
import {fromChatMessages} from '../provider/chat-completions.js';
import {fromAnthropicMessages} from '../provider/anthropic.js';
import type {ConversationItem} from '../provider/responses.js';
import { digestSeedTree } from '../workspace/candidate.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  CONTEXT_PACKET_KIND, CONTEXT_PACKET_SCHEMA_VERSION, PACKET_DEFAULT_TOKENS, PACKET_MAX_TOKENS,
  MAX_OPTIONAL_CANDIDATES, MAX_OPTIONAL_HOPS, MAX_ADVISORY_FAILURES, ThreadlineError,
  type AuthorityView, type CheckpointService, type ContextService, type ContextScope, type ContextPacketManifest,
  type ContextItem, type ContextOmission, type ContextRefreshResult, type ContextOccurrence, type OccurrenceLifecycle,
} from '@threadline/shared';
import type { SqlDatabase } from '../storage/pg.js';
import type { GraphStore } from '../storage/graph.js';
import type { ArtifactWriter } from '../storage/artifacts.js';
import { decideContextBudget,admitContextWire } from './budget.js';

/** Lossless compact encoding: shared Source bindings are carried once, not repeated. */
export function renderPacket(packet:ContextPacketManifest):string {
  const bindings:ContextItem['bindings'][number][]=[];
  const index=new Map<string,number>();
  const sourceIndex=(binding:ContextItem['bindings'][number])=>{
    const key=JSON.stringify(binding);const previous=index.get(key);if(previous!==undefined)return previous;
    const position=bindings.length;bindings.push(binding);index.set(key,position);return position;
  };
  const items=packet.items.map(i=>[i.kind,i.priority,i.mandatory,i.identity,i.representation,i.text??null,i.bindings.map(sourceIndex)]);
  return JSON.stringify({type:'threadline.current-memory',packetId:packet.packetId,graphEpoch:packet.graphEpoch,
    taskRevision:packet.taskRevision,requirementRevision:packet.requirementRevision,
    itemFields:['kind','priority','mandatory','identity','representation','text','sourceIndexes'],items,sources:bindings,omissions:packet.omissions});
}
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
interface PacketRow extends Record<string, unknown> { id: string; content_artifact_id: string; content_digest: string }
type ContextAuthority=Omit<AuthorityView,'taskRevision'|'requirementRevision'>&{taskRevision:string;requirementRevision:string};
interface Candidate { id: string; artifact_id: string; content_digest: string; outcome: string | null;
  tool_name: string | null; candidate_digest: string | null; environment_digest: string | null;
  requirement_revision: string | null; accepted_revision: number | null }

export function createContextService(deps: {
  db: SqlDatabase; graphs: GraphStore; artifacts: ArtifactWriter; checkpoints: CheckpointService;
  authorityFor(scope: ContextScope): Promise<AuthorityView>;
  clock(): Date;
}): ContextService {
  const rows = <T extends Record<string, unknown>>(scope: ContextScope, sql: string, args: readonly unknown[] = []) =>
    deps.db.withTenantTransaction(scope.tenantId, tx => tx.rows<T>(sql, args));
  const authorize = async (scope: ContextScope) => {
    const authority = await deps.authorityFor(scope);
    if (authority.taskId !== scope.taskId) throw new ThreadlineError('not_found', 'No task exists in this scope.');
    const exact=await deps.graphs.graph(authority.graphKey).roQuery<{task_revision:string;requirement_revision:string;state_id:string}>(
      `MATCH (p:ProjectRoot {id:$project_id}), (t:Entity:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState)
        WHERE p.graph_epoch=$epoch AND s.revision=t.current_revision AND s.status=t.current_status
        RETURN toString(t.current_revision) AS task_revision,toString(t.requirement_revision) AS requirement_revision,s.id AS state_id`,
      {params:{project_id:scope.projectId,task_id:scope.taskId,epoch:authority.graphEpoch}});
    const row=exact.data?.[0];
    if(exact.data?.length!==1||!row||row.requirement_revision!==String(authority.requirementRevision))throw new ThreadlineError('authority_conflict','Current governing authority changed during read.');
    return {...authority,taskRevision:row.task_revision,requirementRevision:row.requirement_revision,taskStateId:row.state_id};
  };
  const current = async (scope: ContextScope): Promise<ContextPacketManifest | null> => {
    const records = await rows<PacketRow>(scope, `SELECT id,content_artifact_id,trim(content_digest) AS content_digest
      FROM threadline.context_packets WHERE tenant_id=$1 AND project_id=$2 AND task_graph_id=$3 AND owner_user_id=$4
      ORDER BY created_at DESC,id DESC LIMIT 1`, [scope.tenantId,scope.projectId,scope.taskId,scope.userId]);
    const row=records[0]; if (!row) return null;
    const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,row.content_artifact_id);
    if(digest(bytes)!==row.content_digest) throw new ThreadlineError('authority_unavailable','Context artifact digest differs.');
    return JSON.parse(bytes.toString()) as ContextPacketManifest;
  };
  const unresolved = async (scope: ContextScope) => rows<{n:string}>(scope,`SELECT
    (SELECT count(*) FROM threadline.tool_executions e JOIN threadline.agent_sessions s ON s.tenant_id=e.tenant_id AND s.id=e.agent_session_id
     WHERE e.tenant_id=$1 AND e.project_id=$2 AND s.task_graph_id=$3 AND e.status IN ('running','unknown')) +
    (SELECT count(*) FROM threadline.model_requests m JOIN threadline.agent_sessions s ON s.tenant_id=m.tenant_id AND s.id=m.agent_session_id
     WHERE m.tenant_id=$1 AND m.project_id=$2 AND s.task_graph_id=$3 AND (m.status IN ('prepared','dispatched','streaming','unknown') OR EXISTS(SELECT 1 FROM threadline.usage_ledger u WHERE u.tenant_id=m.tenant_id AND u.project_id=m.project_id AND u.source_key=m.usage_source_key AND u.precision='unknown'))) AS n`,
    [scope.tenantId,scope.projectId,scope.taskId]);
  const candidateFor=async(scope:ContextScope)=>{
    const workspaces=await rows<{id:string;canonical_path:string}>(scope,`SELECT w.id,w.canonical_path FROM threadline.agent_sessions s
      JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
      JOIN threadline.workspace_registrations w ON w.tenant_id=s.tenant_id AND w.id=s.workspace_id
      JOIN threadline.worker_hosts h ON h.tenant_id=w.tenant_id AND h.id=w.host_id
      WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.task_graph_id=$3 AND r.initiated_by=$4 AND h.user_id=$4 AND h.revoked_at IS NULL
        AND w.status IN ('registered','active') ORDER BY s.created_at DESC LIMIT 1`,[scope.tenantId,scope.projectId,scope.taskId,scope.userId]);
    const workspace=workspaces[0];const snapshot=workspace?await digestSeedTree(workspace.canonical_path):null;
    return {workspace,snapshot};
  };
  const optional = async (scope: ContextScope, authority: ContextAuthority, includeHistorical=false,currentCandidate?:string|null): Promise<{items:ContextItem[];omissions:ContextOmission[]}> => {
    // Indexed task closure, at most three edges. Only admitted graph observations
    // with original project-visible artifact Sources are recall candidates.
    const reply=await deps.graphs.graph(authority.graphKey).roQuery<Candidate>(`
      MATCH (t:Entity:Task {id:$task_id})<-[:ATTEMPTS]-(a:Attempt)-[:EVIDENCED_BY]->(o:Observation)-[:SOURCED_FROM]->(s:Source)
      WHERE o.visibility='project' AND s.visibility='project' AND s.availability='available'
      RETURN o.id AS id,s.source_sql_id AS artifact_id,s.content_digest AS content_digest,
        o.outcome AS outcome,o.tool_name AS tool_name,o.candidate_digest AS candidate_digest,
        o.environment_digest AS environment_digest,toString(o.requirement_revision) AS requirement_revision,
        o.accepted_revision AS accepted_revision ORDER BY o.created_at_ms DESC,o.id LIMIT 65`, {params:{task_id:scope.taskId}});
    const candidates=reply.data ?? []; const items:ContextItem[]=[];const omissions:ContextOmission[]=[];
    const seen=new Set<string>();let failures=0;
    for(const row of candidates.slice(0,MAX_OPTIONAL_CANDIDATES)) {
      // No inferred cross-task compatibility: this MVP admits advice only inside
      // the task closure, with tool identity and current requirement bindings.
      const stale=row.requirement_revision!==authority.requirementRevision||!!(row.candidate_digest&&currentCandidate&&row.candidate_digest!==currentCandidate);
      if(!row.tool_name||stale&&!includeHistorical){omissions.push({kind:'advice',reason:'superseded',count:1});continue;}

      const key=`${scope.projectId}:${row.artifact_id}:${row.content_digest}`;
      if(seen.has(key)){omissions.push({kind:'advice',reason:'duplicate',count:1});continue;} seen.add(key);
      const failed=row.outcome==='failed'||row.outcome==='denied'||row.outcome==='unknown';
      if(failed&&!stale && failures>=MAX_ADVISORY_FAILURES){omissions.push({kind:'failure_episode',reason:'over_budget',count:1});continue;}
      const visible=await rows<{id:string}>(scope,`SELECT id FROM threadline.artifacts WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND visibility='project' AND status='available'`,[scope.tenantId,scope.projectId,row.artifact_id]);
      if(!visible[0]){omissions.push({kind:'advice',reason:'unavailable',count:1});continue;}
      let bytes:Buffer;try{bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,row.artifact_id);}catch{omissions.push({kind:'advice',reason:'unavailable',count:1});continue;}
      if(digest(bytes)!==row.content_digest){omissions.push({kind:'advice',reason:'unavailable',count:1});continue;}
      if(failed&&!stale)failures++;
      let observedRead:string|undefined;
      if(!failed&&!stale&&['workspace.read','workspace_read'].includes(row.tool_name)){
        try{const result=JSON.parse(bytes.toString());
          if(typeof result.path==='string'&&typeof result.digest==='string'&&/^[a-f0-9]{64}$/.test(result.digest))observedRead=JSON.stringify({path:result.path,observedFileDigest:result.digest,precondition:'Inspect the current file/digest before reuse; this observation is not completion proof.'});
        }catch{/* Unstructured success remains a bulk reference, never inferred advice. */}
      }
      items.push({kind:failed?'failure_episode':observedRead?'advice':'bulk_reference',priority:failed&&!stale?'P1':observedRead?'P2':'P3',mandatory:false,proofStatus:stale?'stale_proof':'compatible_advice',
        representation:failed||observedRead?'excerpt':'reference',identity:row.id,graphEpoch:authority.graphEpoch,
        inclusionReason:`Observed ${row.tool_name} ${row.outcome ?? 'outcome unknown'} in this task; advice only, never completion proof.`,
        bindings:[{sourceId:row.artifact_id,artifactId:row.artifact_id,contentDigest:row.content_digest,
          recordVersion:String(row.accepted_revision ?? '')}],
        ...(failed?{text:bytes.subarray(0,1024).toString('utf8')}:observedRead?{text:observedRead}:{}),tokenPrecision:'upper_bound'});
    }
    if(candidates.length>MAX_OPTIONAL_CANDIDATES)omissions.push({kind:'advice',reason:'over_budget',count:candidates.length-MAX_OPTIONAL_CANDIDATES,detail:'Candidate frontier bounded; further graph records were not enumerated.'});
    return {items,omissions};
  };
  const refresh = async (scope:ContextScope,input:{maxTokens?:number}={}):Promise<ContextRefreshResult> => {
    const a=await authorize(scope);
    const max=input.maxTokens??PACKET_DEFAULT_TOKENS;
    if(!Number.isSafeInteger(max)||max<1||max>PACKET_MAX_TOKENS)return {kind:'refused',replacedPrevious:false,refusal:{kind:'invalid',message:'Invalid packet token limit.'}};
    const items:ContextItem[]=[];const omissions:ContextOmission[]=[];
    const add=(kind:ContextItem['kind'],identity:string,text:string,priority:ContextItem['priority']='P0',mandatory=true,bindings:ContextItem['bindings']=[])=>items.push({kind,identity,text,priority,mandatory,representation:'exact',inclusionReason:mandatory?'Exact current governing authority; never similarity-ranked.':'Current sourced tactical state; prose remains attributed proposal.',
      graphEpoch:a.graphEpoch,revision:String(a.taskRevision),bindings,estimatedTokens:Buffer.byteLength(text),tokenPrecision:'upper_bound'});
    const sourceBindings=[a.goalSource,...a.constraintSources];
    const sourceMessageIds=[...new Set(sourceBindings.map(source=>source.sourceMessageId))];
    const messages=await rows<{id:string;body:string;body_digest:string}>(scope,`SELECT id,body,trim(body_digest) AS body_digest FROM threadline.project_messages
      WHERE tenant_id=$1 AND project_id=$2 AND id=ANY($3::uuid[]) AND (visibility='project' OR author_user_id=$4)`,[scope.tenantId,scope.projectId,sourceMessageIds,scope.userId]);
    if(messages.length!==sourceMessageIds.length)return {kind:'refused',replacedPrevious:false,refusal:{kind:'denied_source',message:'A required authority Source is unavailable.'}};
    const messagesById=new Map(messages.map(message=>[message.id,message]));
    for(const source of sourceBindings){
      const message=messagesById.get(source.sourceMessageId);
      if(!message||message.body_digest!==source.contentDigest||digest(message.body)!==source.contentDigest)
        return {kind:'refused',replacedPrevious:false,refusal:{kind:'denied_source',message:'An authority Source no longer matches its message.'}};
    }
    const contextBinding=(source:{sourceId:string;contentDigest:string;recordVersion:string})=>({sourceId:source.sourceId,contentDigest:source.contentDigest,recordVersion:source.recordVersion});
    add('goal',a.goalVersionId,a.goalText,'P0',true,[contextBinding(a.goalSource)]);
    for(const c of a.constraints){
      const source=a.constraintSources.find(binding=>binding.constraintId===c.constraintId);
      if(!source)return {kind:'refused',replacedPrevious:false,refusal:{kind:'denied_source',message:'A constraint Source is unavailable.'}};
      add('constraint',c.versionId,JSON.stringify(c),'P0',true,[contextBinding(source)]);
    }
    for(const c of a.criteria)add('criteria',c.criterionId,JSON.stringify(c),'P0',true,[contextBinding(a.goalSource)]);
    add('task_state',a.taskStateId,JSON.stringify({status:a.taskStatus,taskRevision:a.taskRevision,requirementRevision:a.requirementRevision}));
    const {workspace,snapshot}=await candidateFor(scope);
    add('candidate',workspace?.id??scope.taskId,JSON.stringify({candidateDigest:snapshot?.digest??null,
      fileCount:snapshot?.fileCount??null,environmentDigest:null,status:'Observed non-hidden registered candidate tree; not protected completion proof.'}));
    const effects=await rows<{id:string;status:string;input_artifact_id:string}>(scope,`SELECT e.id,e.status,e.input_artifact_id FROM threadline.tool_executions e
      JOIN threadline.agent_sessions s ON s.tenant_id=e.tenant_id AND s.id=e.agent_session_id
      WHERE e.tenant_id=$1 AND e.project_id=$2 AND s.task_graph_id=$3 AND e.status IN ('running','unknown') ORDER BY e.id`,[scope.tenantId,scope.projectId,scope.taskId]);
    for(const e of effects){
      const evidence=await deps.artifacts.find(scope.tenantId,scope.projectId,e.input_artifact_id);
      if(!evidence||evidence.status!=='available')return {kind:'refused',replacedPrevious:false,refusal:{kind:'missing_bytes',message:'Unresolved effect evidence is unavailable; reconcile without repeating the effect.'}};
      if(evidence.visibility!=='project')return {kind:'refused',replacedPrevious:false,refusal:{kind:'denied_source',message:'Private unresolved evidence cannot be propagated into model context.'}};
      await deps.artifacts.read(scope.tenantId,scope.projectId,e.input_artifact_id);
      add('unresolved_effect',e.id,JSON.stringify(e),'P0',true,[{sourceId:e.input_artifact_id,artifactId:e.input_artifact_id,contentDigest:evidence.contentDigest}]);
    }
    const state=await deps.checkpoints.inspect(scope);
    if(state.criticalCapturePending||state.freshness==='blocked')return {kind:'refused',replacedPrevious:false,refusal:{kind:'missing_bytes',message:'Checkpoint coverage is blocked; reconcile capture before building context.'}};
    if(state.pointer){
      const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,state.pointer.manifestArtifactId);
      add('checkpoint',state.pointer.checkpointSourceId,bytes.toString(),'P1',false,[{sourceId:state.pointer.checkpointSourceId,artifactId:state.pointer.manifestArtifactId,contentDigest:state.pointer.manifestDigest}]);
    }
    const packet:ContextPacketManifest={schemaVersion:CONTEXT_PACKET_SCHEMA_VERSION,packetKind:CONTEXT_PACKET_KIND,packetId:randomUUID(),tenantId:scope.tenantId,projectId:scope.projectId,taskId:scope.taskId,
      graphEpoch:a.graphEpoch,taskRevision:String(a.taskRevision),requirementRevision:String(a.requirementRevision),items,omissions,totalEstimatedTokens:0,totalTokenPrecision:'upper_bound',
      templateVersion:'threadline-context-v1',policyVersion:'task-closure-v1',createdAt:deps.clock().toISOString(),producerSessionId:scope.agentSessionId??null};
    // Measure the representation actually carried, not the original Source bytes.
    const cost=()=>Buffer.byteLength(renderPacket(packet));
    if(Buffer.byteLength(renderPacket({...packet,items:items.filter(i=>i.mandatory)}))>max)return {kind:'refused',replacedPrevious:false,refusal:{kind:'mandatory_overflow',message:'Exact mandatory authority exceeds packet capacity.'}};
    const selected=await optional(scope,a,false,snapshot?.digest);omissions.push(...selected.omissions);
    for(const i of selected.items.sort((x,y)=>x.priority.localeCompare(y.priority)))items.push(i);
    while(cost()>max){const at=items.findLastIndex(i=>!i.mandatory);if(at<0)return {kind:'refused',replacedPrevious:false,refusal:{kind:'mandatory_overflow',message:'Mandatory authority and omission metadata exceed capacity.'}};
      const [item]=items.splice(at,1);if(item) { const prior=omissions.find(o=>o.kind===item.kind&&o.reason==='over_budget'); if(prior){omissions.splice(omissions.indexOf(prior),1,{...prior,count:prior.count+1});}else omissions.push({kind:item.kind,reason:'over_budget',count:1}); }}
    const latest=await authorize(scope);
    if(latest.graphEpoch!==a.graphEpoch||latest.taskRevision!==a.taskRevision||latest.requirementRevision!==a.requirementRevision)return {kind:'refused',replacedPrevious:false,refusal:{kind:'stale_revision',message:'Authority changed during packet selection.'}};
    const prior=await current(scope);
    const identity=(p:ContextPacketManifest)=>JSON.stringify({items:p.items,omissions:p.omissions,epoch:p.graphEpoch,revision:p.taskRevision,requirement:p.requirementRevision});
    if(prior&&identity(prior)===identity(packet))return {kind:'unchanged',packetId:prior.packetId,manifest:prior,replacedPrevious:false};
    const final={...packet,totalEstimatedTokens:cost()};
    const bytes=Buffer.from(JSON.stringify(final));
    const artifact=await deps.artifacts.publish({tenantId:scope.tenantId,projectId:scope.projectId,id:randomUUID(),kind:'context_packet',bytes,visibility:'user',ownerUserId:scope.userId});
    const generation=await deps.graphs.graph(a.graphKey).roQuery<{generation:string}>('MATCH (p:ProjectRoot {id:$id}) RETURN toString(p.generation) AS generation',{params:{id:scope.projectId}});
    if(generation.data?.[0]?.generation===undefined)throw new ThreadlineError('authority_unavailable','Project generation is unavailable.');
    await rows(scope,`INSERT INTO threadline.context_packets(tenant_id,project_id,id,task_graph_id,graph_epoch,task_revision,requirement_revision,graph_generation,content_artifact_id,content_digest,token_count,count_precision,created_at,owner_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'estimated',$12,$13)`,[scope.tenantId,scope.projectId,final.packetId,scope.taskId,a.graphEpoch,a.taskRevision,a.requirementRevision,generation.data[0].generation,artifact.id,artifact.contentDigest,final.totalEstimatedTokens,final.createdAt,scope.userId]);
    return {kind:'refreshed',packetId:final.packetId,manifest:final,replacedPrevious:prior!==null};
  };
  const service:ContextService={
    refresh,
    async validateForAdmission(scope,packetId){
      const a=await authorize(scope);
      const packets=await rows<PacketRow>(scope,`SELECT id,content_artifact_id,trim(content_digest) AS content_digest FROM threadline.context_packets WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND task_graph_id=$4 AND owner_user_id=$5`,[scope.tenantId,scope.projectId,packetId,scope.taskId,scope.userId]);
      const row=packets[0];if(!row)throw new ThreadlineError('not_found','No packet exists in this scope.');
      const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,row.content_artifact_id);
      if(digest(bytes)!==row.content_digest)throw new ThreadlineError('authority_unavailable','Packet digest differs.');
      const packet=JSON.parse(bytes.toString()) as ContextPacketManifest;
      if(packet.graphEpoch!==a.graphEpoch||packet.taskRevision!==a.taskRevision||packet.requirementRevision!==a.requirementRevision)
        throw new ThreadlineError('authority_conflict','Reconstruct current context before journaling.',{reason:'context_refresh_required'});
      const candidate=await candidateFor(scope);const binding=packet.items.find(i=>i.kind==='candidate');
      if(!binding?.text||JSON.parse(binding.text).candidateDigest!==(candidate.snapshot?.digest??null))
        throw new ThreadlineError('authority_conflict','Candidate changed before context admission.');
      for(const item of packet.items)for(const source of item.bindings){
        if(!source.artifactId)continue; // Goal/constraint provenance was rechecked by authorityFor.
        const artifact=await deps.artifacts.find(scope.tenantId,scope.projectId,source.artifactId);
        if(!artifact||artifact.visibility!=='project'||artifact.status!=='available'||artifact.contentDigest!==source.contentDigest)
          throw new ThreadlineError('authority_conflict','Selected Source is unavailable or no longer publishable.');
        await deps.artifacts.read(scope.tenantId,scope.projectId,source.artifactId);
      }
      if(Number((await unresolved(scope))[0]?.n??0)>0)throw new ThreadlineError('authority_conflict','An unresolved effect blocks dependent inference.');
    },
    async inspect(scope){const a=await authorize(scope);const packet=await current(scope);
      if(packet&&(packet.graphEpoch!==a.graphEpoch||packet.taskRevision!==String(a.taskRevision)||packet.requirementRevision!==String(a.requirementRevision)))return {packet:null,omissions:[{kind:'task_state',reason:'superseded',count:1,detail:'Refresh required; staged packet is stale.'}]};
      const occurrence=packet?await rows<{id:string}>(scope,'SELECT id FROM threadline.context_deliveries WHERE tenant_id=$1 AND project_id=$2 AND context_packet_id=$3 ORDER BY created_at DESC LIMIT 1',[scope.tenantId,scope.projectId,packet.packetId]):[];
      const budgetRows=packet?await rows<{input_artifact_id:string;context_window:number}>(scope,`SELECT m.input_artifact_id,(p.settings->>'contextWindowTokens')::integer AS context_window FROM threadline.context_deliveries d
        JOIN threadline.model_requests m ON m.tenant_id=d.tenant_id AND m.id=d.attempt_id
        JOIN threadline.provider_profiles p ON p.tenant_id=m.tenant_id AND p.id=m.profile_id
        WHERE d.tenant_id=$1 AND d.project_id=$2 AND d.context_packet_id=$3 ORDER BY d.created_at DESC,d.id DESC LIMIT 1`,[scope.tenantId,scope.projectId,packet.packetId]):[];
      let budget;
      if(budgetRows[0]){
        const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,budgetRows[0].input_artifact_id);const wire=JSON.parse(bytes.toString());
        budget=admitContextWire(bytes.toString(),budgetRows[0].context_window,Number(wire.max_output_tokens??wire.max_tokens));
      }
      return {packet,omissions:packet?.omissions??[],currentOccurrenceId:occurrence[0]?.id??null,...(budget?{budget}:{})};},
    async compact(scope){await authorize(scope);
      const active=await rows<{id:string}>(scope,'SELECT id FROM threadline.runs WHERE tenant_id=$1 AND project_id=$2 AND finished_at IS NULL LIMIT 1',[scope.tenantId,scope.projectId]);
      if(Number((await unresolved(scope))[0]?.n??0)>0||active.length)return {kind:'refused',retainedTurns:0,droppedTurns:0,summaryModelCalls:0,refusal:{kind:'unresolved_effects',message:'Wait for the active run and resolve unknown provider/tool effects before compacting.'}};
      const attempts=await rows<{input_artifact_id:string;api:string}>(scope,`SELECT m.input_artifact_id,p.settings->>'api' AS api FROM threadline.model_requests m
        JOIN threadline.agent_sessions s ON s.tenant_id=m.tenant_id AND s.id=m.agent_session_id
        JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
        JOIN threadline.provider_profiles p ON p.tenant_id=m.tenant_id AND p.id=m.profile_id
        WHERE m.tenant_id=$1 AND m.project_id=$2 AND s.task_graph_id=$3 AND r.initiated_by=$4
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1`,[scope.tenantId,scope.projectId,scope.taskId,scope.userId]);
      let retained=0,dropped=0;
      if(attempts[0]){
        const source=attempts[0];const wire=JSON.parse((await deps.artifacts.read(scope.tenantId,scope.projectId,source.input_artifact_id)).toString());
        const history:ConversationItem[]=Array.isArray(wire.input)?wire.input:source.api==='anthropic-messages'?fromAnthropicMessages(wire.messages):fromChatMessages(wire.messages);
        const window=boundWorkingHistory(history);retained=window.retained;dropped=window.dropped;
      }
      const result=await refresh(scope);return result.kind==='refused'?{kind:'refused',retainedTurns:retained,droppedTurns:dropped,summaryModelCalls:0,refusal:result.refusal}:{kind:'compacted',packetId:result.packetId,retainedTurns:retained,droppedTurns:dropped,summaryModelCalls:0};},
    async search(scope,input){const a=await authorize(scope);if(typeof input.query!=='string'||!input.query.trim()||input.query.length>1000)throw new ThreadlineError('invalid_request','Search needs 1–1000 characters.');
      const candidate=await candidateFor(scope);const result=await optional(scope,a,true,candidate.snapshot?.digest);const limit=input.limit??10;if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw new ThreadlineError('invalid_request','Search limit is 1–30.');
      const words=input.query.toLowerCase().split(/\s+/).filter(Boolean);const matching=result.items.filter(i=>words.some(w=>(i.text+' '+i.inclusionReason).toLowerCase().includes(w))).sort((x,y)=>x.identity.localeCompare(y.identity));
      if(input.afterItemId&&!matching.some(i=>i.identity===input.afterItemId))throw new ThreadlineError('invalid_request','Search cursor is outside the bounded result set.');
      const start=input.afterItemId?matching.findIndex(i=>i.identity===input.afterItemId)+1:0;const page=matching.slice(start,start+limit);
      return {hits:page.map(i=>({itemId:i.identity,kind:i.kind,identity:i.identity,snippet:(i.text??i.inclusionReason).slice(0,1024),bindings:i.bindings,proofStatus:i.proofStatus??'compatible_advice' as const})),nextAfterItemId:start+limit<matching.length?page.at(-1)?.identity??null:null,truncated:start+limit<matching.length,scannedCandidates:Math.min(MAX_OPTIONAL_CANDIDATES,result.items.length+result.omissions.reduce((n,o)=>n+o.count,0)),limits:{maxHops:MAX_OPTIONAL_HOPS,maxCandidates:MAX_OPTIONAL_CANDIDATES}};},
    budget(input){return decideContextBudget(input,input.limitTokens);},
    async recordOccurrence(scope,o){const a=await authorize(scope);
      if(o.tenantId!==scope.tenantId||o.projectId!==scope.projectId||o.taskId!==scope.taskId)throw new ThreadlineError('unauthorized','Occurrence scope differs.');
      const previous=await rows<{occurrence_json:ContextOccurrence;agent_session_id:string}>(scope,`SELECT d.occurrence_json,d.agent_session_id FROM threadline.context_deliveries d JOIN threadline.context_packets p ON p.tenant_id=d.tenant_id AND p.id=d.context_packet_id
        WHERE d.tenant_id=$1 AND d.project_id=$2 AND d.context_packet_id=$3 AND d.attempt_id=$4 AND p.owner_user_id=$5`,[scope.tenantId,scope.projectId,o.packetId,o.attemptId,scope.userId]);
      if(previous[0]){
        const old=previous[0].occurrence_json;
        if(previous[0].agent_session_id!==scope.agentSessionId||old.logicalRequestId!==o.logicalRequestId||old.packetDigest!==o.packetDigest||old.attemptNo!==o.attemptNo)throw new ThreadlineError('authority_conflict','Context occurrence retry conflicts.');
        return old;
      }
      const packetRows=await rows<PacketRow>(scope,'SELECT id,content_artifact_id,trim(content_digest) AS content_digest FROM threadline.context_packets WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND owner_user_id=$4 AND graph_epoch=$5 AND task_revision=$6',[scope.tenantId,scope.projectId,o.packetId,scope.userId,a.graphEpoch,a.taskRevision]);
      const packetRow=packetRows[0];if(!packetRow||packetRow.content_digest!==o.packetDigest)throw new ThreadlineError('authority_conflict','Occurrence packet is stale or its digest differs.');
      if(!scope.agentSessionId)throw new ThreadlineError('invalid_request','A bound agent session is required.');
      const request=await rows<{id:string;input_artifact_id:string;api:string;attempt_no:number;logical_request_id:string}>(scope,`SELECT m.id,m.input_artifact_id,m.attempt_no,m.logical_request_id,p.settings->>'api' AS api FROM threadline.model_requests m JOIN threadline.agent_sessions s ON s.tenant_id=m.tenant_id AND s.id=m.agent_session_id
        JOIN threadline.provider_profiles p ON p.tenant_id=m.tenant_id AND p.id=m.profile_id
        WHERE m.tenant_id=$1 AND m.project_id=$2 AND m.id=$3 AND s.id=$4 AND s.task_graph_id=$5`,[scope.tenantId,scope.projectId,o.attemptId,scope.agentSessionId,scope.taskId]);
      if(!request[0]||request[0].attempt_no!==o.attemptNo||request[0].logical_request_id!==o.logicalRequestId)throw new ThreadlineError('authority_conflict','Occurrence has no matching journaled attempt.');
      const wire=JSON.parse((await deps.artifacts.read(scope.tenantId,scope.projectId,request[0].input_artifact_id)).toString());
      const conversation:ConversationItem[]=Array.isArray(wire.input)?wire.input:request[0].api==='anthropic-messages'?fromAnthropicMessages(wire.messages):fromChatMessages(wire.messages);
      const memory=conversation.filter(isMemoryItem);
      const expected=JSON.parse((await deps.artifacts.read(scope.tenantId,scope.projectId,packetRow.content_artifact_id)).toString()) as ContextPacketManifest;
      if(memory.length!==1||!memory[0]||!('role' in memory[0])||memory[0].content!==renderPacket(expected))throw new ThreadlineError('authority_conflict','Journaled input does not contain exactly this context packet.');
      const linked=await rows<{id:string}>(scope,`UPDATE threadline.model_requests SET context_packet_id=$1 WHERE tenant_id=$2 AND project_id=$3 AND id=$4 AND (context_packet_id IS NULL OR context_packet_id=$1) RETURNING id`,[o.packetId,scope.tenantId,scope.projectId,o.attemptId]);
      if(linked.length!==1)throw new ThreadlineError('authority_conflict','Model request is bound to another packet.');
      await rows(scope,`INSERT INTO threadline.context_deliveries(tenant_id,project_id,id,agent_session_id,context_packet_id,submission_id,attempt_id,status,lifecycle,occurrence_json)
        VALUES($1,$2,$3,$4,$5,$6,$6,'staged','journaled',$7::jsonb) ON CONFLICT(tenant_id,project_id,context_packet_id,attempt_id) DO NOTHING`,[scope.tenantId,scope.projectId,o.occurrenceId,scope.agentSessionId,o.packetId,o.attemptId,JSON.stringify(o)]);
      const stored=await rows<{occurrence_json:ContextOccurrence}>(scope,'SELECT occurrence_json FROM threadline.context_deliveries WHERE tenant_id=$1 AND project_id=$2 AND context_packet_id=$3 AND attempt_id=$4',[scope.tenantId,scope.projectId,o.packetId,o.attemptId]);return stored[0]!.occurrence_json;},
    async transitionOccurrence(scope,t){await authorize(scope);
      const lifecycleOrder:Record<OccurrenceLifecycle,number>={staged:0,journaled:1,dispatch_observed:2,outcome_unknown:3,terminal_observed:4};
      return deps.db.withTenantTransaction(scope.tenantId,async tx=>{const found=await tx.rows<{occurrence_json:ContextOccurrence;lifecycle:OccurrenceLifecycle;agent_session_id:string}>('SELECT occurrence_json,lifecycle,agent_session_id FROM threadline.context_deliveries WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',[scope.tenantId,scope.projectId,t.occurrenceId]);
        const row=found[0];if(!row||row.occurrence_json.taskId!==scope.taskId||row.agent_session_id!==scope.agentSessionId)throw new ThreadlineError('not_found','No context occurrence exists.');
        if(lifecycleOrder[t.lifecycle]>=lifecycleOrder[row.lifecycle])await tx.rows(`UPDATE threadline.context_deliveries SET lifecycle=$1,transition_json=$2::jsonb,status=$3,submitted_at=CASE WHEN $1='dispatch_observed' THEN now() ELSE submitted_at END WHERE tenant_id=$4 AND project_id=$5 AND id=$6`,[t.lifecycle,JSON.stringify(t),t.lifecycle==='outcome_unknown'?'unknown':t.lifecycle==='dispatch_observed'||t.lifecycle==='terminal_observed'?'submitted':'staged',scope.tenantId,scope.projectId,t.occurrenceId]);
        return row.occurrence_json;});},
  };return service;
}
