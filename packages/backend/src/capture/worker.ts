import { randomUUID } from 'node:crypto';
import { ThreadlineError } from '@threadline/shared';
import type { SqlDatabase } from '../storage/pg.js';
import { createCaptureOutbox, DEVELOPMENT_OUTBOX_PROFILE } from '../storage/outbox.js';
import type { GraphProjectionSurface } from '../domain/services.js';
import type { Logger } from '../log.js';

/** One local-tenant delivery worker. Construction performs no work. */
export function createCaptureWorker(deps: {
  db: SqlDatabase; tenantId: string; graph: GraphProjectionSurface; clock: () => Date; logger: Logger;
}) {
  const owner = randomUUID();
  const outbox = createCaptureOutbox({ db: deps.db, tenantId: deps.tenantId, clock: deps.clock,
    deliver: deps.graph.deliverer, logger: deps.logger });
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const pass = async () => {
    // Recover only ambiguous deliveries, never digest conflicts or exhausted
    // no-effect retries. Receipt reconciliation never re-executes inference.
    const uncertain = await deps.db.withTenantTransaction(deps.tenantId, tx => tx.rows<{
      id: string; project_id: string; operation_id: string; source_key: string; request_digest: string; graph_key: string; graph_epoch: string; attempts: number;
    }>(`SELECT o.id,o.project_id,o.operation_id,o.request_digest,c.source_key,p.graph_key,o.graph_epoch,o.attempts
        FROM threadline.capture_outbox o JOIN threadline.capture_events c ON c.id=o.capture_event_id AND c.tenant_id=o.tenant_id
        JOIN threadline.projects p ON p.id=o.project_id AND p.tenant_id=o.tenant_id
        WHERE o.tenant_id=$1 AND o.status='quarantined' AND o.last_error_code IS DISTINCT FROM 'receipt_conflict'
        ORDER BY o.created_at LIMIT $2`, [deps.tenantId, DEVELOPMENT_OUTBOX_PROFILE.batchSize]));
    for (const row of uncertain) {
      const reconciled = await deps.graph.reconcile({ db:deps.db,admitter:deps.graph.admitter,graphKeyFor:async()=>row.graph_key },
        {tenantId:deps.tenantId,projectId:row.project_id,operationId:row.operation_id,sourceKey:row.source_key,requestDigest:row.request_digest.trim(),graphEpoch:row.graph_epoch});
      if (reconciled.state==='conflict') {
        await deps.db.withTenantTransaction(deps.tenantId,tx=>tx.rows(
          `UPDATE threadline.capture_outbox SET last_error_code='receipt_conflict' WHERE tenant_id=$1 AND id=$2 AND status='quarantined'`,[deps.tenantId,row.id]));
      }
      if (reconciled.state==='reconciled') {
        await deps.db.withTenantTransaction(deps.tenantId, tx => tx.rows(
          `UPDATE threadline.capture_outbox SET status='committed',graph_epoch=$3,graph_event_seq=$4,last_error_code=NULL
            WHERE tenant_id=$1 AND id=$2 AND status='quarantined'`,
          [deps.tenantId,row.id,row.graph_epoch,reconciled.graphEventSeq]));
      }
      if (reconciled.state==='unresolved' && row.attempts < DEVELOPMENT_OUTBOX_PROFILE.maxAttempts) {
        // Admission rechecks the receipt and increments attempts when claimed.
        // Retain that counter so ambiguous deliveries cannot retry forever.
        const backoff = DEVELOPMENT_OUTBOX_PROFILE.retryBackoffMs[Math.max(0,row.attempts-1)] ?? DEVELOPMENT_OUTBOX_PROFILE.pollMs;
        await deps.db.withTenantTransaction(deps.tenantId,tx=>tx.rows(
          `UPDATE threadline.capture_outbox SET status='pending',next_attempt_at=$3::timestamptz,
              lease_owner=NULL,lease_expires_at=NULL
            WHERE tenant_id=$1 AND id=$2 AND status='quarantined' AND attempts=$4
              AND last_error_code IS DISTINCT FROM 'receipt_conflict'`,
          [deps.tenantId,row.id,new Date(deps.clock().getTime()+backoff),row.attempts]));
      }
    }
    await outbox.drain(owner);
    const projects = await deps.db.withTenantTransaction(deps.tenantId, tx => tx.rows<{ id: string; graph_key: string }>(
      `SELECT id,graph_key FROM threadline.projects WHERE tenant_id=$1 AND status='ready' ORDER BY id LIMIT 100`, [deps.tenantId]));
    for (const project of projects) await deps.graph.projection.projectOnce(deps.tenantId,project.id,project.graph_key);
  };
  const runOnce = (): Promise<void> => {
    if (stopped) return Promise.reject(new ThreadlineError('service_unavailable','Capture worker is stopped.'));
    if (!inFlight) inFlight = pass().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    runOnce,
    start() {
      if (timer || stopped) return;
      const tick = () => { void runOnce().catch(() => deps.logger.log({ level: 'warn', message: 'Capture delivery is pending; worker will retry.' })); };
      timer = setInterval(tick, DEVELOPMENT_OUTBOX_PROFILE.pollMs);
      timer.unref(); tick();
    },
    status: outbox.status,
    async stop() {
      stopped = true; clearInterval(timer); timer = undefined;
      await outbox.stop();
      let bound: NodeJS.Timeout | undefined;
      try {
        await Promise.race([inFlight, new Promise<void>(resolve => { bound=setTimeout(resolve, 5000); })]);
      } finally { clearTimeout(bound); }
    },
  };
}
