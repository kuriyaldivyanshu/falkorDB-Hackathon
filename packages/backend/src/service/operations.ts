import { randomUUID } from 'node:crypto';

import type { Graph } from 'falkordb';

import {
  ThreadlineError,
  operationViewSchema,
  type DecimalString,
  type OperationKind,
  type OperationState,
  type OperationView,
} from '@threadline/shared';

import type { ServiceLimits } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { GraphStore } from '../storage/graph.js';
import {
  commitSourceAnchor,
  ensureProjectRoot,
  eventIdPrefixFor,
  projectRootIdFor,
  readOperationReceipt,
  readProjectRoot,
  receiptIdFor,
  type OperationReceiptView,
  type ProjectRootView,
} from '../storage/memoryGraph.js';
import type { SqlDatabase } from '../storage/pg.js';
import { MEMORY_GRAPH_SCHEMA_VERSION } from '../version.js';
import type { AuthenticatedCall } from './auth.js';

/**
 * The leased operation worker and the operation inspection read.
 *
 * The worker is the only path that turns a recorded intent into a graph
 * commit. Its ordering rules, in one place:
 *
 * 1. claim: one bounded lease update per batch, restricted to kinds this build
 *    commits, reclaiming leases that expired without settlement;
 * 2. re-derive every fact from SQL at delivery time (project state, epoch,
 *    privacy revision, source availability and visibility) — never from the
 *    request that created the intent;
 * 3. verify the project graph's constraints are OPERATIONAL before writing;
 * 4. reconcile first: an existing receipt under the same operation identity
 *    settles the operation without a second graph write;
 * 5. commit through one atomic guarded statement; a null result is diagnosed
 *    (receipt present, root guard refused) rather than guessed;
 * 6. settle SQL under the lease token; a lost lease leaves the receipt for the
 *    next claim to reconcile.
 *
 * Failures are classified by what was actually observed: a refused connection
 * leaves the operation `pending`, an unclassifiable reply is `ambiguous`, and
 * only `ambiguous` needs receipt reconciliation before any retry. Deterministic
 * guard refusals settle as `rejected` with an explicit code; nothing here waits
 * for FalcorDB to merely answer a ping before settling.
 */

/** Operation kinds this build's worker knows how to commit. */
export const SUPPORTED_OPERATION_KINDS: readonly string[] = ['source.append'];

const GRAPH_READY_TTL_MS = 5 * 60_000;
const GRAPH_PROBE_TTL_MS = 2_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export interface OperationWorkerStatus {
  readonly running: boolean;
  readonly workerId: string | null;
  readonly graphReachable: boolean;
  readonly inFlight: number;
  readonly pending: number;
  readonly leased: number;
  readonly ambiguous: number;
  readonly oldestPendingAtMs: number | null;
  readonly lastSettledAtMs: number | null;
  readonly lastErrorCode: string | null;
  readonly detail: string;
}

export interface OperationsWorkerDeps {
  readonly db: SqlDatabase;
  readonly graphStore: GraphStore;
  readonly limits: ServiceLimits;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export interface OperationsWorker {
  start(): void;
  stop(): Promise<void>;
  status(): OperationWorkerStatus;
}

export function createOperationsWorker(deps: OperationsWorkerDeps): OperationsWorker {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());
  const workerId = `worker-${randomUUID()}`;
  const leaseSeconds = Math.max(1, Math.ceil(deps.limits.operationLeaseMs / 1000));

  let running = false;
  let stopping = false;
  let loopPromise: Promise<void> | null = null;
  const inFlight = new Set<Promise<void>>();
  const projectChains = new Map<string, Promise<void>>();
  const graphReadyUntilMs = new Map<string, number>();

  let graphReachable = true;
  let graphProbedAtMs = 0;
  let lastSettledAtMs: number | null = null;
  let lastErrorCode: string | null = null;
  let backlog: {
    pending: number;
    leased: number;
    ambiguous: number;
    oldestPendingAtMs: number | null;
  } = { pending: 0, leased: 0, ambiguous: 0, oldestPendingAtMs: null };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const probeGraph = async (): Promise<boolean> => {
    const nowMs = clock().getTime();
    if (nowMs - graphProbedAtMs < GRAPH_PROBE_TTL_MS) {
      return graphReachable;
    }
    graphProbedAtMs = nowMs;
    try {
      await deps.graphStore.ping();
      if (!graphReachable) {
        logger.log({
          level: 'info',
          message: 'FalkorDB answered a probe again; operation delivery resumes.',
          fields: { workerId },
        });
      }
      graphReachable = true;
    } catch (error) {
      if (graphReachable) {
        logger.log({
          level: 'warn',
          message: 'FalkorDB probe failed; operation delivery pauses and leases expire unsettled.',
          fields: { workerId, errorName: error instanceof Error ? error.name : typeof error },
        });
      }
      graphReachable = false;
    }
    return graphReachable;
  };

  const ensureGraphReady = async (graphKey: string): Promise<boolean> => {
    const readyUntil = graphReadyUntilMs.get(graphKey) ?? 0;
    if (clock().getTime() < readyUntil) {
      return true;
    }
    try {
      const report = await deps.graphStore.ensureSchema(graphKey);
      if (report.ready) {
        graphReadyUntilMs.set(graphKey, clock().getTime() + GRAPH_READY_TTL_MS);
        return true;
      }
      logger.log({
        level: 'warn',
        message: 'Project graph constraints are not all OPERATIONAL yet.',
        fields: { graphKey, waitedMs: report.waitedMs },
      });
      return false;
    } catch (error) {
      logger.log({
        level: 'warn',
        message: 'Project graph schema verification failed.',
        fields: { graphKey, errorName: error instanceof Error ? error.name : typeof error },
      });
      return false;
    }
  };

  const refreshBacklog = async (): Promise<void> => {
    const rows = await deps.db.query<{
      operation_state: string;
      operation_count: string;
      oldest_created_at: Date | null;
    }>('SELECT * FROM threadline_memory.operation_backlog()');
    const next = { pending: 0, leased: 0, ambiguous: 0, oldestPendingAtMs: null as number | null };
    for (const row of rows) {
      // A backlog count is bounded by the number of operation rows, so it is a
      // small integer rather than a 64-bit counter. Refuse anything that cannot
      // be represented exactly instead of rounding it.
      const count = Number(row.operation_count);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new ThreadlineError('internal_error', 'The operation backlog count is outside the safe range.');
      }
      if (row.operation_state === 'pending') {
        next.pending = count;
        next.oldestPendingAtMs = row.oldest_created_at === null ? null : row.oldest_created_at.getTime();
      } else if (row.operation_state === 'leased') {
        next.leased = count;
      } else if (row.operation_state === 'ambiguous') {
        next.ambiguous = count;
      }
    }
    backlog = next;
  };

  const claimOperations = async (limit: number): Promise<ClaimedOperation[]> => {
    const leaseToken = randomUUID();
    const rows = await deps.db.query<ClaimedOperationRow>(
      'SELECT * FROM threadline_memory.claim_operations($1, $2, $3, $4, $5)',
      [limit, workerId, leaseToken, leaseSeconds, [...SUPPORTED_OPERATION_KINDS]],
    );
    return rows.map((row) => ({ row, leaseToken }));
  };

  const dispatch = (operation: ClaimedOperation): void => {
    const key = `${operation.row.tenant_id}:${operation.row.project_id}`;
    const previous = projectChains.get(key) ?? Promise.resolve();
    const task = previous
      .then(() => processOperation(operation))
      .catch((error: unknown) => {
        recordError('worker_dispatch', error);
      });
    projectChains.set(key, task);
    inFlight.add(task);
    void task.finally(() => {
      inFlight.delete(task);
      if (projectChains.get(key) === task) {
        projectChains.delete(key);
      }
    });
  };

  const waitForCapacity = async (): Promise<void> => {
    if (inFlight.size === 0) {
      return;
    }
    await Promise.race([...inFlight]);
  };

  const tick = async (): Promise<void> => {
    await refreshBacklog().catch((error: unknown) => {
      recordError('worker_backlog', error);
    });
    if (inFlight.size >= deps.limits.workerSlots) {
      await waitForCapacity();
      return;
    }
    if (!(await probeGraph())) {
      await sleep(deps.limits.workerPollMs);
      return;
    }
    const capacity = Math.max(1, deps.limits.workerSlots - inFlight.size);
    const claimed = await claimOperations(capacity);
    if (claimed.length === 0) {
      await sleep(deps.limits.workerPollMs);
      return;
    }
    for (const operation of claimed) {
      dispatch(operation);
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        await tick();
      } catch (error) {
        recordError('worker_tick', error);
        await sleep(deps.limits.workerPollMs);
      }
    }
  };

  const processOperation = async (operation: ClaimedOperation): Promise<void> => {
    const { row } = operation;
    try {
      await deliverOperation(operation);
    } catch (error) {
      recordError('worker_operation', error, { operationId: row.id, kind: row.kind });
      await retry(
        row,
        operation.leaseToken,
        'worker_error',
        'pending',
        'The worker hit an unexpected error; the operation was released for a later attempt.',
      ).catch(() => undefined);
    }
  };

  const deliverOperation = async (operation: ClaimedOperation): Promise<void> => {
    const { row, leaseToken } = operation;
    const facts = await loadOperationFacts(row);

    if (facts.refusal !== null) {
      await settleRefused(row, leaseToken, facts.refusal.code, facts.refusal.detail);
      return;
    }
    const { project, source } = facts;

    const projectRootId = projectRootIdFor(row.project_id);
    const graphEpoch = row.graph_epoch;
    // A privacy revision is a 64-bit counter. It arrives as a decimal string and
    // stays one: converting it to a JavaScript number would round it and the
    // rounded value cannot be converted back.
    const privacyRevision = row.privacy_revision;
    const sourceId = row.intent_source_id;
    if (sourceId === null || row.kind !== 'source.append') {
      // Already refused above; this narrows the type for the commit path.
      await settleRefused(
        row,
        leaseToken,
        'unsupported_operation_kind',
        'This build commits source-backed source.append intents only.',
      );
      return;
    }

    const ready = await ensureGraphReady(project.graph_key);
    if (!ready) {
      await retry(
        row,
        leaseToken,
        'graph_not_ready',
        'pending',
        'The project graph did not reach exact constraint readiness; nothing was written.',
      );
      return;
    }
    const graph = deps.graphStore.graph(project.graph_key);

    const nowMs = clock().getTime();
    let root: ProjectRootView;
    try {
      root = await ensureProjectRoot(graph, {
        projectRootId,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        graphEpoch: project.graph_epoch,
        privacyRevision: project.privacy_revision,
        nowMs,
        graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION,
      });
    } catch (error) {
      await retryAfterGraphFailure(operation, error);
      return;
    }
    if (root.graphEpoch === null) {
      await retry(row, leaseToken, 'graph_root_missing', 'pending', 'The project root could not be created.');
      return;
    }
    if (root.graphEpoch !== project.graph_epoch) {
      await settleRefused(
        row,
        leaseToken,
        'graph_root_epoch_conflict',
        'The project graph root carries a different epoch than the project record.',
      );
      return;
    }
    if (root.privacyRevision !== project.privacy_revision) {
      await settleRefused(
        row,
        leaseToken,
        'graph_root_privacy_conflict',
        'The project graph root carries a different privacy revision than the project record.',
      );
      return;
    }
    if (root.state !== 'active') {
      await settleRefused(row, leaseToken, 'graph_root_inactive', 'The project graph root is not active.');
      return;
    }

    // The graph call may take time; re-take the lease so a second worker cannot
    // claim the same operation mid-commit. Losing the lease means another
    // worker owns the operation now, so this one stops without a write.
    if (!(await renewLease(row, leaseToken))) {
      logger.log({
        level: 'warn',
        message: 'Lease was lost before the graph commit; abandoning this claim unsettled.',
        fields: { operationId: row.id, kind: row.kind },
      });
      return;
    }

    const receiptId = receiptIdFor(graphEpoch, row.id);
    const reconcile = await readReceiptSafely(graph, receiptId);
    if (reconcile.failed) {
      await retryAfterGraphFailure(operation, reconcile.error);
      return;
    }
    if (reconcile.receipt !== null && reconcile.receipt.eventSeq !== null) {
      await settleCommitted(
        row,
        leaseToken,
        reconcile.receipt.eventSeq,
        reconcile.receipt.outcome ?? 'committed',
        reconcile.receipt.committedAtMs ?? clock().getTime(),
      );
      logger.log({
        level: 'info',
        message: 'Operation reconciled against an existing receipt; no second graph write.',
        fields: { operationId: row.id, kind: row.kind, eventSeq: reconcile.receipt.eventSeq },
      });
      return;
    }

    let eventSeq: DecimalString | null = null;
    try {
      eventSeq = await commitSourceAnchor(graph, {
        projectRootId,
        graphEpoch,
        privacyRevision,
        receiptId,
        eventIdPrefix: eventIdPrefixFor(graphEpoch),
        operationId: row.id,
        sourceId,
        sourceDigest: source.digest,
        sourceKind: source.kind,
        requestDigest: row.request_digest,
        nowMs: clock().getTime(),
        graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION,
      });
    } catch (error) {
      await retryAfterGraphFailure(operation, error);
      return;
    }

    if (eventSeq !== null) {
      await settleCommitted(row, leaseToken, eventSeq, 'committed', clock().getTime());
      logger.log({
        level: 'info',
        message: 'Operation committed to the project graph.',
        fields: { operationId: row.id, kind: row.kind, eventSeq },
      });
      return;
    }

    // The statement wrote nothing: either the receipt appeared underneath us
    // (a concurrent reconciler) or a root guard refused. Diagnose; never guess.
    const after = await readReceiptSafely(graph, receiptId);
    if (after.failed) {
      await retryAfterGraphFailure(operation, after.error);
      return;
    }
    if (after.receipt !== null && after.receipt.eventSeq !== null) {
      await settleCommitted(
        row,
        leaseToken,
        after.receipt.eventSeq,
        after.receipt.outcome ?? 'committed',
        after.receipt.committedAtMs ?? clock().getTime(),
      );
      return;
    }
    const rootAfter = await readRootSafely(graph, projectRootId);
    if (rootAfter.failed) {
      await retryAfterGraphFailure(operation, rootAfter.error);
      return;
    }
    if (rootAfter.root === null || rootAfter.root.graphEpoch === null) {
      await retry(row, leaseToken, 'graph_root_missing', 'pending', 'The project root disappeared mid-commit.');
      return;
    }
    if (rootAfter.root.graphEpoch !== project.graph_epoch) {
      await settleRefused(
        row,
        leaseToken,
        'graph_root_epoch_conflict',
        'The project graph root carries a different epoch than the project record.',
      );
      return;
    }
    if (rootAfter.root.privacyRevision !== project.privacy_revision) {
      await settleRefused(
        row,
        leaseToken,
        'graph_root_privacy_conflict',
        'The project graph root carries a different privacy revision than the project record.',
      );
      return;
    }
    if (rootAfter.root.state !== 'active') {
      await settleRefused(row, leaseToken, 'graph_root_inactive', 'The project graph root is not active.');
      return;
    }
    await retry(
      row,
      leaseToken,
      'commit_no_effect',
      'pending',
      'The guarded commit wrote nothing and no guard refused it; the same operation will be retried.',
    );
  };

  const retryAfterGraphFailure = async (operation: ClaimedOperation, error: unknown): Promise<void> => {
    const { row, leaseToken } = operation;
    const classification = classifyGraphFailure(error);
    logger.log({
      level: 'warn',
      message: 'Graph commit did not complete.',
      fields: {
        operationId: row.id,
        kind: row.kind,
        classification,
        errorName: error instanceof Error ? error.name : typeof error,
      },
    });
    if (classification === 'constraint') {
      // A unique-constraint violation during the commit means either the
      // receipt already landed or an event sequence was taken concurrently.
      const graph = deps.graphStore.graph(await resolveGraphKey(row));
      const reconcile = await readReceiptSafely(graph, receiptIdFor(row.graph_epoch, row.id));
      if (!reconcile.failed && reconcile.receipt !== null && reconcile.receipt.eventSeq !== null) {
        await settleCommitted(
          row,
          leaseToken,
          reconcile.receipt.eventSeq,
          reconcile.receipt.outcome ?? 'committed',
          reconcile.receipt.committedAtMs ?? clock().getTime(),
        );
        return;
      }
      await retry(
        row,
        leaseToken,
        'constraint_conflict',
        'pending',
        'A concurrent graph write took an identity this commit needed; the same operation will be retried.',
      );
      return;
    }
    if (classification === 'not_submitted') {
      await retry(
        row,
        leaseToken,
        'graph_unreachable',
        'pending',
        'The graph connection was refused before the commit was submitted.',
      );
      return;
    }
    await retry(
      row,
      leaseToken,
      'graph_reply_lost',
      'ambiguous',
      'The graph reply was lost; the receipt will be reconciled before any retry.',
    );
  };

  const resolveGraphKey = async (row: ClaimedOperationRow): Promise<string> => {
    const rows = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<{ graph_key: string }>(
        'SELECT graph_key FROM threadline_memory.projects WHERE tenant_id = $1 AND id = $2',
        [row.tenant_id, row.project_id],
      ),
    );
    const graphKey = rows[0]?.graph_key;
    if (graphKey === undefined) {
      throw new ThreadlineError('authority_unavailable', 'The project record was not readable for reconciliation.');
    }
    return graphKey;
  };

  const loadOperationFacts = async (
    row: ClaimedOperationRow,
  ): Promise<
    | { readonly refusal: null; readonly project: ProjectFactRow; readonly source: SourceFactRow }
    | { readonly refusal: { readonly code: string; readonly detail: string } }
  > => {
    if (row.kind !== 'source.append' || row.intent_source_id === null) {
      return {
        refusal: {
          code: 'unsupported_operation_kind',
          detail: 'This build commits source-backed source.append intents only.',
        },
      };
    }
    const facts = await deps.db.withTenantTransaction(row.tenant_id, async (tx) => {
      const projects = await tx.rows<ProjectFactRow>(
        `SELECT state, graph_key, graph_epoch, privacy_revision::text AS privacy_revision
           FROM threadline_memory.projects
          WHERE tenant_id = $1 AND id = $2`,
        [row.tenant_id, row.project_id],
      );
      const sources = await tx.rows<SourceFactRow>(
        `SELECT kind, digest, availability, visibility
           FROM threadline_memory.sources
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [row.tenant_id, row.project_id, row.intent_source_id],
      );
      return { project: projects[0] ?? null, source: sources[0] ?? null };
    });
    if (facts.project === null) {
      return {
        refusal: { code: 'project_unavailable', detail: 'The project record is not readable or was removed.' },
      };
    }
    if (facts.project.state !== 'active') {
      return {
        refusal: {
          code: 'project_not_active',
          detail: `The project is ${facts.project.state}; no graph admission is performed.`,
        },
      };
    }
    if (row.graph_epoch !== facts.project.graph_epoch) {
      return {
        refusal: {
          code: 'graph_epoch_mismatch',
          detail: 'The intent carries an older graph epoch than the project record; it was not admitted.',
        },
      };
    }
    if (row.privacy_revision !== facts.project.privacy_revision) {
      return {
        refusal: {
          code: 'privacy_revision_advanced',
          detail: 'The project privacy revision advanced past this intent; it was not admitted.',
        },
      };
    }
    if (facts.source === null) {
      return {
        refusal: { code: 'source_missing', detail: 'The source this intent names is not present in the ledger.' },
      };
    }
    if (facts.source.availability !== 'available') {
      return {
        refusal: {
          code: facts.source.availability === 'deleted' ? 'source_deleted' : 'source_unavailable',
          detail: `The source is ${facts.source.availability}; it cannot be admitted to project memory.`,
        },
      };
    }
    if (facts.source.visibility !== 'project') {
      return {
        refusal: {
          code: 'private_source_not_admitted',
          detail: 'Principal-visibility sources are never admitted to project graph memory.',
        },
      };
    }
    return { refusal: null, project: facts.project, source: facts.source };
  };

  const renewLease = async (row: ClaimedOperationRow, leaseToken: string): Promise<boolean> => {
    const updated = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<{ id: string }>(
        `UPDATE threadline_memory.operations
            SET lease_expires_at = now() + make_interval(secs => $5)
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3
            AND state = 'leased' AND lease_token = $4
          RETURNING id`,
        [row.tenant_id, row.project_id, row.id, leaseToken, leaseSeconds],
      ),
    );
    return updated.length > 0;
  };

  const settleCommitted = async (
    row: ClaimedOperationRow,
    leaseToken: string,
    eventSeq: DecimalString,
    outcome: string,
    committedAtMs: number,
  ): Promise<void> => {
    const updated = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<{ id: string }>(
        `UPDATE threadline_memory.operations
            SET state = 'committed',
                receipt_graph_epoch = $4,
                receipt_event_seq = $5,
                receipt_outcome = $6,
                receipt_committed_at = $7,
                lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                error_code = NULL, error_detail = NULL,
                settled_at = now()
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3
            AND state = 'leased' AND lease_token = $8
          RETURNING id`,
        [
          row.tenant_id,
          row.project_id,
          row.id,
          row.graph_epoch,
          eventSeq,
          outcome.slice(0, 64),
          new Date(committedAtMs),
          leaseToken,
        ],
      ),
    );
    lastSettledAtMs = clock().getTime();
    if (updated.length === 0) {
      // The graph receipt exists; the operation record will be settled by
      // whichever worker holds the current lease when it reconciles.
      logger.log({
        level: 'warn',
        message: 'Settlement found the lease already reassigned; the graph receipt stands.',
        fields: { operationId: row.id, eventSeq },
      });
    }
  };

  const settleRefused = async (
    row: ClaimedOperationRow,
    leaseToken: string,
    errorCode: string,
    errorDetail: string,
  ): Promise<void> => {
    const updated = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<{ id: string }>(
        `UPDATE threadline_memory.operations
            SET state = 'rejected',
                lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                error_code = $4, error_detail = $5,
                settled_at = now()
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3
            AND state = 'leased' AND lease_token = $6
          RETURNING id`,
        [row.tenant_id, row.project_id, row.id, errorCode.slice(0, 64), errorDetail.slice(0, 240), leaseToken],
      ),
    );
    lastErrorCode = errorCode;
    if (updated.length > 0) {
      logger.log({
        level: 'info',
        message: 'Operation was refused before any graph write.',
        fields: { operationId: row.id, kind: row.kind, errorCode },
      });
    } else {
      logger.log({
        level: 'warn',
        message: 'Refusal settlement found the lease already reassigned; the other worker will decide.',
        fields: { operationId: row.id, errorCode },
      });
    }
  };

  const retry = async (
    row: ClaimedOperationRow,
    leaseToken: string,
    errorCode: string,
    nextState: 'pending' | 'ambiguous',
    errorDetail: string,
  ): Promise<void> => {
    const delayMs = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, row.attempts - 1), RETRY_MAX_MS);
    const nextAttemptAt = new Date(clock().getTime() + delayMs);
    const updated = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<{ id: string }>(
        `UPDATE threadline_memory.operations
            SET state = $4,
                lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                error_code = $5, error_detail = $6,
                next_attempt_at = $7
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3
            AND state = 'leased' AND lease_token = $8
          RETURNING id`,
        [
          row.tenant_id,
          row.project_id,
          row.id,
          nextState,
          errorCode.slice(0, 64),
          errorDetail.slice(0, 240),
          nextAttemptAt,
          leaseToken,
        ],
      ),
    );
    lastErrorCode = errorCode;
    if (updated.length > 0) {
      logger.log({
        level: 'warn',
        message: 'Operation released for a later attempt.',
        fields: { operationId: row.id, kind: row.kind, nextState, errorCode, delayMs },
      });
    }
  };

  const recordError = (scope: string, error: unknown, fields?: Record<string, unknown>): void => {
    lastErrorCode = scope;
    logger.log({
      level: 'error',
      message: 'Operation worker error.',
      fields: {
        scope,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        ...fields,
      },
    });
  };

  const status = (): OperationWorkerStatus => {
    const nowMs = clock().getTime();
    const parts = [
      `Leased worker ${running ? 'running' : 'stopped'}: ${String(backlog.pending)} pending, ${String(backlog.leased)} leased, ${String(backlog.ambiguous)} ambiguous`,
    ];
    if (backlog.oldestPendingAtMs !== null) {
      parts.push(`oldest pending ${String(Math.round((nowMs - backlog.oldestPendingAtMs) / 1000))}s`);
    }
    if (inFlight.size > 0) {
      parts.push(`${String(inFlight.size)} in flight`);
    }
    if (!graphReachable) {
      parts.push('graph probe failing');
    }
    if (lastErrorCode !== null) {
      parts.push(`last error ${lastErrorCode}`);
    }
    return {
      running,
      workerId: running ? workerId : null,
      graphReachable,
      inFlight: inFlight.size,
      pending: backlog.pending,
      leased: backlog.leased,
      ambiguous: backlog.ambiguous,
      oldestPendingAtMs: backlog.oldestPendingAtMs,
      lastSettledAtMs,
      lastErrorCode,
      detail: parts.join('; '),
    };
  };

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      stopping = false;
      logger.log({
        level: 'info',
        message: 'Operation worker started.',
        fields: {
          workerId,
          slots: deps.limits.workerSlots,
          leaseSeconds,
          kinds: SUPPORTED_OPERATION_KINDS.join(','),
        },
      });
      loopPromise = loop();
    },

    async stop(): Promise<void> {
      if (!running) {
        return;
      }
      stopping = true;
      const pendingLoop = loopPromise;
      loopPromise = null;
      if (pendingLoop !== null) {
        await settleWithin(pendingLoop, 5_000);
      }
      if (inFlight.size > 0) {
        await settleWithin(Promise.allSettled([...inFlight]), 15_000);
      }
      running = false;
      logger.log({ level: 'info', message: 'Operation worker stopped.', fields: { workerId } });
    },

    status,
  };
}

/**
 * Reads one operation for inspection, scoped to the caller's project.
 * The operation's graph receipt is reported from the SQL settlement, which the
 * worker only writes after a confirmed graph commit.
 */
export interface OperationService {
  inspect(call: AuthenticatedCall, projectId: string, operationId: string): Promise<OperationView>;
}

export function createOperationService(deps: { readonly db: SqlDatabase }): OperationService {
  return {
    async inspect(call, projectId, operationId): Promise<OperationView> {
      const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
        tx.rows<OperationInspectRow>(
          `SELECT id, project_id, kind, state, request_digest, attempts,
                  created_at, settled_at, error_code,
                  receipt_graph_epoch, receipt_event_seq, receipt_outcome, receipt_committed_at
             FROM threadline_memory.operations
            WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
          [call.scope.tenantId, projectId, operationId],
        ),
      );
      const row = rows[0];
      if (row === undefined) {
        throw new ThreadlineError('not_found', 'No such operation in this project.', { operationId });
      }
      const view: OperationView = {
        operationId: row.id,
        kind: row.kind as OperationKind,
        state: row.state as OperationState,
        requestDigest: row.request_digest,
        attempts: row.attempts,
        createdAtMs: row.created_at.getTime(),
        settledAtMs: row.settled_at === null ? null : row.settled_at.getTime(),
        errorCode: row.error_code,
        receipt:
          row.receipt_event_seq === null || row.receipt_graph_epoch === null
            ? null
            : {
                graphEpoch: row.receipt_graph_epoch,
                eventSeq: String(row.receipt_event_seq),
                outcome: row.receipt_outcome ?? 'committed',
                committedAtMs: (row.receipt_committed_at ?? row.settled_at ?? row.created_at).getTime(),
              },
      };
      return operationViewSchema.parse(view);
    },
  };
}

interface ClaimedOperation {
  readonly row: ClaimedOperationRow;
  readonly leaseToken: string;
}

interface ClaimedOperationRow {
  readonly tenant_id: string;
  readonly project_id: string;
  readonly id: string;
  readonly kind: string;
  readonly request_digest: string;
  readonly intent_source_id: string | null;
  readonly graph_epoch: string;
  readonly privacy_revision: string;
  readonly attempts: number;
  readonly next_attempt_at: Date;
  readonly created_at: Date;
}

interface ProjectFactRow {
  readonly state: string;
  readonly graph_key: string;
  readonly graph_epoch: string;
  readonly privacy_revision: string;
}

interface SourceFactRow {
  readonly kind: string;
  readonly digest: string;
  readonly availability: string;
  readonly visibility: string;
}

interface OperationInspectRow {
  readonly id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly state: string;
  readonly request_digest: string;
  readonly attempts: number;
  readonly created_at: Date;
  readonly settled_at: Date | null;
  readonly error_code: string | null;
  readonly receipt_graph_epoch: string | null;
  readonly receipt_event_seq: string | null;
  readonly receipt_outcome: string | null;
  readonly receipt_committed_at: Date | null;
}

function classifyGraphFailure(error: unknown): 'constraint' | 'not_submitted' | 'ambiguous' {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/constraint/i.test(text)) {
    return 'constraint';
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|Connection is closed|Connection refused|socket closed/i.test(text)) {
    return 'not_submitted';
  }
  return 'ambiguous';
}

type ReceiptAttempt =
  | { readonly failed: false; readonly receipt: OperationReceiptView | null }
  | { readonly failed: true; readonly error: unknown };

async function readReceiptSafely(graph: Graph, receiptId: string): Promise<ReceiptAttempt> {
  try {
    return { failed: false, receipt: await readOperationReceipt(graph, receiptId) };
  } catch (error) {
    return { failed: true, error };
  }
}

type RootAttempt =
  | { readonly failed: false; readonly root: ProjectRootView | null }
  | { readonly failed: true; readonly error: unknown };

async function readRootSafely(graph: Graph, projectRootId: string): Promise<RootAttempt> {
  try {
    return { failed: false, root: await readProjectRoot(graph, projectRootId) };
  } catch (error) {
    return { failed: true, error };
  }
}

async function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
}
