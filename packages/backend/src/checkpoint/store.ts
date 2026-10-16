import { createHash, randomUUID } from 'node:crypto';
import { ThreadlineError, type CheckpointScope, type CheckpointManifest, type CheckpointPointerView, type DecimalSequence } from '@threadline/shared';
import type { ArtifactWriter } from '../storage/artifacts.js';
import type { SqlDatabase } from '../storage/pg.js';
import { validateCheckpoint, type FrontierInput } from './validate.js';

export interface StagedCheckpoint {
  revision: string; operation_id: string; manifest_artifact_id: string; manifest_digest: string;
  checkpoint_source_id: string; producer_session_id: string; covered_capture_seq: string;
  created_at: Date; publication_state: 'pending' | 'ambiguous' | 'committed' | 'rejected';
  submission_fingerprint: string; graph_committed_at: Date | null; graph_event_seq: string | null;
}

/** SQL records publication intent; only a graph receipt establishes commitment. */
export function createCheckpointStore(deps: { db: SqlDatabase; artifacts: ArtifactWriter; clock: () => Date }) {
  const rows = (scope: CheckpointScope) => deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<StagedCheckpoint>(
    `SELECT revision::text,operation_id,manifest_artifact_id,trim(manifest_digest) AS manifest_digest,
      checkpoint_source_id,producer_session_id,covered_capture_seq::text,created_at,publication_state,
      trim(submission_fingerprint) AS submission_fingerprint,graph_committed_at,graph_event_seq::text
      FROM threadline.task_checkpoints WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 ORDER BY revision DESC`,
    [scope.tenantId,scope.projectId,scope.taskId]));
  const pointer = (row: StagedCheckpoint): CheckpointPointerView => ({checkpointRevision:row.revision,
    manifestArtifactId:row.manifest_artifact_id,manifestDigest:row.manifest_digest,
    checkpointSourceId:row.checkpoint_source_id,producerSessionId:row.producer_session_id,
    coveredCaptureSeq:row.covered_capture_seq,publishedAt:row.created_at.toISOString()});
  const currentPointer = async (scope: CheckpointScope) => {
    const row=(await rows(scope)).find(r=>r.graph_committed_at!==null); return row ? pointer(row) : null;
  };
  const manifestFor = async (scope: CheckpointScope,artifactId: string): Promise<CheckpointManifest> => {
    const bytes=await deps.artifacts.read(scope.tenantId,scope.projectId,artifactId);
    const checked=validateCheckpoint(JSON.parse(bytes.toString('utf8')) as unknown);
    if (!checked.ok) throw new ThreadlineError('authority_unavailable','Stored checkpoint manifest is invalid.');
    return checked.value;
  };
  const frontiers = async (scope: CheckpointScope): Promise<Map<string,FrontierInput>> => {
    const result=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{
      agent_session_id:string; capture_seq:string; status:string|null; available:boolean;
    }>(`SELECT c.agent_session_id,c.capture_seq::text,o.status,
          NOT EXISTS (SELECT 1 FROM threadline.artifacts a WHERE a.tenant_id=c.tenant_id
            AND a.project_id=c.project_id AND (a.id=c.raw_artifact_id OR a.id::text=c.payload->>'outputArtifactId')
            AND a.status<>'available') AS available
        FROM threadline.capture_events c JOIN threadline.agent_sessions s
          ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id AND s.id=c.agent_session_id
        LEFT JOIN threadline.capture_outbox o ON o.tenant_id=c.tenant_id AND o.capture_event_id=c.id
        WHERE c.tenant_id=$1 AND c.project_id=$2 AND s.task_graph_id=$3 AND ($4::uuid IS NULL OR s.run_id=$4)
        ORDER BY c.agent_session_id,c.capture_seq`,[scope.tenantId,scope.projectId,scope.taskId,scope.runId??null]));
    const map=new Map<string,FrontierInput>(); const blocked=new Set<string>();
    for (const row of result) {
      const before=map.get(row.agent_session_id) ?? {capturedThrough:'0',admittedThrough:'0'};
      if (BigInt(row.capture_seq)!==BigInt(before.capturedThrough)+1n || row.status!=='committed' || !row.available)
        blocked.add(row.agent_session_id);
      map.set(row.agent_session_id,{capturedThrough:row.capture_seq,
        admittedThrough:blocked.has(row.agent_session_id)?before.admittedThrough:row.capture_seq});
    }
    const sessions=await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows<{id:string}>(
      `SELECT id FROM threadline.agent_sessions WHERE tenant_id=$1 AND project_id=$2 AND task_graph_id=$3
        AND ($4::uuid IS NULL OR run_id=$4) ORDER BY id`,[scope.tenantId,scope.projectId,scope.taskId,scope.runId??null]));
    for(const session of sessions)if(!map.has(session.id))map.set(session.id,{capturedThrough:'0',admittedThrough:'0'});
    return map;
  };
  return {
    rows,pointer,currentPointer,manifestFor,frontiers,
    async currentManifest(scope:CheckpointScope) { const p=await currentPointer(scope);return p ? manifestFor(scope,p.manifestArtifactId):null; },
    async stage(scope:CheckpointScope,manifest:CheckpointManifest,operationId:string,fingerprint:string,revision:DecimalSequence) {
      const bytes=Buffer.from(JSON.stringify(manifest),'utf8');
      const artifact=await deps.artifacts.publish({tenantId:scope.tenantId,projectId:scope.projectId,
        kind:'episode',id:randomUUID(),bytes,visibility:manifest.visibility});
      const covered=manifest.covered_capture_positions.find(p=>p.session_id===scope.agentSessionId)?.capture_seq ?? '0';
      await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows(
        `INSERT INTO threadline.task_checkpoints (tenant_id,project_id,task_id,revision,operation_id,
          manifest_artifact_id,manifest_digest,checkpoint_source_id,producer_session_id,requirement_revision,
          covered_capture_seq,graph_epoch,visibility,producer_kind,publication_state,submission_fingerprint,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$8,$9,$10,$11,$12,$13,'pending',$14,$15)`,
        [scope.tenantId,scope.projectId,scope.taskId,revision,operationId,artifact.id,artifact.contentDigest,
          scope.agentSessionId,manifest.requirement_revision,covered,manifest.graph_epoch,manifest.visibility,
          manifest.producer_kind,fingerprint,deps.clock()]));
      const row=(await rows(scope)).find(r=>r.operation_id===operationId);
      if (!row) throw new ThreadlineError('storage_unavailable','Checkpoint staging acknowledgement is missing.');
      return row;
    },
    async markGraphCommitted(scope:CheckpointScope,row:StagedCheckpoint,eventSeq:string,manifest:CheckpointManifest) {
      await deps.db.withTenantTransaction(scope.tenantId,async tx=>{
        await tx.rows(`UPDATE threadline.task_checkpoints SET publication_state='committed',graph_event_seq=$5,
          graph_committed_at=now(),resolved_at=now() WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND operation_id=$4`,
          [scope.tenantId,scope.projectId,scope.taskId,row.operation_id,eventSeq]);
        for (const p of manifest.covered_capture_positions) await tx.rows(
          `INSERT INTO threadline.checkpoint_coverage
            (tenant_id,project_id,task_id,session_id,covered_capture_seq,graph_admitted_capture_seq)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,project_id,task_id,session_id)
            DO UPDATE SET covered_capture_seq=GREATEST(checkpoint_coverage.covered_capture_seq,EXCLUDED.covered_capture_seq),
            graph_admitted_capture_seq=GREATEST(checkpoint_coverage.graph_admitted_capture_seq,EXCLUDED.graph_admitted_capture_seq),updated_at=now()`,
          [scope.tenantId,scope.projectId,scope.taskId,p.session_id,p.capture_seq,p.graph_admitted_capture_seq]);
      });
    },
    async markRejected(scope:CheckpointScope,row:StagedCheckpoint,reason:string) {
      await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows(
        `UPDATE threadline.task_checkpoints SET publication_state='rejected',rejection_reason=$5,resolved_at=now()
          WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND operation_id=$4 AND graph_committed_at IS NULL`,
        [scope.tenantId,scope.projectId,scope.taskId,row.operation_id,reason]));
    },
    async markAmbiguous(scope:CheckpointScope,row:StagedCheckpoint) {
      await deps.db.withTenantTransaction(scope.tenantId,tx=>tx.rows(
        `UPDATE threadline.task_checkpoints SET publication_state='ambiguous' WHERE tenant_id=$1 AND project_id=$2
          AND task_id=$3 AND operation_id=$4 AND graph_committed_at IS NULL`,
        [scope.tenantId,scope.projectId,scope.taskId,row.operation_id]));
    },
  };
}
export type CheckpointStore=ReturnType<typeof createCheckpointStore>;
export function manifestDigestOf(manifest:CheckpointManifest) {return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');}
