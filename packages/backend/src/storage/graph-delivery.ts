import type { GraphAdmitter } from './graph-admission.js';
import type { SqlDatabase } from './pg.js';
import { canonicalDigest } from './digest.js';

/**
 * The outbox deliverer, and the reconciliation that follows an ambiguous write.
 *
 * The whole point of this module is the difference between a *failure* and an
 * *ambiguity*. A graph write that reported an error may still have committed.
 * Retrying it blindly is how a duplicate Source appears, so:
 *
 * - a committed receipt for the same operation reconciles to that position;
 * - a receipt whose digest disagrees is a conflict and is never auto-resolved;
 * - only an absent receipt, where no effect can be established, permits a
 *   retry.
 *
 * Reconciliation is about *admitting evidence*. It never resends inference and
 * never re-executes a tool: those are effects, and an effect is never repeated
 * because its acknowledgement was lost.
 */

export interface GraphDelivererDeps {
  readonly db: SqlDatabase;
  readonly admitter: GraphAdmitter;
  /** Supplied by composition; the test fixture passes a fixed project graph. */
  readonly graphKeyFor: (tenantId: string, projectId: string) => Promise<string>;
  readonly logger?: { log: (record: { level: 'info' | 'warn' | 'error'; message: string; fields?: Record<string, string | number | boolean> }) => void };
}

export interface DeliveryContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly captureEventId: string;
  readonly sourceKey: string;
  readonly requestDigest: string;
  readonly agentSessionId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly graphEpoch: string;
  readonly operationId: string;
}

export type GraphDeliveryResult =
  | { readonly kind: 'committed'; readonly graphEventSeq: number }
  | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'ambiguous'; readonly code: string };

/**
 * Reads the capture row's correlation facts, so admission binds to what was
 * actually recorded rather than to whatever the caller happens to pass now.
 */
interface CorrelationFacts {
  readonly agent_session_id: string;
  readonly run_id: string;
  readonly task_graph_id: string;
  readonly project_id: string;
  readonly graph_epoch: string;
  readonly capture_seq: string;
  readonly raw_artifact_id: string | null;
  readonly payload_digest: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly observed_at: Date;
  readonly content_digest: string | null;
  readonly visibility: 'project' | 'user' | 'session' | null;
  readonly owner_user_id: string | null;
  readonly owner_session_id: string | null;
}

export function createGraphDeliverer(deps: GraphDelivererDeps) {
  return async (delivery: DeliveryContext): Promise<GraphDeliveryResult> => {
    const facts = await deps.db.withTenantTransaction(delivery.tenantId, (tx) =>
      tx.rows<CorrelationFacts>(
        `SELECT c.agent_session_id, s.run_id, s.task_graph_id, c.project_id,
                pj.graph_epoch, c.capture_seq::text, c.raw_artifact_id,
                trim(c.payload_digest) AS payload_digest, c.kind, c.payload, c.observed_at,
                trim(a.content_digest) AS content_digest, a.visibility, a.owner_user_id, a.owner_session_id
           FROM threadline.capture_events c
           JOIN threadline.agent_sessions s
             ON s.tenant_id = c.tenant_id AND s.id = c.agent_session_id
           JOIN threadline.projects pj ON pj.tenant_id = c.tenant_id AND pj.id = c.project_id
           LEFT JOIN threadline.artifacts a ON a.tenant_id=c.tenant_id AND a.project_id=c.project_id AND a.id=c.raw_artifact_id
          WHERE c.tenant_id = $1 AND c.project_id = $2 AND c.id = $3`,
        [delivery.tenantId, delivery.projectId, delivery.captureEventId],
      ),
    );
    const row = facts[0];
    if (row === undefined) {
      // The capture row is gone: nothing can be admitted, and nothing has been.
      return { kind: 'failed', code: 'capture_event_missing' };
    }

    if (row.payload_digest.trim() !== delivery.requestDigest.trim() || canonicalDigest(row.payload as never) !== row.payload_digest.trim())
      return {kind:'ambiguous',code:'receipt_conflict'};

    // A receipt already bound to this operation is the authority on whether the
    // write landed. It is consulted *before* any attempt to write again.
    const graphKey = await deps.graphKeyFor(delivery.tenantId, delivery.projectId);
    let receipt;
    try { receipt = await deps.admitter.findReceipt(delivery.tenantId,delivery.projectId,graphKey,delivery.operationId); }
    catch { return {kind:'failed',code:'graph_preflight_unavailable'}; }

    if (receipt !== null) {
      if (receipt.requestDigest !== delivery.requestDigest || receipt.graphEpoch !== (delivery.graphEpoch || row.graph_epoch))
        return { kind: 'ambiguous', code: 'receipt_conflict' };
      // A digest that disagrees means a different payload claimed this
      // operation id. That is a conflict, never a silent reconcile.
      return { kind: 'committed', graphEventSeq: receipt.eventSeq };
    }

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const result = await deps.admitter.admit({
      tenantId: delivery.tenantId,
      projectId: delivery.projectId,
      projectIdGraph: delivery.projectId,
      graphKey,
      graphEpoch: delivery.graphEpoch || row.graph_epoch,
      sourceKey: delivery.sourceKey,
      kind: row.kind,
      captureEventId: delivery.captureEventId,
      operationId: delivery.operationId,
      payloadDigest: row.payload_digest,
      agentSessionId: row.agent_session_id,
      runId: row.run_id,
      taskId: row.task_graph_id,
      captureSeq: Number(row.capture_seq),
      observedAt: row.observed_at.toISOString(),
      visibility: row.visibility ?? 'project', ownerUserId: row.owner_user_id, ownerSessionId: row.owner_session_id, payload,
      rawArtifactId: row.raw_artifact_id,
      rawContentDigest: row.content_digest,
      invocationId: readIfString(payload, 'callId') ?? readIfString(payload, 'invocationId'),
      toolName: readIfString(payload, 'toolName'),
      outcome: readIfString(payload, 'status') ?? readIfString(payload, 'outcome'),
      exitCode: readIfNumber(payload, 'exitCode'),
      candidateDigest: readIfString(payload, 'candidateDigest'),
      environmentDigest: readIfString(payload, 'environmentDigest'),
      acceptedRevision: readIfNumber((payload['correlation'] ?? {}) as Record<string, unknown>, 'acceptedRevision'),
      requirementRevision: readIfNumber((payload['correlation'] ?? {}) as Record<string, unknown>, 'requirementRevision'),
      completeVisibleOutput: readIfBoolean(payload, 'complete'),
    });

    if (result.kind === 'committed') {
      return { kind: 'committed', graphEventSeq: result.admission.eventSeq };
    }
    return result;
  };
}

/**
 * Reconciles one quarantined delivery against its receipt.
 *
 * Returns what the operator should be told, never a retry instruction on its
 * own: only an absent receipt with no established effect permits another
 * attempt, and even then the caller decides.
 */
export async function reconcileQuarantined(
  deps: { readonly db: SqlDatabase; readonly admitter: GraphAdmitter; readonly graphKeyFor: (t: string, p: string) => Promise<string> },
  row: { tenantId: string; projectId: string; operationId: string; sourceKey: string; requestDigest: string; graphEpoch?: string },
): Promise<
  | { readonly state: 'reconciled'; readonly graphEventSeq: number }
  | { readonly state: 'conflict'; readonly reason: string }
  | { readonly state: 'unresolved'; readonly reason: string }
> {
  const graphKey = await deps.graphKeyFor(row.tenantId, row.projectId);
  const receipt = await deps.admitter.findReceipt(row.tenantId, row.projectId, graphKey, row.operationId);
  if (receipt !== null) {
    if (receipt.requestDigest !== row.requestDigest || (row.graphEpoch !== undefined && receipt.graphEpoch !== row.graphEpoch)) return { state: 'conflict', reason: 'receipt_digest_conflict' };
    return { state: 'reconciled', graphEventSeq: receipt.eventSeq };
  }
  return {
    state: 'unresolved',
    reason:
      'No committed receipt was observed. This does not prove an in-flight write stopped; only the same digest-bound idempotent admission may be retried under its original epoch.',
  };
}

function readIfString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readIfNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readIfBoolean(payload: Record<string, unknown>, key: string): boolean | null {
  const value = payload[key];
  return typeof value === 'boolean' ? value : null;
}
