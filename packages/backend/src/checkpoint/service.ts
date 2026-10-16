import { createHash } from 'node:crypto';
import {
  CHECKPOINT_ROUTES, MAX_COVERAGE_STREAMS, RECOVERY_BATCH_EVENTS, RECOVERY_MAX_EVENTS,
  CHECKPOINT_FALLBACK_AFTER_EVENTS, ThreadlineError, isMeaningfulObservation, isUuid,
  type CheckpointManifest, type CheckpointScope, type CheckpointService, type CheckpointResult,
  type CheckpointSubmission, type CheckpointTrigger, type TacticalStateView, type MemoryEpisode,
} from '@threadline/shared';
import type { ArtifactWriter } from '../storage/artifacts.js';
import type { GraphStore } from '../storage/graph.js';
import { withTaskCheckpointLock, type SqlDatabase } from '../storage/pg.js';
import { canonicalDigest } from '../storage/digest.js';
import { requireActiveMember } from '../storage/capture.js';
import { buildManifest, coverageFromFrontier, mergePlanPatch, safeExpectedRevision, type AuthorityFacts } from './manifest.js';
import { createCheckpointStore, type StagedCheckpoint } from './store.js';
import { validateCheckpoint, validateMemoryEpisode } from './validate.js';
import { publishCheckpointGraph } from './graph.js';

export interface CheckpointServiceDeps {
  db:SqlDatabase; artifacts:ArtifactWriter; graphs:GraphStore; clock:()=>Date;
  authorityFor:(scope:CheckpointScope)=>Promise<{ok:true;authority:AuthorityFacts;
    unresolvedEffects:CheckpointManifest['unresolved_effects'];episodeSourceIds:readonly string[];
    pendingQuestionId:string|null}|{ok:false;reason:string}>;
  logger?:{log:(r:{level:'info'|'warn'|'error';message:string;fields?:Record<string,string|number|boolean>})=>void};
}
interface TailRow {agent_session_id:string;capture_seq:string;kind:string;payload:Record<string,unknown>;
  raw_artifact_id:string|null;output_artifact_id:string|null;input_artifact_id:string|null;status:string|null;tool_name:string|null;exit_code:number|null;candidate_digest:string|null;}

/** One service for HTTP, model tools and deterministic restart/trigger processing. */
export function createCheckpointService(deps:CheckpointServiceDeps) {
  const store=createCheckpointStore(deps);
  const authorize=async(scope:CheckpointScope)=>{
    await requireActiveMember(deps.db,scope.tenantId,scope.projectId,scope.userId);
    return deps.authorityFor(scope);
  };
  const keyFor=async(scope:CheckpointScope)=>{
    const p=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{graph_key:string}>(
      'SELECT graph_key FROM threadline.projects WHERE tenant_id=$1 AND id=$2',[scope.tenantId,scope.projectId]));
    if(!p[0]) throw new ThreadlineError('not_found','No such project.');return p[0].graph_key;
  };
  const openGap=async(scope:CheckpointScope)=>{
    const rows=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{agent_session_id:string;from_seq:string;to_seq:string|null}>(
      `SELECT g.agent_session_id,g.from_seq::text,g.to_seq::text FROM threadline.capture_gaps g
        JOIN threadline.agent_sessions s ON s.tenant_id=g.tenant_id AND s.id=g.agent_session_id
        WHERE g.tenant_id=$1 AND g.project_id=$2 AND s.task_graph_id=$3 AND g.status IN ('open','unrecoverable')
        ORDER BY g.created_at LIMIT 1`,[scope.tenantId,scope.projectId,scope.taskId]));
    const g=rows[0];return g?{sessionId:g.agent_session_id,fromSeq:g.from_seq,toSeq:g.to_seq??g.from_seq}:null;
  };
  const loadTail=async(scope:CheckpointScope,manifest:CheckpointManifest|null,batchSize=RECOVERY_BATCH_EVENTS)=>{
    const coverage=manifest?.covered_capture_positions??[];const result:TailRow[]=[];
    for(let offset=0;offset<=RECOVERY_MAX_EVENTS;offset+=batchSize){
      const page=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<TailRow>(
        `SELECT c.agent_session_id,c.capture_seq::text,c.kind,c.payload,c.raw_artifact_id,COALESCE(c.payload->>'outputArtifactId',e.output_artifact_id::text) AS output_artifact_id,
          e.input_artifact_id,e.status,e.tool_name,e.exit_code,trim(e.candidate_digest) AS candidate_digest
          FROM threadline.capture_events c JOIN threadline.agent_sessions s
            ON s.tenant_id=c.tenant_id AND s.id=c.agent_session_id
          LEFT JOIN threadline.tool_executions e ON e.tenant_id=c.tenant_id AND e.agent_session_id=c.agent_session_id
            AND e.runtime_call_id=c.payload->>'callId' AND c.kind='tool.result'
          WHERE c.tenant_id=$1 AND c.project_id=$2 AND s.task_graph_id=$3
            AND ($7::uuid IS NULL OR s.run_id=$7)
            AND c.capture_seq>COALESCE((SELECT (v->>'capture_seq')::bigint FROM jsonb_array_elements($4::jsonb) v
                WHERE v->>'session_id'=c.agent_session_id::text),0)
          ORDER BY c.agent_session_id,c.capture_seq LIMIT $5 OFFSET $6`,
        [scope.tenantId,scope.projectId,scope.taskId,JSON.stringify(coverage),Math.min(batchSize,RECOVERY_MAX_EVENTS+1-offset),offset,scope.runId??null]));
      result.push(...page);if(page.length<batchSize||result.length>RECOVERY_MAX_EVENTS)break;
    }return result;
  };
  const episodesFor=(scope:CheckpointScope,tail:TailRow[],requirementRevision:string):MemoryEpisode[]=>{
    const episodes:MemoryEpisode[]=[];
    for(const r of tail){
      const external=r.kind==='diagnostic.observation'||r.kind==='registered_command.observation';
      const source=external?r.raw_artifact_id:r.output_artifact_id;
      const status=r.payload['status']??r.status;
      const exit=external&&Number.isInteger(r.payload['exitCode'])?r.payload['exitCode'] as number:r.exit_code;
      const tool=typeof r.payload['toolName']==='string'?r.payload['toolName']:external?r.kind:r.tool_name;
      if((r.kind!=='tool.result'&&!external)||!source||!tool)continue;
      const observed=status==='succeeded'||external&&exit===0?'succeeded':status==='denied'?'denied':status==='unknown'?'unknown':status==='failed'||external&&exit!==null?'failed':'unknown';
      const value:MemoryEpisode={schema_version:1,task_id:scope.taskId,session_id:r.agent_session_id,
        source_id:source,capture_seq:r.capture_seq,tool_name:tool,command_id:r.kind==='registered_command.observation'&&typeof r.payload['commandId']==='string'?r.payload['commandId']:null,
        observed_outcome:observed,exit_code:exit,failure_signature:observed==='failed'||observed==='denied'?String(status??'nonzero_exit'):null,
        affected_paths:[],candidate_digest:r.candidate_digest,environment_digest:null,requirement_revision:requirementRevision,
        cause_status:'not-inferred',next_action:observed==='unknown'?'Reconcile the unresolved effect before dependent work.':''};
      if(validateMemoryEpisode(value).ok)episodes.push(value);
    }return episodes;
  };
  const critical=(r:TailRow)=>['failed','denied','unknown'].includes(String(r.payload['status']??r.status))||
    (r.kind==='diagnostic.observation'&&typeof r.payload['exitCode']==='number'&&r.payload['exitCode']!==0)||
    r.kind==='registered_command.observation'||r.payload['mutating']===true;
  const readEpisode=async(scope:CheckpointScope,id:string):Promise<MemoryEpisode|null>=>{
    try { const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,id);
      const value=validateMemoryEpisode(JSON.parse(bytes.toString('utf8')) as unknown);return value.ok?value.value:null;
    } catch {return null;}
  };
  const resultFor=(row:StagedCheckpoint,previous:Awaited<ReturnType<typeof store.currentPointer>>):CheckpointResult=>({
    state:row.graph_committed_at?'committed':row.publication_state,operationId:row.operation_id,
    revision:row.revision,manifestArtifactId:row.manifest_artifact_id,manifestDigest:row.manifest_digest,
    checkpointSourceId:row.checkpoint_source_id,previous});
  const publish=async(scope:CheckpointScope,row:StagedCheckpoint,authority:AuthorityFacts,receiptOnly=false):Promise<CheckpointResult>=>{
    const manifest=await store.manifestFor(scope,row.manifest_artifact_id);
    const previous=await store.currentPointer(scope);
    const graph=await publishCheckpointGraph({graphs:deps.graphs,graphKey:await keyFor(scope),now:deps.clock().getTime()},
      scope,row,manifest,authority,previous?.checkpointRevision??'0',receiptOnly);
    if(graph.state==='committed'){
      await store.markGraphCommitted(scope,row,graph.eventSeq,manifest);
      return {...resultFor(row,previous),state:'committed'};
    }
    if(graph.state==='refused') {
      await store.markRejected(scope,row,'Publication authority changed or receipt conflicted.');
      return {state:'rejected',operationId:row.operation_id,rejection:{kind:'stale_revision',
        currentRevision:previous?.checkpointRevision??'0',submittedRevision:row.revision},previous};
    }
    if(graph.state==='ambiguous')await store.markAmbiguous(scope,row);
    return {...resultFor(row,previous),state:graph.state};
  };
  const fingerprint=(s:CheckpointSubmission)=>canonicalDigest({
    progress:s.proposed?.progress??null,nextAction:s.proposed?.next_action??null,
    planPatch:(s.planPatch??[]).map(p=>({step_id:p.step_id,text:p.text??null,status:p.status??null})),
    pendingQuestionId:s.pendingQuestionId??null,baseRevision:s.baseRevision??null});

  const submit=async(scope:CheckpointScope,submission:CheckpointSubmission,automatic=false,lockHeld=false):Promise<CheckpointResult>=>{
    await requireActiveMember(deps.db,scope.tenantId,scope.projectId,scope.userId);
    const operationId=submission.operationId;
    if(!isUuid(operationId))return {state:'rejected',operationId,rejection:{kind:'invalid',field:'operationId',reason:'A stable UUID is required.'}};
    const work=async():Promise<CheckpointResult>=>{
      let resolved=await authorize(scope);
      if(!resolved.ok)return {state:'rejected',operationId,rejection:{kind:scope.runId?'unauthorized':'awaiting_run_binding',
        ...(scope.runId?{reason:resolved.reason}:{taskId:scope.taskId})} as CheckpointResult['rejection']};
      scope={...scope,runId:resolved.authority.runId,agentSessionId:resolved.authority.producerSessionId};
      const rows=await store.rows(scope);const previous=await store.currentPointer(scope);
      const existing=rows.find(r=>r.operation_id===operationId);
      if(existing){
        if(existing.submission_fingerprint!==fingerprint(submission))return {state:'rejected',operationId,
          rejection:{kind:'payload_conflict',operationId},previous};
        if(existing.publication_state==='rejected')return {state:'rejected',operationId,rejection:{kind:'stale_revision',currentRevision:previous?.checkpointRevision??'0',submittedRevision:existing.revision},previous};
        return existing.graph_committed_at?resultFor(existing,previous):publish(scope,existing,resolved.authority);
      }
      const pending=rows.find(r=>!r.graph_committed_at&&r.publication_state!=='rejected');
      if(pending){const reconciled=await publish(scope,pending,resolved.authority);
        if(reconciled.state!=='committed'&&reconciled.state!=='rejected')return {...reconciled,operationId,previous};
        resolved=await authorize(scope);if(!resolved.ok)throw new ThreadlineError('unauthorized',resolved.reason);}
      const pointer=await store.currentPointer(scope);const revision=pointer?.checkpointRevision??'0';
      let base:string|undefined;
      try{base=safeExpectedRevision(submission.baseRevision);}catch{return {state:'rejected',operationId,
        rejection:{kind:'invalid',field:'baseRevision',reason:'A canonical decimal revision is required.'},previous:pointer};}
      if(base!==undefined&&base!==revision)return {state:'rejected',operationId,
        rejection:{kind:'stale_revision',currentRevision:revision,submittedRevision:base},previous:pointer};
      const gap=await openGap(scope);
      if(gap)return {state:'rejected',operationId,rejection:{kind:'blocked_by_gap',fromSeq:gap.fromSeq,toSeq:gap.toSeq},previous:pointer};
      const before=await store.currentManifest(scope);const tail=await loadTail(scope,before);
      if(tail.length>RECOVERY_MAX_EVENTS)return {state:'rejected',operationId,
        rejection:{kind:'blocked_by_gap',fromSeq:'0',toSeq:String(tail.length)},previous:pointer};
      const frontiers=await store.frontiers(scope);
      if(frontiers.size>MAX_COVERAGE_STREAMS)return {state:'rejected',operationId,rejection:{kind:'stream_limit',limit:MAX_COVERAGE_STREAMS},previous:pointer};
      for(const observation of tail){
        if(BigInt(observation.capture_seq)>BigInt(frontiers.get(observation.agent_session_id)?.admittedThrough??'0'))continue;
        const refs=observation.payload['references'];
        const referenceIds=refs&&typeof refs==='object'?Object.entries(refs).filter(([k,v])=>k.endsWith('ArtifactId')&&typeof v==='string').map(([,v])=>v as string):[];
        const ids=[observation.raw_artifact_id,observation.output_artifact_id,observation.input_artifact_id,...referenceIds].filter((id):id is string=>typeof id==='string');
        for(const id of ids)try{await deps.artifacts.read(scope.tenantId,scope.projectId,id);}catch{
          return {state:'rejected',operationId,rejection:{kind:'sources_unavailable',sourceIds:[id]},previous:pointer};
        }
      }
      const episodes=episodesFor(scope,tail,resolved.authority.requirementRevision);
      // Only fully admitted, available observations may contribute narrative or evidence.
      const admitted=episodes.filter(e=>BigInt(e.capture_seq)<=BigInt(frontiers.get(e.session_id)?.admittedThrough??'0'));
      let plan=before?.tactical_plan??[];
      if(submission.planPatch){const merged=mergePlanPatch(plan,submission.planPatch);
        if(!merged.ok)return {state:'rejected',operationId,rejection:{kind:'invalid',field:'planPatch',reason:merged.rejection.kind},previous:pointer};plan=merged.plan;}
      const latest=admitted.at(-1);
      const progress=submission.proposed?.progress??(before?.progress&&before.progress!=='Task admitted; no terminal work outcome recorded.'?before.progress:latest?`${latest.tool_name}: ${latest.observed_outcome}`:'Task admitted; no terminal work outcome recorded.');
      const episodeIds:string[]=[];
      for(const episode of admitted){
        const token=createHash('sha256').update(JSON.stringify(episode)).digest('hex');
        const id=`${token.slice(0,8)}-${token.slice(8,12)}-5${token.slice(13,16)}-8${token.slice(17,20)}-${token.slice(20,32)}`;
        const artifact=await deps.artifacts.publish({tenantId:scope.tenantId,projectId:scope.projectId,id,
          kind:'episode',visibility:'project',bytes:Buffer.from(JSON.stringify(episode),'utf8')});
        episodeIds.push(artifact.id);
      }
      const sources=[...new Set([...(before?.episode_source_ids??[]),...episodeIds])];
      if(sources.length>80)return {state:'rejected',operationId,rejection:{kind:'invalid',field:'episode_source_ids',reason:'Evidence bound reached; reconciliation is required.'},previous:pointer};
      const required=[...sources,...resolved.unresolvedEffects.map(e=>e.source_id),...admitted.map(e=>e.source_id)];
      for(const id of required){try{
        const rows=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{visibility:string}>(
          'SELECT visibility FROM threadline.artifacts WHERE tenant_id=$1 AND project_id=$2 AND id=$3',
          [scope.tenantId,scope.projectId,id]));
        if(rows[0]?.visibility!=='project')throw new Error('visibility');
        await deps.artifacts.read(scope.tenantId,scope.projectId,id);
      }catch{return {state:'rejected',operationId,rejection:{kind:'sources_unavailable',sourceIds:[id]},previous:pointer};}}
      const manifest=buildManifest({authority:{...resolved.authority,taskRevision:String(BigInt(resolved.authority.taskRevision)+1n),producerKind:!automatic||before?.producer_kind==='agent_proposal'?'agent_proposal':'service'},
        coverage:coverageFromFrontier([...frontiers].map(([sessionId,f])=>({sessionId,captured:f.capturedThrough,admitted:f.admittedThrough}))),
        unresolvedEffects:resolved.unresolvedEffects,episodeSourceIds:sources,pendingQuestionId:resolved.pendingQuestionId??before?.pending_question_id??null,
        progress, nextAction:submission.proposed?.next_action??(latest?.next_action||before?.next_action||''),plan,
        checkpointRevision:String(BigInt(revision)+1n)});
      const checked=validateCheckpoint(manifest,{frontiers:Object.fromEntries(frontiers)});
      if(!checked.ok)return {state:'rejected',operationId,rejection:{kind:'invalid',field:checked.failures[0]?.field??'manifest',reason:checked.failures[0]?.reason??'Invalid manifest'},previous:pointer};
      const row=await store.stage(scope,manifest,operationId,fingerprint(submission),String(BigInt(rows[0]?.revision??'0')+1n));
      return publish(scope,row,resolved.authority);
    };
    return lockHeld?work():withTaskCheckpointLock(deps.db,scope.tenantId,scope.projectId,scope.taskId,work);
  };
  const stateFor=async(scope:CheckpointScope,batchSize=RECOVERY_BATCH_EVENTS):Promise<{view:TacticalStateView;tail:TailRow[]}>=>{
    const resolved=await authorize(scope);
    if(resolved.ok)scope={...scope,runId:resolved.authority.runId,agentSessionId:resolved.authority.producerSessionId};
    const pointer=await store.currentPointer(scope);
    const manifest=pointer?await store.manifestFor(scope,pointer.manifestArtifactId):null;
    const frontiers=await store.frontiers(scope);const gap=await openGap(scope);const rows=await store.rows(scope);
    const pending=[...frontiers].filter(([id,f])=>BigInt(f.capturedThrough)>BigInt(manifest?.covered_capture_positions.find(p=>p.session_id===id)?.capture_seq??'0'))
      .map(([id,f])=>({session_id:id,capture_seq:f.capturedThrough,graph_admitted_capture_seq:f.admittedThrough}));
    const tail=await loadTail(scope,manifest,batchSize);const overflow=tail.length>RECOVERY_MAX_EVENTS;
    const criticalCapturePending=tail.some(r=>critical(r)&&BigInt(r.capture_seq)>BigInt(frontiers.get(r.agent_session_id)?.admittedThrough??'0'));
    const unavailableSourceIds:string[]=[];
    for(const id of [...(manifest?.episode_source_ids??[]),...(manifest?.unresolved_effects.map(e=>e.source_id)??[])]){
      try{await deps.artifacts.read(scope.tenantId,scope.projectId,id);}catch{unavailableSourceIds.push(id);}
    }
    const replacement=rows.find(r=>!r.graph_committed_at&&r.publication_state!=='rejected');
    const freshness=gap||overflow||unavailableSourceIds.length?'blocked':!resolved.ok?'capture_pending':manifest&&(manifest.requirement_revision!==resolved.authority.requirementRevision||manifest.run_id!==resolved.authority.runId)?'stale':
      !manifest||tail.length||pending.length||rows.some(r=>!r.graph_committed_at&&r.publication_state!=='rejected')?'capture_pending':'ready';
    return {tail,view:{freshness,pointer,manifest,pendingCoverage:pending,blockingGap:gap,awaitingRunBinding:!resolved.ok,
      criticalCapturePending,unavailableSourceIds,recoveryOverflow:overflow,
      pendingReplacement:replacement?{revision:replacement.revision,publicationState:replacement.publication_state,operationId:replacement.operation_id}:null,
      episodes:[...(await Promise.all((manifest?.episode_source_ids??[]).map(id=>readEpisode(scope,id)))).filter((e):e is MemoryEpisode=>e!==null),
        ...episodesFor(scope,tail,resolved.ok?resolved.authority.requirementRevision:'0')].slice(-80)}};
  };
  const inspect=async(scope:CheckpointScope):Promise<TacticalStateView>=>(await stateFor(scope)).view;
  const evaluateTrigger=async(scope:CheckpointScope,trigger:CheckpointTrigger):Promise<CheckpointResult|null>=>{
    return withTaskCheckpointLock(deps.db,scope.tenantId,scope.projectId,scope.taskId,async()=>{
    const resolved=await authorize(scope);if(!resolved.ok)return null;
    const manifest=await store.currentManifest(scope);const tail=await loadTail(scope,manifest);
    const pending=(await store.rows(scope)).find(r=>!r.graph_committed_at&&r.publication_state!=='rejected');
    if(pending)return publish(scope,pending,resolved.authority);
    if(trigger==='task_admission'&&manifest?.run_id===resolved.authority.runId)return null;
    if(trigger==='accepted_requirement_change'&&manifest?.requirement_revision===resolved.authority.requirementRevision)return null;
    const frontiers=await store.frontiers(scope);
    if(tail.some(r=>critical(r)&&BigInt(r.capture_seq)>BigInt(frontiers.get(r.agent_session_id)?.admittedThrough??'0')))return null;
    const episodes=episodesFor(scope,tail,resolved.authority.requirementRevision);
    const meaningful=episodes.filter(e=>isMeaningfulObservation({outcome:e.observed_outcome,
      mutating:tail.find(r=>r.agent_session_id===e.session_id&&r.capture_seq===e.capture_seq)?.payload['mutating']===true,
      registeredCommand:e.command_id!==null,episodeSourceIds:e.observed_outcome==='succeeded'?[e.source_id]:[]}));
    if(trigger==='uncheckpointed_fallback'&&manifest&&manifest.run_id===resolved.authority.runId&&manifest.requirement_revision===resolved.authority.requirementRevision&&
      !meaningful.some(e=>e.observed_outcome!=='succeeded'||e.command_id!==null)&&!tail.some(r=>r.payload['mutating']===true||r.kind==='registered_command.observation')&&!tail.some(r=>r.kind==='model.output.complete'&&['failed','unknown','cancelled'].includes(String(r.payload['status'])))&&meaningful.length<CHECKPOINT_FALLBACK_AFTER_EVENTS)return null;
    // Deterministic intent identity: repeated polling of the same tail cannot create another checkpoint.
    const token=createHash('sha256').update(JSON.stringify([scope.taskId,trigger,resolved.authority.requirementRevision,
      [...(await store.frontiers(scope))].map(([id,f])=>[id,f.admittedThrough])])).digest('hex');
    const operationId=`${token.slice(0,8)}-${token.slice(8,12)}-4${token.slice(13,16)}-8${token.slice(17,20)}-${token.slice(20,32)}`;
    return submit(scope,{operationId},true,true);
    });
  };
  const recover:CheckpointService['recover']=async(scope,options)=>{
    if(options?.limit!==undefined&&(!Number.isInteger(options.limit)||options.limit<1||options.limit>RECOVERY_MAX_EVENTS))
      throw new ThreadlineError('invalid_request','Invalid recovery bound.');
    const resolvedScope=await authorize(scope);
    if(resolvedScope.ok)scope={...scope,runId:resolvedScope.authority.runId,agentSessionId:resolvedScope.authority.producerSessionId};
    const {view,tail}=await stateFor(scope,Math.min(options?.limit??RECOVERY_BATCH_EVENTS,RECOVERY_BATCH_EVENTS));
    if(view.blockingGap||tail.length>RECOVERY_MAX_EVENTS)return {state:'blocked',scanned:tail.length,episodes:0,published:null,
      blockedBy:{fromSeq:view.blockingGap?.fromSeq??'0',toSeq:view.blockingGap?.toSeq??String(tail.length),reason:'A capture gap or recovery overflow requires reconciliation.'}};
    const resolved=await authorize(scope);
    if(!resolved.ok)return {state:'no_change',scanned:tail.length,episodes:0,published:null,rejection:{kind:'awaiting_run_binding',taskId:scope.taskId}};
    const frontiers=await store.frontiers(scope);
    if(tail.some(r=>BigInt(r.capture_seq)>BigInt(frontiers.get(r.agent_session_id)?.admittedThrough??'0')))
      return {state:'blocked',scanned:tail.length,episodes:view.episodes.length,published:null,
        blockedBy:{fromSeq:'0',toSeq:String(tail.length),reason:'Capture admission or required bytes remain pending.'}};
    const pending=(await store.rows(scope)).some(r=>!r.graph_committed_at&&r.publication_state!=='rejected');
    if(!tail.length&&view.manifest&&!pending)return {state:'no_change',scanned:0,episodes:0,published:null};
    const published=await evaluateTrigger(scope,'planned_handoff');
    return {state:published?.state==='committed'?'recovered':'blocked',scanned:tail.length,episodes:view.episodes.length,published};
  };
  return {store,routes:CHECKPOINT_ROUTES,submit,inspect,recover,evaluateTrigger} satisfies CheckpointService&{store:typeof store;routes:typeof CHECKPOINT_ROUTES};
}
