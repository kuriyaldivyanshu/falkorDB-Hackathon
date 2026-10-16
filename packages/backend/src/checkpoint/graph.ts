import { randomUUID } from 'node:crypto';
import type { CheckpointScope, CheckpointManifest } from '@threadline/shared';
import type { GraphStore } from '../storage/graph.js';
import type { StagedCheckpoint } from './store.js';
import type { AuthorityFacts } from './manifest.js';

/** The receipt lookup also handles an acknowledgement lost after the atomic write. */
export async function publishCheckpointGraph(deps: {graphs:GraphStore; graphKey:string; now:number},
  scope:CheckpointScope,row:StagedCheckpoint,manifest:CheckpointManifest,authority:AuthorityFacts,
  previousCheckpoint:string,receiptOnly=false):Promise<{state:'committed';eventSeq:string}|{state:'pending'|'ambiguous'|'refused'}> {
  const graph=deps.graphs.graph(deps.graphKey);
  try {
    const receipt=await graph.roQuery<{digest:string;epoch:string;task_id:string;result_json:string;seq:number}>(
      `MATCH (r:RequestReceipt {operation_id:$operation_id}) RETURN r.request_digest AS digest,
       r.graph_epoch AS epoch,r.task_id AS task_id,r.result_json AS result_json,r.event_seq AS seq`,
      {params:{operation_id:row.operation_id},TIMEOUT:2000});
    const prior=receipt.data?.[0];
    if (prior) {
      if (prior.digest!==row.manifest_digest || prior.epoch!==manifest.graph_epoch || prior.task_id!==scope.taskId)
        return {state:'refused'};
      return {state:'committed',eventSeq:String(prior.seq)};
    }
    if (receiptOnly) return {state:'pending'};
    const result=await graph.query<{seq:number}>(`
      MATCH (p:ProjectRoot {id:$project_id}), (t:Task {id:$task_id})-[old:CURRENT_STATE]->(s:TaskState)
      OPTIONAL MATCH (prior:RequestReceipt {operation_id:$operation_id})
      WITH p,t,s,old,prior
      WHERE prior IS NULL AND p.graph_epoch=$epoch AND p.status='ready'
        AND t.current_revision=$task_revision AND s.revision=t.current_revision
        AND t.requirement_revision=$requirement_revision AND coalesce(t.fence,0)=$fence
        AND coalesce(t.checkpoint_revision,'0')=$previous_checkpoint
      SET p.generation=p.generation+1,p.next_event_seq=p.next_event_seq+1,
          t.current_revision=t.current_revision+1,t.checkpoint_revision=$checkpoint_revision,
          t.checkpoint_source_id=$source_id
      DELETE old
      CREATE (t)-[:CURRENT_STATE {id:$state_edge,schema_version:1,created_at_ms:$now,producer_id:$session_id}]->
        (n:Entity:TaskState {id:$state_id,schema_version:1,created_at_ms:$now,producer_id:$session_id,
          visibility:'project',task_id:$task_id,revision:t.current_revision,status:s.status,
          requirement_revision:t.requirement_revision,fence:coalesce(t.fence,0),
          owner_session_id:s.owner_session_id,lease_expires_ms:s.lease_expires_ms,
          unresolved_effects:$unresolved,checkpoint_source_id:$source_id,checkpoint_revision:$checkpoint_revision})
        -[:CHECKPOINT_SOURCE {id:$source_edge,schema_version:1,created_at_ms:$now,producer_id:$session_id}]->
        (:Entity:Source {id:$source_id,schema_version:1,created_at_ms:$now,producer_id:$session_id,
          visibility:'project',source_kind:'checkpoint',source_sql_id:$source_id,
          content_digest:$digest,availability:'available'})
      CREATE (:Entity:Event {id:$event_id,schema_version:1,created_at_ms:$now,producer_id:$session_id,
        visibility:'project',graph_epoch:$epoch,seq:p.next_event_seq,kind:'task.checkpointed',aggregate_id:$task_id,
        request_id:$operation_id,payload_digest:$digest,payload_json:$payload,committed_at_ms:$now})
      CREATE (:Entity:RequestReceipt {id:$receipt_id,schema_version:1,created_at_ms:$now,producer_id:$session_id,
        graph_epoch:$epoch,operation_id:$operation_id,request_id:$operation_id,request_digest:$digest,
        task_id:$task_id,operation:'checkpoint.publish',event_seq:p.next_event_seq,result_json:$result,actor_id:$session_id})
      RETURN p.next_event_seq AS seq`,{params:{project_id:scope.projectId,task_id:scope.taskId,
        epoch:manifest.graph_epoch,operation_id:row.operation_id,task_revision:Number(BigInt(manifest.task_revision)-1n),
        requirement_revision:Number(manifest.requirement_revision),fence:authority.fence,
        previous_checkpoint:previousCheckpoint,checkpoint_revision:row.revision,
        source_id:row.checkpoint_source_id,session_id:row.producer_session_id,now:deps.now,
        state_edge:randomUUID(),state_id:randomUUID(),source_edge:randomUUID(),event_id:randomUUID(),receipt_id:randomUUID(),
        digest:row.manifest_digest,unresolved:manifest.unresolved_effects.length>0,
        payload:JSON.stringify({sourceId:row.checkpoint_source_id,revision:row.revision}),
        result:JSON.stringify({sourceId:row.checkpoint_source_id,revision:row.revision})},TIMEOUT:2000});
    const written=result.data?.[0];
    return written ? {state:'committed',eventSeq:String(written.seq)} : {state:'refused'};
  } catch { return {state:'ambiguous'}; }
}
