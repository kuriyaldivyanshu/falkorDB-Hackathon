import { requireOperationPolicy, requirePolicyPermission, type PolicyService } from './policy.js';
import { assertSafeAdmissionInput, assertPolicyInputLimits, QUALIFIED_ADMISSION_PARAMETERS, QUALIFIED_OPERATION_ADMISSION_SQL, hasOperationAdmission } from '../admission.js';
import type { AdmissionService } from './admission.js';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Graph } from 'falkordb';

import {
  OBSERVED_EVIDENCE_SOURCE_KINDS,
  ThreadlineError,
  memoryContentFits,
  memoryDocumentSchema,
  isContextManifestSourceKind,
  operationViewSchema,
  parseContract,
  type DecimalString,
  type MemoryContent,
  type MemoryDocument,
  type OperationKind,
  type OperationState,
  type OperationView,
} from '@threadline/shared';

import type { ServiceLimits } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest } from '../storage/digest.js';
import type { SourceFileStore } from '../storage/files.js';
import type { GraphStore } from '../storage/graph.js';
import {
  commitMemoryAccept,
  commitMemoryCorrect,
  commitMemoryPropose,
  commitSourceAnchor,
  commitTaskCreate,
  commitTaskRequire,
  countMemoryVersions,
  countSourceAnchors,
  ensureProjectRoot,
  fenceProjectWrites,
  fenceLegacyProjectWrites,
  eventIdPrefixFor,
  projectRootIdFor,
  readMemoryState,
  readOperationReceipt,
  readProjectRoot,
  readTaskState,
  readVersionState,
  receiptIdFor,
  type OperationReceiptView,
  type ProjectRootView,
} from '../storage/memoryGraph.js';
import { withProjectBarriers, type SqlDatabase, type TxClient } from '../storage/pg.js';
import { MEMORY_GRAPH_SCHEMA_VERSION } from '../version.js';
import type { AuthenticatedCall } from './auth.js';
import {
  beginGraphSubmission,
  finishGraphSubmission,
  graphTransactionDatabase,
  markGraphSubmissionUncertain,
  readGraphSubmissions,
  reserveRecoveryPrivacyRevision,
  settleRecoveryPrivacyRevision,
  type GraphSubmission,
} from './graphSubmission.js';
import { requirePermission } from './permissions.js';
import { lockReleaseAuthority } from './release.js';
import {
  MEMORY_DOCUMENT_MAX_BYTES,
  episodeDocumentRequestFacts,
  episodeRequestDigest,
  memoryDocumentRequestFacts,
  memoryRequestDigest,
} from './semanticSupport.js';

/**
 * The leased operation worker and the operation inspection read.
 *
 * The worker is the only path that turns a recorded intent into a graph
 * commit. Its ordering rules, in one place:
 *
 * 1. claim: one bounded lease update per batch, restricted to kinds this build
 *    commits, reclaiming leases that expired without settlement;
 * 2. take the shared project barrier and commit a durable submission marker;
 *    hold current authority row locks through graph execution and SQL settlement;
 *    re-derive every fact from SQL at delivery time (project state, epoch,
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
 * A failed graph write retains its durable marker, including after lease expiry.
 * Recovery requires an exact receipt or acknowledged graph-generation fencing
 * followed by receipt reconciliation; receipt absence alone never permits resubmission.
 * Read-only failures can retry after confirmed graph responses. Deterministic
 * guard refusals settle as `rejected` with an explicit code; nothing here waits
 * for FalcorDB to merely answer a ping before settling.
 */

/** Operation kinds this build's worker knows how to commit. */
export const SUPPORTED_OPERATION_KINDS: readonly string[] = [
  'source.append',
  'task.create',
  'memory.propose',
  'memory.accept',
  'memory.correct',
  'memory.episode.record',
  'task.require',
];

/** Bounded candidate proposals per memory; matches the accepted view bound. */
const MAX_PROPOSED_CANDIDATES = 8;
/** Bounded requirements per task; matches the accepted view bound. */
const MAX_TASK_REQUIREMENTS = 16;
/**
 * Only a semantic memory can govern a task. An episode records what happened and
 * a procedure proposes how to act; neither is an obligation, so neither may be
 * bound as a requirement.
 */
const OBLIGATION_MEMORY_KIND = 'semantic';

const GRAPH_READY_TTL_MS = 5 * 60_000;
const COMMAND_PROBE_GRACE_MS = 5_000;
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
  readonly admission: AdmissionService;
  readonly graphStore: GraphStore;
  readonly files: SourceFileStore;
  readonly limits: ServiceLimits;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export interface OperationsWorker {
  start(): void;
  stop(): Promise<void>;
  status(): OperationWorkerStatus;
}

/** Creates a leased delivery worker with bounded concurrency, graph reconciliation and status reporting. */
export function createOperationsWorker(deps: OperationsWorkerDeps): OperationsWorker {
  const execution = new AsyncLocalStorage<{
    db: SqlDatabase;
    submission?: GraphSubmission;
    uncertain: boolean;
    revalidateAuthority?: () => Promise<unknown>;
    revalidatePolicy?: () => Promise<unknown>;
  }>();
  const workerDb = (): SqlDatabase => execution.getStore()?.db ?? deps.db;
  const graphWrite = async <T>(work: () => Promise<T>): Promise<T> => {
    const current = execution.getStore();
    if (!current?.submission) throw new ThreadlineError('authority_unavailable', 'Graph submission has no durable reservation.');
    await current.db.query('SELECT 1');
    await current.revalidateAuthority?.();
    await current.revalidatePolicy?.();
    current.uncertain = true;
    const result = await work();
    current.uncertain = false;
    return result;
  };
  const settlementTransaction = async (
    row: ClaimedOperationRow,
    work: (tx: TxClient) => Promise<{ id: string }[]>,
  ): Promise<{ id: string }[]> => workerDb().withTenantTransaction(row.tenant_id, async (tx) => {
    const beforeSettlement = execution.getStore();
    if (beforeSettlement?.submission && !beforeSettlement.uncertain) {
      await settleRecoveryPrivacyRevision(tx, beforeSettlement.submission);
    }
    const updated = await work(tx);
    if (updated.length !== 1) {
      const current = execution.getStore();
      if (current) current.uncertain = true;
      throw new ThreadlineError('authority_unavailable', 'Operation settlement lost its SQL lease ownership.');
    }
    const current = execution.getStore();
    if (current?.submission) {
      if (current.uncertain) await markGraphSubmissionUncertain(tx, current.submission);
      else await finishGraphSubmission(tx, current.submission);
    }
    return updated;
  });
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

  let graphReachable = false;
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

  /** Refreshes cached graph reachability after its TTL and records probe transitions. */
  const probeGraph = async (): Promise<boolean> => {
    const nowMs = clock().getTime();
    if (nowMs - graphProbedAtMs < GRAPH_PROBE_TTL_MS) {
      return graphReachable;
    }
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
      graphProbedAtMs = clock().getTime();
    } catch (error) {
      if (graphReachable) {
        logger.log({
          level: 'warn',
          message: 'FalkorDB probe failed; operation delivery pauses and leases expire unsettled.',
          fields: { workerId, errorName: error instanceof Error ? error.name : typeof error },
        });
      }
      graphReachable = false;
      graphProbedAtMs = clock().getTime();
    }
    return graphReachable;
  };

  const ensureGraphReady = async (graphKey: string): Promise<boolean> => {
    const readyUntil = graphReadyUntilMs.get(graphKey) ?? 0;
    if (clock().getTime() < readyUntil) {
      return true;
    }
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
  };

  const refreshBacklog = async (): Promise<void> => {
    const rows = await workerDb().query<{
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
    const rows = await workerDb().query<ClaimedOperationRow>(
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

  /** Refreshes backlog and graph readiness, then claims and dispatches work within available capacity. */
  const tick = async (): Promise<void> => {
    await refreshBacklog().catch((error: unknown) => {
      recordError('worker_backlog', error);
    });
    // Readiness is refreshed *before* the capacity gate, not after it. A worker
    // that is saturated is very often saturated because it is holding an
    // operation blocked on a graph that has stopped answering — and returning
    // from the capacity gate first meant it never re-probed, so it reported the
    // graph as reachable while it was blocked on that same graph. The probe is
    // TTL-cached and fails fast when the graph is down, so moving it ahead of
    // the gate costs nothing and keeps the reported state true under load.
    if (!(await probeGraph())) {
      await sleep(deps.limits.workerPollMs);
      return;
    }
    if (inFlight.size >= deps.limits.workerSlots) {
      await waitForCapacity();
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
      await withProjectBarriers(deps.db, row.tenant_id, [row.project_id], async (db) =>
        execution.run({ db, uncertain: false }, async () => {
          try {
            const markers = await readGraphSubmissions(db, row.tenant_id, row.project_id, row.id);
            const own = markers.find((entry) => entry.operationId === row.id);
            if (own) {
              const current = execution.getStore()!;
              current.submission = own;
              current.uncertain = true;
              const graph = deps.graphStore.graph(await resolveGraphKey(row));
              const receipt = await readOperationReceipt(graph, receiptIdFor(own.graphEpoch, row.id));
              if (own.graphEpoch !== row.graph_epoch || own.requestDigest !== row.request_digest ||
                  (receipt !== null && !exactReceipt(row, receipt))) {
                await retry(row, operation.leaseToken, 'graph_submission_unresolved', 'ambiguous',
                  'The durable operation and graph receipt do not match; submission remains blocked.');
                return;
              }
              if (exactReceipt(row, receipt) && own.recoveryPrivacyRevision === null) {
                current.uncertain = false;
                await settleCommitted(row, operation.leaseToken, receipt.eventSeq,
                  receipt.outcome, receipt.committedAtMs);
                return;
              }
              // Keep the old marker durable while the fence may be executing.
              // Fencing carries no content and requires no revoked actor authority.
              await db.query('SELECT 1');
              const projects = await db.withTenantTransaction(row.tenant_id, (tx) => tx.rows<ProjectFactRow>(
                `SELECT state, graph_key, graph_epoch, privacy_revision::text AS privacy_revision
                   FROM threadline_memory.projects WHERE tenant_id = $1 AND id = $2`,
                [row.tenant_id, row.project_id]));
              const project = projects[0];
              if (!project || project.graph_epoch !== own.graphEpoch) {
                throw new ThreadlineError('authority_unavailable', 'Graph fence project identity is unavailable.');
              }
              let fenced: ProjectRootView;
              if (own.writeGeneration === null) {
                const target = own.recoveryPrivacyRevision ?? (BigInt(project.privacy_revision) + 1n).toString();
                if (BigInt(target) > 9223372036854775807n) {
                  throw new ThreadlineError('authority_unavailable', 'The legacy graph fence counter is exhausted.');
                }
                current.submission = await reserveRecoveryPrivacyRevision(db, own, target);
                fenced = await fenceLegacyProjectWrites(graph, {
                  projectRootId: projectRootIdFor(row.project_id), tenantId: row.tenant_id,
                  projectId: row.project_id, graphEpoch: own.graphEpoch, writeGeneration: '0',
                  expectedPrivacyRevision: (BigInt(target) - 1n).toString(), privacyRevision: target,
                  graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION, nowMs: clock().getTime(),
                });
                if (fenced.graphEpoch !== own.graphEpoch || fenced.privacyRevision !== target) {
                  throw new ThreadlineError('authority_unavailable', 'Legacy graph fencing was not established.');
                }
              } else {
                fenced = await fenceProjectWrites(graph, {
                  projectRootId: projectRootIdFor(row.project_id), tenantId: row.tenant_id,
                  projectId: row.project_id, graphEpoch: own.graphEpoch,
                  writeGeneration: own.writeGeneration, privacyRevision: project.privacy_revision,
                  graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION, nowMs: clock().getTime(),
                });
                if (fenced.graphEpoch !== own.graphEpoch || fenced.writeGeneration === null ||
                    BigInt(fenced.writeGeneration) <= BigInt(own.writeGeneration)) {
                  throw new ThreadlineError('authority_unavailable', 'Graph fencing was not established.');
                }
              }
              // An old mutation may have committed before the fence. Re-read only
              // after its acknowledged advancement before deciding no effect.
              const afterFence = await readOperationReceipt(graph, receiptIdFor(own.graphEpoch, row.id));
              if (afterFence !== null && !exactReceipt(row, afterFence)) {
                throw new ThreadlineError('authority_unavailable', 'The fenced graph receipt does not match its operation.');
              }
              current.uncertain = false;
              if (exactReceipt(row, afterFence)) {
                await settleCommitted(row, operation.leaseToken, afterFence.eventSeq,
                  afterFence.outcome, afterFence.committedAtMs);
              } else {
                await retry(row, operation.leaseToken, 'graph_submission_fenced', 'pending',
                  'Earlier graph execution was fenced; retry the same operation under current authority.');
              }
              return;
            }
            if (markers.length > 0) {
              await retry(row, operation.leaseToken, 'graph_submission_unresolved', 'pending',
                'Another unresolved graph submission blocks project writes.');
              return;
            }
            // Receipt reconciliation/fencing above always runs first. No
            // historical unqualified intent is replayed as a fresh graph write.
            const admissions = await db.withTenantTransaction(row.tenant_id, tx => tx.rows<{ id: string; payload: unknown; policy_revision: string }>(
              `SELECT a.id,o.payload,a.policy_revision::text FROM threadline_memory.operations o
                JOIN threadline_memory.ingress_admissions a ON ${QUALIFIED_OPERATION_ADMISSION_SQL}
               WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.id=$3`,
              [row.tenant_id,row.project_id,row.id,...QUALIFIED_ADMISSION_PARAMETERS]));
            if (admissions.length !== 1) {
              await settleRefused(row, operation.leaseToken, 'admission_unqualified',
                'Historical intent requires explicit safe migration before graph delivery.');
              return;
            }
            try {
              const policy = await db.withTenantTransaction(row.tenant_id,tx=>deps.admission.requireCurrentPolicy(row.tenant_id,row.project_id,tx));
              requireOperationPolicy(policy,admissions[0]!.policy_revision,row.kind,admissions[0]!.payload);
            } catch (error) {
              await retry(row, operation.leaseToken, error instanceof ThreadlineError && error.code==='stale_revision' ? 'policy_revision_changed' : 'policy_unavailable', 'pending',
                'Current content policy is unavailable; the operation will be retried.');
              return;
            }
            try {
              assertSafeAdmissionInput(admissions[0]!.payload);
            } catch {
              await settleRefused(row, operation.leaseToken, 'admission_refused',
                'Current content policy does not permit this queued intent.');
              return;
            }
            if (!(await renewLease(row, operation.leaseToken))) return;
            const current = execution.getStore()!;
            const graph = deps.graphStore.graph(await resolveGraphKey(row));
            const before = await readProjectRoot(graph, projectRootIdFor(row.project_id));
            const writeGeneration = before === null ? '0' : before.writeGeneration;
            if (writeGeneration === null) {
              throw new ThreadlineError('authority_unavailable', 'The graph write generation is unreadable.');
            }
            current.submission = await beginGraphSubmission(db, {
              tenantId: row.tenant_id, projectId: row.project_id, operationId: row.id,
              ownerToken: operation.leaseToken, graphEpoch: row.graph_epoch, requestDigest: row.request_digest,
              writeGeneration, recoveryPrivacyRevision: null,
            });
            await db.withTenantTransaction(row.tenant_id, async (tx) => {
              const authorityDb = graphTransactionDatabase(db, tx, row.tenant_id);
              await execution.run({ db: authorityDb, submission: current.submission, uncertain: false }, async () => {
                const actors = await tx.rows<{
                  actor_token_id: string | null; actor_principal_id: string; source_kind: string | null;
                }>(`SELECT actor_token_id, actor_principal_id, payload->>'sourceKind' AS source_kind
                      FROM threadline_memory.operations
                     WHERE tenant_id = $1 AND project_id = $2 AND id = $3
                       AND state = 'leased' AND lease_token = $4 FOR UPDATE`,
                  [row.tenant_id, row.project_id, row.id, operation.leaseToken]);
                const actor = actors[0];
                if (!actor?.actor_token_id) {
                  await settleRefused(row, operation.leaseToken, 'authority_unavailable',
                    'The recorded intent has no current credential authority.');
                  return;
                }
                try {
                  const authority = await lockReleaseAuthority(tx, {
                    tenantId: row.tenant_id, projectId: row.project_id,
                    tokenId: actor.actor_token_id, principalId: actor.actor_principal_id,
                  });
                  execution.getStore()!.revalidateAuthority = () => lockReleaseAuthority(tx, {
                    tenantId: row.tenant_id, projectId: row.project_id,
                    tokenId: actor.actor_token_id!, principalId: actor.actor_principal_id,
                  });
                  execution.getStore()!.revalidatePolicy = async () => {
                    const policy = await deps.admission.requireCurrentPolicy(row.tenant_id,row.project_id,tx);
                    requireOperationPolicy(policy,admissions[0]!.policy_revision,row.kind,admissions[0]!.payload);
                  };
                  await execution.getStore()!.revalidatePolicy!();
                  const audit = row.kind === 'source.append' && isContextManifestSourceKind(actor.source_kind);
                  if ((audit && authority.tokenKind === 'producer' && authority.nativeSessionId === null) ||
                      (!audit && (authority.tokenKind === 'reader' || authority.tokenKind === 'producer' ||
                        !['owner', 'member'].includes(authority.role ?? '')))) {
                    await settleRefused(row, operation.leaseToken, 'scope_denied',
                      'Current authority no longer permits the recorded graph change.');
                    return;
                  }
                } catch (error) {
                  if (error instanceof ThreadlineError && ['authority_unavailable','stale_revision'].includes(error.code)
                    && error.details?.['reason']==='policy_unavailable' && !execution.getStore()?.uncertain) {
                    await retry(row,operation.leaseToken,error.code==='stale_revision'?'policy_revision_changed':'policy_unavailable','pending',
                      'Current content policy is unavailable; the operation will be retried.');
                    return;
                  }
                  if (error instanceof ThreadlineError &&
                      ['scope_denied', 'unauthenticated', 'not_found'].includes(error.code)) {
                    await settleRefused(row, operation.leaseToken, 'scope_denied',
                      'Current authority no longer permits the recorded graph change.');
                    return;
                  }
                  throw error;
                }
                try { await deliverOperation(operation); }
                catch (error) {
                  if (error instanceof ThreadlineError && ['authority_unavailable','stale_revision'].includes(error.code)
                    && error.details?.['reason'] === 'policy_unavailable' && !execution.getStore()?.uncertain) {
                    await retry(row, operation.leaseToken, error instanceof ThreadlineError && error.code==='stale_revision' ? 'policy_revision_changed' : 'policy_unavailable', 'pending',
                      'Current content policy is unavailable; the operation will be retried.');
                    return;
                  }
                  throw error;
                }
              });
            });
          } catch (error) {
            const current = execution.getStore()!;
            if (current.submission) {
              // The marker survives even if this pinned connection no longer answers.
              current.uncertain = true;
              await db.withTenantTransaction(row.tenant_id,
                (tx) => markGraphSubmissionUncertain(tx, current.submission!)).catch(() => undefined);
            }
            recordError('worker_operation', error, { operationId: row.id, kind: row.kind });
            await retry(row, operation.leaseToken, 'worker_error', current.submission ? 'ambiguous' : 'pending',
              'The worker could not establish its outcome; unresolved submissions remain blocked.').catch(() => undefined);
          }
        }));
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
    const preparation = await prepareDelivery(row);
    if (preparation.prepared === 'outcome') {
      await settleOutcome(row, leaseToken, preparation.outcome);
      return;
    }
    const { plan } = preparation;
    const { project } = plan;

    const projectRootId = projectRootIdFor(row.project_id);
    const graphEpoch = row.graph_epoch;
    // A privacy revision is a 64-bit counter. It arrives as a decimal string and
    // stays one: converting it to a JavaScript number would round it and the
    // rounded value cannot be converted back.
    const privacyRevision = row.privacy_revision;

    const current = execution.getStore()!;
    const ready = await graphWrite(() => ensureGraphReady(project.graph_key));
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
      root = await graphWrite(() => ensureProjectRoot(graph, {
        projectRootId,
        tenantId: row.tenant_id,
        projectId: row.project_id,
        graphEpoch: project.graph_epoch,
        writeGeneration: current.submission!.writeGeneration!,
        privacyRevision: project.privacy_revision,
        nowMs,
        graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION,
      }));
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

    // The authority transaction locks the operation row against reassignment;
    // renew its lease and require SQL acknowledgement before another graph call.
    if (!(await renewLease(row, leaseToken))) {
      current.uncertain = true;
      throw new ThreadlineError('authority_unavailable', 'Graph submission lost its operation lease.');
    }

    const receiptId = receiptIdFor(graphEpoch, row.id);
    const reconcile = await readReceiptSafely(graph, receiptId);
    if (reconcile.failed) {
      await retryAfterGraphFailure(operation, reconcile.error);
      return;
    }
    if (exactReceipt(row, reconcile.receipt)) {
      current.uncertain = false;
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

    if (reconcile.receipt !== null) {
      current.uncertain = true;
      await retry(row, leaseToken, 'graph_receipt_mismatch', 'ambiguous',
        'The graph receipt does not exactly match the durable operation; submission remains blocked.');
      return;
    }

    const context: CommitTimeContext = {
      projectRootId,
      graphEpoch,
      writeGeneration: current.submission!.writeGeneration!,
      privacyRevision,
      receiptId,
      eventIdPrefix: eventIdPrefixFor(graphEpoch),
      operationId: row.id,
      requestDigest: row.request_digest,
      actorPrincipalId: plan.actorPrincipalId,
      nowMs: () => clock().getTime(),
      graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION,
    };

    // Kind-specific graph preconditions run only for an operation whose own
    // receipt does not already exist: a replayed acceptance must not be refused
    // by a head its own earlier commit already moved.
    let precondition: PlanOutcome | null = null;
    try {
      precondition = await plan.precheck(graph, context);
    } catch (error) {
      await retryAfterGraphFailure(operation, error);
      return;
    }
    if (precondition !== null) {
      await settleOutcome(row, leaseToken, precondition);
      return;
    }

    let eventSeq: DecimalString | null = null;
    try {
      const fresh = await prepareDelivery(row);
      if (fresh.prepared === 'outcome') {
        await settleOutcome(row, leaseToken, fresh.outcome);
        return;
      }
      if (!(await renewLease(row, leaseToken))) {
        current.uncertain = true;
        throw new ThreadlineError('authority_unavailable', 'Graph submission lost its operation lease.');
      }
      eventSeq = await graphWrite(() => fresh.plan.commit(graph, context));
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
    // (a concurrent reconciler) or a guard refused. Diagnose; never guess.
    const after = await readReceiptSafely(graph, receiptId);
    if (after.failed) {
      await retryAfterGraphFailure(operation, after.error);
      return;
    }
    if (exactReceipt(row, after.receipt)) {
      await settleCommitted(
        row,
        leaseToken,
        after.receipt.eventSeq,
        after.receipt.outcome ?? 'committed',
        after.receipt.committedAtMs ?? clock().getTime(),
      );
      return;
    }
    if (after.receipt !== null) {
      current.uncertain = true;
      await retry(row, leaseToken, 'graph_receipt_mismatch', 'ambiguous',
        'The graph receipt does not exactly match the durable operation; submission remains blocked.');
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

    let diagnostic: PlanOutcome | null = null;
    try {
      diagnostic = await plan.diagnose(graph, context);
    } catch (error) {
      await retryAfterGraphFailure(operation, error);
      return;
    }
    if (diagnostic !== null) {
      await settleOutcome(row, leaseToken, diagnostic);
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
    if (error instanceof ThreadlineError && ['authority_unavailable','stale_revision'].includes(error.code)
      && error.details?.['reason'] === 'policy_unavailable' && !execution.getStore()?.uncertain) {
      await retry(operation.row, operation.leaseToken, error instanceof ThreadlineError && error.code==='stale_revision' ? 'policy_revision_changed' : 'policy_unavailable', 'pending',
        'Current content policy is unavailable; the operation will be retried.');
      return;
    }
    const { row, leaseToken } = operation;
    const classification = execution.getStore()?.uncertain ? 'ambiguous' : classifyGraphFailure(error);
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
      if (!reconcile.failed && exactReceipt(row, reconcile.receipt)) {
        execution.getStore()!.uncertain = false;
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
    const rows = await workerDb().withTenantTransaction(row.tenant_id, (tx) =>
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

  /**
   * Loads the durable facts every kind shares: the project record this intent
   * was admitted against, the recorded payload and the acting principal.
   * Epoch, privacy revision and project state are re-derived here at delivery
   * time — never from the request that created the intent.
   */
  const loadBaseFacts = async (
    row: ClaimedOperationRow,
  ): Promise<
    | {
        readonly refusal: null;
        readonly project: ProjectFactRow;
        readonly payload: Record<string, unknown>;
        readonly actorPrincipalId: string;
      }
    | { readonly refusal: PlanOutcomeRefuse }
  > => {
    const loaded = await workerDb().withTenantTransaction(row.tenant_id, async (tx) => {
      const projects = await tx.rows<ProjectFactRow>(
        `SELECT state, graph_key, graph_epoch, privacy_revision::text AS privacy_revision
           FROM threadline_memory.projects
          WHERE tenant_id = $1 AND id = $2`,
        [row.tenant_id, row.project_id],
      );
      const operations = await tx.rows<{
        payload: Record<string, unknown> | null;
        actor_principal_id: string;
      }>(
        `SELECT payload, actor_principal_id
           FROM threadline_memory.operations
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [row.tenant_id, row.project_id, row.id],
      );
      return { project: projects[0] ?? null, operation: operations[0] ?? null };
    });
    if (loaded.project === null) {
      return {
        refusal: refuseIntent('project_unavailable', 'The project record is not readable or was removed.'),
      };
    }
    if (loaded.project.state !== 'active') {
      return {
        refusal: refuseIntent(
          'project_not_active',
          `The project is ${loaded.project.state}; no graph admission is performed.`,
        ),
      };
    }
    if (row.graph_epoch !== loaded.project.graph_epoch) {
      return {
        refusal: refuseIntent(
          'graph_epoch_mismatch',
          'The intent carries an older graph epoch than the project record; it was not admitted.',
        ),
      };
    }
    if (row.privacy_revision !== loaded.project.privacy_revision) {
      return {
        refusal: refuseIntent(
          'privacy_revision_advanced',
          'The project privacy revision advanced past this intent; it was not admitted.',
        ),
      };
    }
    if (loaded.operation === null) {
      return { refusal: refuseIntent('operation_unreadable', 'The operation row is not readable.') };
    }
    return {
      refusal: null,
      project: loaded.project,
      payload: loaded.operation.payload ?? {},
      actorPrincipalId: loaded.operation.actor_principal_id,
    };
  };

  const readSourceFileFacts = async (
    row: ClaimedOperationRow,
    sourceIds: readonly string[],
  ): Promise<SourceFileFactsRow[]> => {
    if (sourceIds.length === 0) {
      return [];
    }
    return workerDb().withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<SourceFileFactsRow>(
        `SELECT id, kind, digest, byte_size::text AS byte_size, storage_key, availability, visibility
           FROM threadline_memory.sources
          WHERE tenant_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) AND release_state = 'eligible'`,
        [row.tenant_id, row.project_id, [...sourceIds]],
      ),
    );
  };

  /**
   * Reads and validates the captured intent document for a memory intent.
   *
   * The document is the only place proposal content lives. It is read through
   * the immutable source-byte store, which verifies the whole object against
   * the digest SQL recorded, and re-validated against the shared document
   * contract before any graph write is attempted.
   */
  const readIntentDocument = async (
    row: ClaimedOperationRow,
    documentSourceId: string,
  ): Promise<
    | { readonly refusal: null; readonly document: MemoryDocument }
    | { readonly refusal: PlanOutcomeRefuse }
  > => {
    const facts = (await readSourceFileFacts(row, [documentSourceId]))[0] ?? null;
    if (facts === null) {
      return {
        refusal: refuseIntent('intent_document_missing', 'The captured intent document is not present in the ledger.'),
      };
    }
    if (facts.availability !== 'available' || facts.visibility !== 'project') {
      return {
        refusal: refuseIntent(
          'intent_document_unavailable',
          'The captured intent document is not available for admission.',
        ),
      };
    }
    const byteSize = Number(facts.byte_size);
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MEMORY_DOCUMENT_MAX_BYTES) {
      return {
        refusal: refuseIntent(
          'intent_document_invalid',
          'The captured intent document size is outside the admitted bound.',
        ),
      };
    }
    let bytes: Buffer;
    try {
      bytes = await deps.files.read({
        tenantId: row.tenant_id,
        projectId: row.project_id,
        storageKey: facts.storage_key,
        digest: facts.digest,
        byteSize,
        maxBytes: MEMORY_DOCUMENT_MAX_BYTES,
      });
    } catch {
      return {
        refusal: refuseIntent(
          'intent_document_unreadable',
          'The captured intent document bytes are not readable; nothing was committed.',
        ),
      };
    }
    try {
      const document = parseContract(
        memoryDocumentSchema,
        JSON.parse(bytes.toString('utf8')) as unknown,
        'memory document',
      );
      return { refusal: null, document };
    } catch {
      return {
        refusal: refuseIntent(
          'intent_document_invalid',
          'The captured intent document did not validate; nothing was committed.',
        ),
      };
    }
  };

  /**
   * Cross-checks the captured document against the recorded operation and
   * re-derives the canonical request digest. The recorded digest and the
   * durable intent must agree; a mismatch refuses instead of writing content
   * the ledger did not admit.
   */
  const verifyMemoryDocument = (
    row: ClaimedOperationRow,
    document: MemoryDocument,
  ): PlanOutcomeRefuse | null => {
    if (
      document.operationKind !== row.kind ||
      document.memoryId !== row.intent_memory_id ||
      document.versionId !== row.intent_version_id ||
      document.expectedHead !== (row.expected_head_token ?? null) ||
      (document.originTaskId !== null &&
        row.intent_task_id !== null &&
        document.originTaskId !== row.intent_task_id)
    ) {
      return refuseIntent(
        'intent_integrity_mismatch',
        'The captured intent document does not match the recorded operation; nothing was committed.',
      );
    }
    if (!memoryContentFits(document.content)) {
      return refuseIntent('version_too_large', 'The captured memory version exceeds the admitted byte bound.');
    }
    const derived =
      document.operationKind === 'memory.episode.record'
        ? episodeRequestDigest(episodeDocumentRequestFacts(row.project_id, document))
        : memoryRequestDigest(memoryDocumentRequestFacts(row.project_id, document));
    if (derived !== row.request_digest) {
      return refuseIntent(
        'intent_integrity_mismatch',
        'The captured intent does not match its request digest; nothing was committed.',
      );
    }
    return null;
  };

  /**
   * The evidence gate for a semantic version: every cited source must exist in
   * the project scope, be project-visible and available, and have a committed
   * graph anchor. A pending anchor is a temporary wait; a rejected anchor is a
   * terminal refusal. Missing and unreadable evidence produce the same
   * refusal, so a refusal never confirms that an inaccessible source exists.
   */
  const requireEvidenceAdmissible = async (
    row: ClaimedOperationRow,
    actorPrincipalId: string,
    documentSourceId: string,
    evidenceIds: readonly string[],
  ): Promise<PlanOutcome | null> => {
    const loaded = await workerDb().withTenantTransaction(row.tenant_id, async (tx) => {
      const evidence = await tx.rows<EvidenceFactsRow>(
        `SELECT id, availability, visibility
           FROM threadline_memory.sources
          WHERE tenant_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) AND release_state = 'eligible'
            AND (visibility = 'project' OR owner_principal_id = $4)`,
        [row.tenant_id, row.project_id, [...evidenceIds], actorPrincipalId],
      );
      const anchors = await tx.rows<AnchorStateRow>(
        `SELECT id, state, error_code
           FROM threadline_memory.operations
          WHERE tenant_id = $1 AND project_id = $2 AND kind = 'source.append' AND id = ANY($3::uuid[])`,
        [row.tenant_id, row.project_id, [documentSourceId, ...evidenceIds]],
      );
      return { evidence, anchors };
    });
    const evidenceById = new Map(loaded.evidence.map((entry) => [entry.id, entry]));
    const anchorsById = new Map(loaded.anchors.map((entry) => [entry.id, entry]));
    for (const id of evidenceIds) {
      const facts = evidenceById.get(id);
      if (facts === undefined || facts.visibility !== 'project') {
        return refuseIntent(
          'evidence_not_readable',
          'A cited source is not present in this project scope or cannot be admitted as evidence.',
        );
      }
      if (facts.availability !== 'available') {
        return refuseIntent('source_unavailable', 'A cited source is not available for admission as evidence.');
      }
      const anchor = anchorsById.get(id);
      if (anchor === undefined) {
        return refuseIntent('evidence_anchor_missing', 'A cited source has no recorded admission intent.');
      }
      if (anchor.state === 'rejected' || anchor.state === 'cancelled') {
        return refuseIntent(
          'evidence_anchor_rejected',
          'A cited source was never admitted to project memory; the intent cannot cite it.',
        );
      }
      if (anchor.state !== 'committed') {
        return retryPending('dependency_pending', 'A cited source is still being admitted; the intent waits for it.');
      }
    }
    const own = anchorsById.get(documentSourceId);
    if (own === undefined) {
      return refuseIntent('intent_document_missing', 'The captured intent document has no recorded admission intent.');
    }
    if (own.state === 'rejected' || own.state === 'cancelled') {
      return refuseIntent('intent_document_rejected', 'The captured intent document was never admitted to project memory.');
    }
    if (own.state !== 'committed') {
      return retryPending(
        'dependency_pending',
        'The captured intent document is still being admitted; the intent waits for its own anchor.',
      );
    }
    return null;
  };

  /**
   * Re-derives the episode's evidence classification at delivery.
   *
   * Admission classified the evidence from the same durable facts, but those
   * facts can move: a source can lose its completeness or have its admission
   * rejected while the intent waits behind a graph outage. Re-deriving here is
   * what stops a captured document from asserting a precision its evidence no
   * longer supports.
   */
  const verifyEpisodeEvidence = async (
    row: ClaimedOperationRow,
    document: MemoryDocument,
    actorPrincipalId: string,
  ): Promise<PlanOutcomeRefuse | null> => {
    if (document.content.kind !== 'episodic') {
      return refuseIntent('invalid_intent', 'An episode intent must carry episodic content.');
    }
    const facts = await readEpisodeEvidenceFacts(row, document.sourceIds);
    const byId = new Map(facts.map((entry) => [entry.id, entry]));
    for (const sourceId of document.sourceIds) {
      const entry = byId.get(sourceId);
      if (entry === undefined || entry.visibility !== 'project') {
        return refuseIntent(
          'evidence_not_readable',
          'A cited source is not present in this project scope or cannot be admitted as evidence.',
        );
      }
      if (entry.availability !== 'available') {
        return refuseIntent('source_unavailable', 'A cited source is not available for admission as evidence.');
      }
    }
    const requested = document.requestedEvidencePrecision ?? null;
    if (requested !== 'observed') {
      return document.content.evidencePrecision === 'authored'
        ? null
        : refuseIntent(
            'evidence_precision_conflict',
            'The captured episode claims an observation its admission never granted.',
          );
    }
    const ineligible = episodeEvidenceIneligibility(facts, document.sourceIds, actorPrincipalId);
    if (ineligible !== null) {
      return refuseIntent('episode_evidence_unsupported', ineligible);
    }
    return document.content.evidencePrecision === 'observed'
      ? null
      : refuseIntent(
          'evidence_precision_conflict',
          'The captured episode records less precision than its evidence admits; nothing was committed.',
        );
  };

  /**
   * The delivery-side twin of `classifyEpisodeEvidence`.
   *
   * Both read the same five conditions from durable ledger facts, and both
   * refuse rather than downgrade. This copy exists because the worker must decide
   * from the ledger it holds a lease over, never from what an admitting request
   * happened to see.
   */
  const episodeEvidenceIneligibility = (
    facts: readonly EpisodeEvidenceRow[],
    sourceIds: readonly string[],
    actorPrincipalId: string,
  ): string | null => {
    const byId = new Map(facts.map((entry) => [entry.id, entry]));
    const observedKinds: ReadonlySet<string> = new Set(OBSERVED_EVIDENCE_SOURCE_KINDS);
    for (const sourceId of sourceIds) {
      const entry = byId.get(sourceId);
      if (entry === undefined) {
        return 'A cited source is no longer present in the ledger.';
      }
      if (!observedKinds.has(entry.kind)) {
        return `A cited source is catalogued as "${entry.kind}", which is not outcome evidence in this contract.`;
      }
      if (entry.completeness !== 'complete') {
        return `A cited source is recorded as ${entry.completeness}; only a complete record can establish an outcome.`;
      }
      if (entry.producer_kind !== 'human') {
        return 'A cited source was recorded by a non-human principal; a producer assertion stays authored evidence.';
      }
      if (entry.producer_principal_id !== actorPrincipalId) {
        return 'A cited source was not recorded by the acting human principal.';
      }
      if (entry.anchor_state !== 'committed') {
        return 'A cited source has not been admitted to project memory.';
      }
    }
    return null;
  };

  /** Reads project-scoped source eligibility, producer kind and anchor state for episode delivery. */
  const readEpisodeEvidenceFacts = async (
    row: ClaimedOperationRow,
    sourceIds: readonly string[],
  ): Promise<EpisodeEvidenceRow[]> =>
    workerDb().withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<EpisodeEvidenceRow>(
        `SELECT s.id, s.kind, s.completeness, s.availability, s.visibility,
                s.producer_principal_id, p.kind AS producer_kind, o.state AS anchor_state
           FROM threadline_memory.sources s
           JOIN threadline_memory.principals p ON p.tenant_id = s.tenant_id AND p.id = s.producer_principal_id
           LEFT JOIN threadline_memory.operations o
                  ON o.tenant_id = s.tenant_id AND o.project_id = s.project_id
                 AND o.kind = 'source.append' AND o.intent_source_id = s.id
          WHERE s.tenant_id = $1 AND s.project_id = $2 AND s.id = ANY($3::uuid[]) AND s.release_state = 'eligible'`,
        [row.tenant_id, row.project_id, [...sourceIds]],
      ),
    );

  /**
   * Validates the episodes a procedure version cites as supporting reuse.
   *
   * Every reference must name a version project memory holds, that is episodic,
   * and that was accepted: an unaccepted candidate is a proposal, not a recorded
   * outcome. The reference is checked, never copied — the outcome each episode
   * actually recorded is read back through the version read, so a procedure can
   * never present support its evidence does not carry.
   *
   * A referenced episode may itself still be waiting on its own admission, in
   * which case this is a real wait rather than an invalidity.
   */
  const verifyProcedureSupports = async (
    graph: Graph,
    document: MemoryDocument,
    versionId: string,
    pendingRows: readonly PendingIntentRow[],
  ): Promise<PlanOutcome | null> => {
    if (document.content.kind !== 'procedural' || document.content.supportedBy.length === 0) {
      return null;
    }
    for (const supportId of document.content.supportedBy) {
      const state = await readVersionState(graph, supportId);
      if (state === null) {
        return pendingRows.some((entry) => createsVersion(entry, supportId))
          ? retryPending(
              'dependency_pending',
              'A supporting episode version is still being admitted; this procedure waits for it.',
            )
          : refuseIntent(
              'supporting_episode_missing',
              'A supporting episode version is not present in project memory.',
            );
      }
      if (state.kind !== 'episodic') {
        return refuseIntent(
          'supporting_reference_not_episodic',
          'A supporting reference does not name an episodic version.',
        );
      }
      if (state.acceptance !== 'accepted') {
        return refuseIntent(
          'supporting_episode_not_accepted',
          'A supporting episode version was never accepted, so it is a proposal rather than a recorded outcome.',
        );
      }
      if (supportId === versionId) {
        return refuseIntent(
          'supporting_reference_self',
          'A procedure version cannot cite itself as supporting evidence.',
        );
      }
    }
    return null;
  };

  const readPendingMemoryIntents = async (
    row: ClaimedOperationRow,
    memoryId: string,
    versionId: string | null,
    expectedHead: string | null,
  ): Promise<PendingIntentRow[]> =>
    workerDb().withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<PendingIntentRow>(PENDING_MEMORY_INTENTS_SQL, [
        row.tenant_id,
        row.project_id,
        row.id,
        memoryId,
        versionId,
        expectedHead,
      ]),
    );

  const readLatestVersionIntent = async (
    row: ClaimedOperationRow,
    versionId: string,
  ): Promise<PendingIntentRow | null> => {
    const rows = await workerDb().withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<PendingIntentRow>(LATEST_VERSION_INTENT_SQL, [row.tenant_id, row.project_id, versionId]),
    );
    return rows[0] ?? null;
  };

  const readPendingTaskIntents = async (
    row: ClaimedOperationRow,
    taskId: string,
    memoryId: string,
  ): Promise<PendingIntentRow[]> =>
    workerDb().withTenantTransaction(row.tenant_id, (tx) =>
      tx.rows<PendingIntentRow>(PENDING_TASK_INTENTS_SQL, [
        row.tenant_id,
        row.project_id,
        row.id,
        taskId,
        memoryId,
      ]),
    );

  const prepareSourceAppend = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const sourceId = row.intent_source_id;
    if (sourceId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('unsupported_operation_kind', 'This build commits source-backed source.append intents only.'),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const source = (await readSourceFileFacts(row, [sourceId]))[0] ?? null;
    if (source === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('source_missing', 'The source this intent names is not present in the ledger.'),
      };
    }
    if (source.availability !== 'available') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          source.availability === 'deleted' ? 'source_deleted' : 'source_unavailable',
          `The source is ${source.availability}; it cannot be admitted to project memory.`,
        ),
      };
    }
    if (source.visibility !== 'project') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'private_source_not_admitted',
          'Principal-visibility sources are never admitted to project graph memory.',
        ),
      };
    }
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: () => Promise.resolve(null),
        commit: (graph, context) =>
          commitSourceAnchor(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            sourceId,
            sourceDigest: source.digest,
            sourceKind: source.kind,
            requestDigest: context.requestDigest,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
          }),
        diagnose: () => Promise.resolve(null),
      },
    };
  };

  const prepareTaskCreate = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const taskId = row.intent_task_id;
    if (taskId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('invalid_intent', 'A task.create intent must name its task identity.'),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const title = base.payload.title;
    const taskFamily = base.payload.taskFamily;
    const normalizedFamily = typeof taskFamily === 'string' ? taskFamily : null;
    if (typeof title !== 'string' || title.length === 0 || (taskFamily !== null && typeof taskFamily !== 'string')) {
      return { prepared: 'outcome', outcome: refuseIntent('invalid_intent', 'The recorded task payload did not validate.') };
    }
    const derived = canonicalDigest({
      kind: 'task.create',
      projectId: row.project_id,
      title,
      taskFamily: normalizedFamily,
    });
    if (derived !== row.request_digest) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'intent_integrity_mismatch',
          'The recorded intent does not match its request digest; nothing was committed.',
        ),
      };
    }
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: () => Promise.resolve(null),
        commit: (graph, context) =>
          commitTaskCreate(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            tenantId: row.tenant_id,
            projectId: row.project_id,
            taskId,
            title,
            taskFamily: normalizedFamily,
            revision: randomUUID(),
          }),
        diagnose: () => Promise.resolve(null),
      },
    };
  };

  /** Validates a proposal intent and builds guarded commit and dependency checks for its version. */
  const prepareMemoryPropose = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const documentSourceId = row.intent_source_id;
    const memoryId = row.intent_memory_id;
    const versionId = row.intent_version_id;
    if (documentSourceId === null || memoryId === null || versionId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'invalid_intent',
          'A memory.propose intent must name its content source, memory and version.',
        ),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const memoryMode = base.payload.memoryMode;
    if (memoryMode !== 'create' && memoryMode !== 'attach') {
      return { prepared: 'outcome', outcome: refuseIntent('invalid_intent', 'The recorded proposal payload did not validate.') };
    }
    const loaded = await readIntentDocument(row, documentSourceId);
    if (loaded.refusal !== null) {
      return { prepared: 'outcome', outcome: loaded.refusal };
    }
    const { document } = loaded;
    if (document.memoryMode !== memoryMode) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'intent_integrity_mismatch',
          'The captured intent document does not match the recorded proposal mode.',
        ),
      };
    }
    const integrity = verifyMemoryDocument(row, document);
    if (integrity !== null) {
      return { prepared: 'outcome', outcome: integrity };
    }
    if (document.content.kind !== 'semantic' && document.content.kind !== 'procedural') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'unsupported_memory_kind',
          'This build commits semantic and procedural versions through a proposal.',
        ),
      };
    }
    if (document.content.kind === 'procedural') {
      // A proposal can never arrive validated: the state was resolved to
      // `candidate` by admission, and a bare review reference grants nothing.
      if (document.content.procedureState !== 'candidate' || document.content.reviewRef !== null) {
        return {
          prepared: 'outcome',
          outcome: refuseIntent(
            'procedure_state_unavailable',
            'A proposal is admitted as a candidate procedure; validated reuse requires a declared review and compatible reuse that this build does not perform.',
          ),
        };
      }
    }
    const evidenceOutcome = await requireEvidenceAdmissible(row, base.actorPrincipalId, documentSourceId, document.sourceIds);
    if (evidenceOutcome !== null) {
      return { prepared: 'outcome', outcome: evidenceOutcome };
    }
    const pendingRows = await readPendingMemoryIntents(row, memoryId, null, null);
    const projectRootId = projectRootIdFor(row.project_id);
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: async (graph) => {
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (memoryMode === 'create') {
            if (state.memoryExists) {
              return refuseIntent('memory_id_conflict', 'The memory identity already exists in the project graph.');
            }
          } else {
            if (!state.memoryExists) {
              return pendingRows.some((entry) => createsMemory(entry, memoryId))
                ? retryPending(
                    'dependency_pending',
                    'The memory identity is not admitted yet; the proposal that creates it is still pending.',
                  )
                : refuseIntent(
                    'memory_not_available',
                    'The memory identity this proposal attaches to is not present in the project graph.',
                  );
            }
            // A kind change would repoint every task requirement bound to this
            // identity at a different kind of obligation, so it is refused here
            // and again by the commit statement.
            if (state.kind !== document.content.kind) {
              return refuseIntent(
                'memory_kind_change_refused',
                'A proposal may not change the kind of an existing memory identity.',
              );
            }
            if (state.proposedVersionIds.length >= MAX_PROPOSED_CANDIDATES) {
              return refuseIntent(
                'candidate_limit_reached',
                `The memory already holds ${String(MAX_PROPOSED_CANDIDATES)} proposed candidates; a further proposal is refused until one is resolved.`,
              );
            }
          }
          return verifyProcedureSupports(graph, document, versionId, pendingRows);
        },
        commit: (graph, context) =>
          commitMemoryPropose(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            tenantId: row.tenant_id,
            projectId: row.project_id,
            memoryId,
            memoryMode,
            versionId,
            kind: document.content.kind,
            operationKind: row.kind,
            contentJson: JSON.stringify(document.content),
            subtype: document.content.kind === 'semantic' ? document.content.subtype : '',
            statement: summarizeContent(document.content),
            delegation: 'authored',
            evidencePrecision: null,
            acceptance: 'proposed',
            acceptedAtMs: null,
            applicabilityJson: JSON.stringify(document.applicability),
            observedUnderJson: JSON.stringify(document.observedUnder),
            observedAtMs: row.created_at.getTime(),
            originTaskId: document.originTaskId,
            expectedHead: document.expectedHead,
            sourceAnchorIds: document.sourceIds,
            contradictionVersionIds: document.contradictsVersionIds,
            supportVersionIds: supportingVersionIds(document.content),
            candidateCap: MAX_PROPOSED_CANDIDATES,
          }),
        diagnose: async (graph) => {
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (memoryMode === 'attach' && state.memoryExists && state.kind !== document.content.kind) {
            return refuseIntent(
              'memory_kind_change_refused',
              'A proposal may not change the kind of an existing memory identity.',
            );
          }
          if (memoryMode === 'attach' && state.memoryExists && state.proposedVersionIds.length >= MAX_PROPOSED_CANDIDATES) {
            return refuseIntent(
              'candidate_limit_reached',
              `The memory already holds ${String(MAX_PROPOSED_CANDIDATES)} proposed candidates; a further proposal is refused until one is resolved.`,
            );
          }
          if (memoryMode === 'create' && state.memoryExists) {
            return state.proposedVersionIds.includes(versionId)
              ? refuseIntent(
                  'graph_inconsistent',
                  'The project graph holds this version without a receipt; refusing to guess an outcome.',
                )
              : refuseIntent('memory_id_conflict', 'The memory identity already exists in the project graph.');
          }
          const anchorCount = await countSourceAnchors(graph, [documentSourceId, ...document.sourceIds]);
          if (anchorCount < 1 + document.sourceIds.length) {
            return refuseIntent('evidence_anchor_missing', 'A cited source anchor is missing from the project graph.');
          }
          if (document.contradictsVersionIds.length > 0) {
            const found = await countMemoryVersions(graph, document.contradictsVersionIds);
            if (found < document.contradictsVersionIds.length) {
              return refuseIntent(
                'contradiction_target_missing',
                'A declared contradiction target is not present in the project graph.',
              );
            }
          }
          return verifyProcedureSupports(graph, document, versionId, pendingRows);
        },
      },
    };
  };

  const prepareMemoryAccept = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const memoryId = row.intent_memory_id;
    const versionId = row.intent_version_id;
    if (memoryId === null || versionId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('invalid_intent', 'A memory.accept intent must name its memory and version.'),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const reason = typeof base.payload.reason === 'string' ? base.payload.reason : null;
    const expectedHead = row.expected_head_token;
    const derived = canonicalDigest({
      kind: 'memory.accept',
      projectId: row.project_id,
      memoryId,
      versionId,
      expectedCurrentVersionId: expectedHead,
      reason,
    });
    if (derived !== row.request_digest) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'intent_integrity_mismatch',
          'The recorded intent does not match its request digest; nothing was committed.',
        ),
      };
    }
    const pendingRows = await readPendingMemoryIntents(row, memoryId, versionId, expectedHead);
    const versionBeingAdmitted = pendingRows.some((entry) => createsVersion(entry, versionId));
    const memoryBeingAdmitted = pendingRows.some((entry) => createsMemory(entry, memoryId));
    const headBecomesCurrent =
      expectedHead !== null && pendingRows.some((entry) => entry.intent_version_id === expectedHead);
    const latestVersionIntent = await readLatestVersionIntent(row, versionId);
    const projectRootId = projectRootIdFor(row.project_id);
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: async (graph) => {
          const version = await readVersionState(graph, versionId);
          if (version === null) {
            if (versionBeingAdmitted || memoryBeingAdmitted) {
              return retryPending(
                'dependency_pending',
                'The version this acceptance names is not admitted yet; a related intent is still pending.',
              );
            }
            if (latestVersionIntent !== null && latestVersionIntent.state === 'rejected') {
              return refuseIntent(
                'proposal_rejected',
                `The intent that would have admitted this version was refused (${latestVersionIntent.error_code ?? 'rejected'}).`,
              );
            }
            if (latestVersionIntent !== null && latestVersionIntent.state === 'committed') {
              return refuseIntent(
                'version_not_available',
                'The ledger records the version as committed but the project graph does not hold it.',
              );
            }
            return refuseIntent(
              'version_not_available',
              'This acceptance names a version that was never admitted to project graph memory.',
            );
          }
          if (version.memoryId !== memoryId) {
            return refuseIntent('intent_integrity_mismatch', 'The named version belongs to a different memory identity.');
          }
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (!state.memoryExists) {
            return memoryBeingAdmitted
              ? retryPending('dependency_pending', 'The memory identity is not admitted yet; a related intent is still pending.')
              : refuseIntent('memory_not_available', 'The memory identity is not present in the project graph.');
          }
          const currents = [...new Set(state.currentVersionIds)];
          if (currents.length > 1) {
            return refuseIntent('current_head_ambiguous', 'The memory has more than one current version; authority is ambiguous.');
          }
          if (version.acceptance !== 'proposed') {
            if (version.acceptance === 'accepted' && currents.includes(versionId)) {
              return refuseIntent('version_already_current', 'The version is already the accepted current version.');
            }
            return refuseIntent('version_not_proposed', 'Only a proposed version can be newly accepted.');
          }
          const head = currents[0] ?? null;
          if (head !== expectedHead) {
            if (headBecomesCurrent) {
              return retryPending(
                'dependency_pending',
                'Another acceptance or correction is about to make the expected head current; this acceptance waits.',
              );
            }
            return refuseIntent(
              'expected_head_conflict',
              `The memory's current version does not match the expected head; observed ${head ?? 'no current version'}.`,
            );
          }
          return null;
        },
        commit: (graph, context) =>
          commitMemoryAccept(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            memoryId,
            versionId,
            expectedHead,
            reason,
          }),
        diagnose: async (graph) => {
          const version = await readVersionState(graph, versionId);
          if (version === null) {
            return refuseIntent('version_not_available', 'The version disappeared before the commit could be confirmed.');
          }
          const state = await readMemoryState(graph, projectRootId, memoryId);
          const currents = [...new Set(state.currentVersionIds)];
          if (version.acceptance !== 'proposed') {
            if (version.acceptance === 'accepted' && currents.includes(versionId)) {
              return refuseIntent(
                'expected_head_conflict',
                'Another acceptance made the version current first; this operation lost the race and wrote nothing.',
              );
            }
            return refuseIntent('version_not_proposed', 'Only a proposed version can be newly accepted.');
          }
          if (currents.length > 1) {
            return refuseIntent('current_head_ambiguous', 'The memory has more than one current version; authority is ambiguous.');
          }
          const head = currents[0] ?? null;
          if (head !== expectedHead) {
            if (headBecomesCurrent) {
              return retryPending(
                'dependency_pending',
                'Another acceptance or correction is about to make the expected head current; this acceptance waits.',
              );
            }
            return refuseIntent(
              'expected_head_conflict',
              `The memory's current version does not match the expected head; observed ${head ?? 'no current version'}.`,
            );
          }
          return null;
        },
      },
    };
  };

  /** Validates a correction intent and builds a commit plan guarded by its expected current version. */
  const prepareMemoryCorrect = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const documentSourceId = row.intent_source_id;
    const memoryId = row.intent_memory_id;
    const versionId = row.intent_version_id;
    if (documentSourceId === null || memoryId === null || versionId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'invalid_intent',
          'A memory.correct intent must name its content source, memory and version.',
        ),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const loaded = await readIntentDocument(row, documentSourceId);
    if (loaded.refusal !== null) {
      return { prepared: 'outcome', outcome: loaded.refusal };
    }
    const { document } = loaded;
    const expectedHead = document.expectedHead;
    const reason = document.reason;
    if (document.memoryMode !== 'attach' || expectedHead === null || reason === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('invalid_intent', 'A correction must name the head it supersedes and its reason.'),
      };
    }
    const integrity = verifyMemoryDocument(row, document);
    if (integrity !== null) {
      return { prepared: 'outcome', outcome: integrity };
    }
    if (document.content.kind !== 'semantic' && document.content.kind !== 'procedural') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'unsupported_memory_kind',
          'This build corrects semantic and procedural versions; an episode is a record of what happened and is never revised.',
        ),
      };
    }
    const evidenceOutcome = await requireEvidenceAdmissible(row, base.actorPrincipalId, documentSourceId, document.sourceIds);
    if (evidenceOutcome !== null) {
      return { prepared: 'outcome', outcome: evidenceOutcome };
    }
    const pendingRows = await readPendingMemoryIntents(row, memoryId, versionId, expectedHead);
    const memoryBeingAdmitted = pendingRows.some((entry) => createsMemory(entry, memoryId));
    const headBecomesCurrent = pendingRows.some((entry) => entry.intent_version_id === expectedHead);
    const projectRootId = projectRootIdFor(row.project_id);
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: async (graph) => {
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (state.memoryExists && state.kind !== document.content.kind) {
            // Refused here and again by the commit statement. A correction that
            // changed the kind would silently repoint every task requirement
            // bound to this identity at a different kind of obligation.
            return refuseIntent(
              'memory_kind_change_refused',
              'A correction may not change the kind of a memory identity; supersede it and propose a new one instead.',
            );
          }
          if (!state.memoryExists) {
            return memoryBeingAdmitted
              ? retryPending('dependency_pending', 'The memory identity is not admitted yet; a related intent is still pending.')
              : refuseIntent('memory_not_available', 'The memory identity is not present in the project graph.');
          }
          const currents = [...new Set(state.currentVersionIds)];
          if (currents.length > 1) {
            return refuseIntent('current_head_ambiguous', 'The memory has more than one current version; authority is ambiguous.');
          }
          const head = currents[0] ?? null;
          if (head !== expectedHead) {
            if (headBecomesCurrent) {
              return retryPending(
                'dependency_pending',
                'Another acceptance or correction is about to make the expected head current; this correction waits.',
              );
            }
            return refuseIntent(
              'expected_head_conflict',
              `The memory's current version does not match the expected head; observed ${head ?? 'no current version'}.`,
            );
          }
          if (state.proposedVersionIds.includes(versionId)) {
            return refuseIntent('version_id_conflict', 'The correction version identity already exists in the project graph.');
          }
          return verifyProcedureSupports(graph, document, versionId, pendingRows);
        },
        commit: (graph, context) =>
          commitMemoryCorrect(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            tenantId: row.tenant_id,
            projectId: row.project_id,
            memoryId,
            versionId,
            expectedHead,
            kind: document.content.kind,
            contentJson: JSON.stringify(document.content),
            subtype: document.content.kind === 'semantic' ? document.content.subtype : '',
            statement: summarizeContent(document.content),
            delegation: 'authored',
            evidencePrecision: null,
            applicabilityJson: JSON.stringify(document.applicability),
            observedUnderJson: JSON.stringify(document.observedUnder),
            observedAtMs: row.created_at.getTime(),
            originTaskId: document.originTaskId,
            reason,
            sourceAnchorIds: document.sourceIds,
            contradictionVersionIds: document.contradictsVersionIds,
            supportVersionIds: supportingVersionIds(document.content),
          }),
        diagnose: async (graph) => {
          const version = await readVersionState(graph, versionId);
          if (version !== null) {
            return refuseIntent(
              'graph_inconsistent',
              'The project graph holds the correction version without a receipt; refusing to guess an outcome.',
            );
          }
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (!state.memoryExists) {
            return refuseIntent('memory_not_available', 'The memory identity is not present in the project graph.');
          }
          const currents = [...new Set(state.currentVersionIds)];
          if (currents.length > 1) {
            return refuseIntent('current_head_ambiguous', 'The memory has more than one current version; authority is ambiguous.');
          }
          const head = currents[0] ?? null;
          if (head !== expectedHead) {
            if (headBecomesCurrent) {
              return retryPending(
                'dependency_pending',
                'Another acceptance or correction is about to make the expected head current; this correction waits.',
              );
            }
            return refuseIntent(
              'expected_head_conflict',
              `The memory's current version does not match the expected head; observed ${head ?? 'no current version'}.`,
            );
          }
          const anchorCount = await countSourceAnchors(graph, [documentSourceId, ...document.sourceIds]);
          if (anchorCount < 1 + document.sourceIds.length) {
            return refuseIntent('evidence_anchor_missing', 'A cited source anchor is missing from the project graph.');
          }
          if (document.contradictsVersionIds.length > 0) {
            const found = await countMemoryVersions(graph, document.contradictsVersionIds);
            if (found < document.contradictsVersionIds.length) {
              return refuseIntent(
                'contradiction_target_missing',
                'A declared contradiction target is not present in the project graph.',
              );
            }
          }
          return verifyProcedureSupports(graph, document, versionId, pendingRows);
        },
      },
    };
  };

  /**
   * Delivers one recorded episode.
   *
   * The plan is the proposal plan with two differences that are decided by this
   * service rather than by the request: the identity is always new, because an
   * episode is a record of what happened and is never proposed onto an existing
   * identity; and the delegation marker follows the evidence precision the
   * delivery re-derived above. A caller-supplied outcome or Source kind buys
   * nothing here — the outcome recorded is the outcome that was asserted, and the
   * precision recorded is the precision the evidence admitted.
   */
  const prepareEpisodeRecord = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const documentSourceId = row.intent_source_id;
    const memoryId = row.intent_memory_id;
    const versionId = row.intent_version_id;
    if (documentSourceId === null || memoryId === null || versionId === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'invalid_intent',
          'A memory.episode.record intent must name its content source, memory and version.',
        ),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    if (base.payload.memoryMode !== 'create') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('invalid_intent', 'An episode always records a new memory identity.'),
      };
    }
    const loaded = await readIntentDocument(row, documentSourceId);
    if (loaded.refusal !== null) {
      return { prepared: 'outcome', outcome: loaded.refusal };
    }
    const { document } = loaded;
    if (document.memoryMode !== 'create') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'intent_integrity_mismatch',
          'The captured intent document does not record a new episode identity.',
        ),
      };
    }
    const integrity = verifyMemoryDocument(row, document);
    if (integrity !== null) {
      return { prepared: 'outcome', outcome: integrity };
    }
    if (document.content.kind !== 'episodic') {
      return {
        prepared: 'outcome',
        outcome: refuseIntent('invalid_intent', 'An episode intent must carry episodic content.'),
      };
    }
    // The ordinary evidence gate runs first on purpose: a cited source whose
    // admission is still pending is a temporary wait, and judging its evidence
    // classification before that is known would refuse a real wait as invalid.
    const evidenceOutcome = await requireEvidenceAdmissible(row, base.actorPrincipalId, documentSourceId, document.sourceIds);
    if (evidenceOutcome !== null) {
      return { prepared: 'outcome', outcome: evidenceOutcome };
    }
    const precision = await verifyEpisodeEvidence(row, document, base.actorPrincipalId);
    if (precision !== null) {
      return { prepared: 'outcome', outcome: precision };
    }
    // Bound before the plan closures: the commit runs long after this frame's
    // narrowing would have been lost, so the checked form is captured here.
    const episode = document.content;
    const projectRootId = projectRootIdFor(row.project_id);
    const observed = document.content.evidencePrecision === 'observed';
    const delegation = observed ? 'observed' : 'authored';
    // A deterministic observed episode is proposal-free: its evidence passed
    // every eligibility check, so it is admitted as current rather than waiting
    // on an acceptance that would add nothing. An authored episode is a report
    // and stays a candidate until a human accepts it.
    const acceptance = observed ? 'accepted' : 'proposed';
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: async (graph) => {
          const state = await readMemoryState(graph, projectRootId, memoryId);
          return state.memoryExists
            ? refuseIntent('memory_id_conflict', 'The episode identity already exists in the project graph.')
            : null;
        },
        commit: (graph, context) =>
          commitMemoryPropose(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            tenantId: row.tenant_id,
            projectId: row.project_id,
            memoryId,
            memoryMode: 'create',
            versionId,
            kind: 'episodic',
            operationKind: row.kind,
            contentJson: JSON.stringify(episode),
            subtype: '',
            statement: episode.action,
            delegation,
            evidencePrecision: episode.evidencePrecision,
            acceptance,
            acceptedAtMs: acceptance === 'accepted' ? context.nowMs() : null,
            applicabilityJson: JSON.stringify(document.applicability),
            observedUnderJson: JSON.stringify(document.observedUnder),
            observedAtMs: row.created_at.getTime(),
            originTaskId: document.originTaskId,
            expectedHead: null,
            sourceAnchorIds: document.sourceIds,
            contradictionVersionIds: [],
            supportVersionIds: [],
            candidateCap: MAX_PROPOSED_CANDIDATES,
          }),
        diagnose: async (graph) => {
          // Ask about this version before asking about the identity: an observed
          // episode commits as accepted, so a version present here is this
          // operation's own effect without a receipt, not a foreign identity.
          const version = await readVersionState(graph, versionId);
          if (version !== null) {
            return refuseIntent(
              'graph_inconsistent',
              'The project graph holds this episode version without a receipt; refusing to guess an outcome.',
            );
          }
          const state = await readMemoryState(graph, projectRootId, memoryId);
          if (state.memoryExists) {
            return refuseIntent('memory_id_conflict', 'The episode identity already exists in the project graph.');
          }
          const anchorCount = await countSourceAnchors(graph, [documentSourceId, ...document.sourceIds]);
          return anchorCount < 1 + document.sourceIds.length
            ? refuseIntent('evidence_anchor_missing', 'A cited source anchor is missing from the project graph.')
            : null;
        },
      },
    };
  };

  /** Validates a requirement intent and plans a revision-guarded binding to a semantic memory identity. */
  const prepareTaskRequire = async (row: ClaimedOperationRow): Promise<Preparation> => {
    const taskId = row.intent_task_id;
    const memoryId = row.intent_memory_id;
    const expectedRevision = row.expected_task_revision;
    if (taskId === null || memoryId === null || expectedRevision === null) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'invalid_intent',
          'A task.require intent must name its task, memory and expected task revision.',
        ),
      };
    }
    const base = await loadBaseFacts(row);
    if (base.refusal !== null) {
      return { prepared: 'outcome', outcome: base.refusal };
    }
    const derived = canonicalDigest({
      kind: 'task.require',
      projectId: row.project_id,
      taskId,
      memoryId,
      expectedTaskRevision: expectedRevision,
    });
    if (derived !== row.request_digest) {
      return {
        prepared: 'outcome',
        outcome: refuseIntent(
          'intent_integrity_mismatch',
          'The recorded intent does not match its request digest; nothing was committed.',
        ),
      };
    }
    const pendingRows = await readPendingTaskIntents(row, taskId, memoryId);
    const taskBeingCreated = pendingRows.some((entry) => createsTask(entry, taskId));
    const memoryBeingAdmitted = pendingRows.some((entry) => createsMemory(entry, memoryId));
    const projectRootId = projectRootIdFor(row.project_id);
    return {
      prepared: 'plan',
      plan: {
        project: base.project,
        actorPrincipalId: base.actorPrincipalId,
        precheck: async (graph) => {
          const state = await readTaskState(graph, projectRootId, taskId);
          if (!state.taskExists) {
            return taskBeingCreated
              ? retryPending('dependency_pending', 'The task is not created yet; its create intent is still pending.')
              : refuseIntent('task_not_available', 'The task is not present in the project graph.');
          }
          if (state.revision !== expectedRevision) {
            return refuseIntent(
              'task_revision_conflict',
              'The task revision advanced past the expected revision; another writer won.',
            );
          }
          if (state.state !== 'open') {
            return refuseIntent('task_closed', 'The task is closed; new requirements are refused.');
          }
          if (state.requiredMemoryIds.includes(memoryId)) {
            return refuseIntent('requirement_already_bound', 'The task already requires this memory identity.');
          }
          if (state.requiredMemoryIds.length >= MAX_TASK_REQUIREMENTS) {
            return refuseIntent(
              'requirement_limit_reached',
              `The task already holds ${String(MAX_TASK_REQUIREMENTS)} requirements; a further binding is refused.`,
            );
          }
          const memory = await readMemoryState(graph, projectRootId, memoryId);
          if (!memory.memoryExists) {
            return memoryBeingAdmitted
              ? retryPending('dependency_pending', 'The memory identity is not admitted yet; a related intent is still pending.')
              : refuseIntent('memory_not_available', 'The memory identity is not present in the project graph.');
          }
          // Only an obligation may govern a task. An episode is a record of what
          // happened and a procedure is advice; binding either one would let
          // history or a suggestion stand in for a requirement.
          if (memory.kind !== OBLIGATION_MEMORY_KIND) {
            return refuseIntent(
              'requirement_kind_unsuitable',
              `A task requirement binds a ${OBLIGATION_MEMORY_KIND} obligation; this memory is a ${memory.kind ?? 'unknown'} record.`,
            );
          }
          return null;
        },
        commit: (graph, context) =>
          commitTaskRequire(graph, {
            projectRootId: context.projectRootId,
            graphEpoch: context.graphEpoch,
            privacyRevision: context.privacyRevision,
            writeGeneration: context.writeGeneration,
            receiptId: context.receiptId,
            eventIdPrefix: context.eventIdPrefix,
            operationId: context.operationId,
            requestDigest: context.requestDigest,
            actorPrincipalId: context.actorPrincipalId,
            nowMs: context.nowMs(),
            graphSchemaVersion: context.graphSchemaVersion,
            taskId,
            memoryId,
            expectedTaskRevision: expectedRevision,
            newRevision: randomUUID(),
            maxRequirements: MAX_TASK_REQUIREMENTS,
            obligationKind: OBLIGATION_MEMORY_KIND,
          }),
        diagnose: async (graph) => {
          const state = await readTaskState(graph, projectRootId, taskId);
          if (!state.taskExists) {
            return refuseIntent('task_not_available', 'The task is not present in the project graph.');
          }
          if (state.revision !== expectedRevision) {
            return refuseIntent(
              'task_revision_conflict',
              'The task revision advanced past the expected revision; another writer won.',
            );
          }
          if (state.requiredMemoryIds.includes(memoryId)) {
            return refuseIntent('requirement_already_bound', 'The task already requires this memory identity.');
          }
          const memory = await readMemoryState(graph, projectRootId, memoryId);
          if (memory.memoryExists && memory.kind !== OBLIGATION_MEMORY_KIND) {
            return refuseIntent(
              'requirement_kind_unsuitable',
              `A task requirement binds a ${OBLIGATION_MEMORY_KIND} obligation; this memory is a ${memory.kind ?? 'unknown'} record.`,
            );
          }
          return null;
        },
      },
    };
  };

  /** Dispatches a durable intent to its operation-specific planner, refusing unsupported kinds. */
  const prepareDelivery = async (row: ClaimedOperationRow): Promise<Preparation> => {
    switch (row.kind) {
      case 'source.append':
        return prepareSourceAppend(row);
      case 'task.create':
        return prepareTaskCreate(row);
      case 'memory.propose':
        return prepareMemoryPropose(row);
      case 'memory.accept':
        return prepareMemoryAccept(row);
      case 'memory.correct':
        return prepareMemoryCorrect(row);
      case 'memory.episode.record':
        return prepareEpisodeRecord(row);
      case 'task.require':
        return prepareTaskRequire(row);
      default:
        return {
          prepared: 'outcome',
          outcome: refuseIntent('unsupported_operation_kind', `This build cannot commit ${row.kind} intents.`),
        };
    }
  };

  const renewLease = async (row: ClaimedOperationRow, leaseToken: string): Promise<boolean> => {
    const updated = await workerDb().withTenantTransaction(row.tenant_id, (tx) =>
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

  /** Only server-attested safe creations become releasable; acceptance never
   * upgrades the provenance of an old memory identity or version. */
  const qualifySafeCreation = async (tx: TxClient, row: ClaimedOperationRow): Promise<void> => {
    if (!['memory.propose', 'memory.correct', 'memory.episode.record', 'task.create'].includes(row.kind)) return;
    await tx.rows(
      `INSERT INTO threadline_memory.release_safety
         (tenant_id, project_id, resource_kind, resource_id, state, sanitizer_version)
       SELECT o.tenant_id, o.project_id, resources.kind, resources.id, 'eligible', $5
         FROM threadline_memory.operations o
         JOIN threadline_memory.ingress_admissions a
           ON ${QUALIFIED_OPERATION_ADMISSION_SQL}
         LEFT JOIN threadline_memory.sources s
           ON s.tenant_id = o.tenant_id AND s.project_id = o.project_id AND s.id = o.intent_source_id
         CROSS JOIN LATERAL (
           SELECT 'version'::text AS kind, o.intent_version_id AS id
             WHERE o.kind IN ('memory.propose', 'memory.correct', 'memory.episode.record')
           UNION ALL
           SELECT 'memory'::text, o.intent_memory_id
             WHERE o.kind IN ('memory.propose', 'memory.episode.record') AND o.payload->>'memoryMode' = 'create'
           UNION ALL
           SELECT 'task'::text, o.intent_task_id
             WHERE o.kind = 'task.create'
         ) resources
        WHERE o.tenant_id = $1 AND o.project_id = $2 AND o.id = $3 AND o.state = 'committed'
          AND resources.id IS NOT NULL
          AND ((o.kind = 'task.create' AND o.payload->>'serverSafeIngress' = $5)
            OR (o.kind <> 'task.create' AND s.release_state = 'eligible' AND s.sanitizer_version = $5))
       ON CONFLICT (tenant_id, project_id, resource_kind, resource_id) DO NOTHING`,
      [row.tenant_id, row.project_id, row.id, ...QUALIFIED_ADMISSION_PARAMETERS]);
  };

  const settleCommitted = async (
    row: ClaimedOperationRow,
    leaseToken: string,
    eventSeq: DecimalString,
    outcome: string,
    committedAtMs: number,
  ): Promise<void> => {
    const updated = await settlementTransaction(row, async (tx) => {
      const settled = await tx.rows<{ id: string }>(
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
      );
      if (settled.length === 1) await qualifySafeCreation(tx, row);
      return settled;
    });
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
    const updated = await settlementTransaction(row, (tx) =>
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
    const updated = await settlementTransaction(row, (tx) =>
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

  const settleOutcome = async (
    row: ClaimedOperationRow,
    leaseToken: string,
    outcome: PlanOutcome,
  ): Promise<void> => {
    if (outcome.type === 'refuse') {
      await settleRefused(row, leaseToken, outcome.code, outcome.detail);
      return;
    }
    await retry(row, leaseToken, outcome.code, outcome.nextState, outcome.detail);
  };

  const recordError = (scope: string, error: unknown, fields?: Record<string, unknown>): void => {
    lastErrorCode = scope;
    logger.log({
      level: 'error',
      message: 'Operation worker error.',
      fields: {
        scope,
        errorName: error instanceof Error ? error.name : typeof error,
        ...fields,
      },
    });
  };

  /** Reports worker backlog and activity, requiring a connected graph and a recent successful probe for reachability. */
  const status = (): OperationWorkerStatus => {
    const nowMs = clock().getTime();
    // Never promote an old success while graph work/probing is stalled.
    const reachable = graphReachable && deps.graphStore.connected &&
      nowMs - graphProbedAtMs <= GRAPH_PROBE_TTL_MS + COMMAND_PROBE_GRACE_MS;
    const parts = [
      `Leased worker ${running ? 'running' : 'stopped'}: ${String(backlog.pending)} pending, ${String(backlog.leased)} leased, ${String(backlog.ambiguous)} ambiguous`,
    ];
    if (backlog.oldestPendingAtMs !== null) {
      parts.push(`oldest pending ${String(Math.round((nowMs - backlog.oldestPendingAtMs) / 1000))}s`);
    }
    if (inFlight.size > 0) {
      parts.push(`${String(inFlight.size)} in flight`);
    }
    if (!reachable) {
      parts.push('graph probe failing');
    }
    if (lastErrorCode !== null) {
      parts.push(`last error ${lastErrorCode}`);
    }
    return {
      running,
      workerId: running ? workerId : null,
      graphReachable: reachable,
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

export function createOperationService(deps: { readonly db: SqlDatabase; readonly policies: PolicyService }): OperationService {
  const policies = deps.policies;
  return {
    async inspect(call, projectId, operationId): Promise<OperationView> {
      requirePermission(call, 'read');
      if (call.scope.projectId !== projectId) throw new ThreadlineError('scope_denied', 'The credential is not scoped to that project.');
      const rows = await deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        const policy=await policies.current(call.scope.tenantId,projectId,tx);
        requirePolicyPermission(policy,call,'recall');
        if (!await hasOperationAdmission(tx, call.scope.tenantId, projectId, operationId)) {
          throw new ThreadlineError('not_found', 'The requested resource does not exist.');
        }
        const rows=await tx.rows<OperationInspectRow & {payload:unknown}>(
          `SELECT id, project_id, kind, state, request_digest, attempts, payload,
                  created_at, settled_at, error_code,
                  receipt_graph_epoch, receipt_event_seq, receipt_outcome, receipt_committed_at
             FROM threadline_memory.operations
            WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
          [call.scope.tenantId, projectId, operationId],
        );
        try {
          for(const row of rows) {
            assertSafeAdmissionInput(row.payload,{revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths});
            assertPolicyInputLimits(row.payload,{maxPayloadBytes:policy.settings.ceilings.max_payload_bytes,maxBatchRecords:policy.settings.ceilings.max_batch_records});
          }
        } catch {throw new ThreadlineError('not_found','The requested resource does not exist.');}
        return rows;
      });
      const row = rows[0];
      if (row === undefined) {
        throw new ThreadlineError('not_found', 'The requested resource does not exist.');
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
  readonly intent_memory_id: string | null;
  readonly intent_version_id: string | null;
  readonly intent_task_id: string | null;
  readonly expected_head_token: string | null;
  readonly expected_task_revision: string | null;
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

interface SourceFileFactsRow {
  readonly id: string;
  readonly kind: string;
  readonly digest: string;
  readonly byte_size: string;
  readonly storage_key: string;
  readonly availability: string;
  readonly visibility: string;
}

interface EvidenceFactsRow {
  readonly id: string;
  readonly availability: string;
  readonly visibility: string;
}

interface AnchorStateRow {
  readonly id: string;
  readonly state: string;
  readonly error_code: string | null;
}

interface EpisodeEvidenceRow {
  readonly id: string;
  readonly kind: string;
  readonly completeness: string;
  readonly availability: string;
  readonly visibility: string;
  readonly producer_kind: string;
  readonly producer_principal_id: string;
  readonly anchor_state: string | null;
}

interface PendingIntentRow {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
  readonly intent_memory_id: string | null;
  readonly intent_version_id: string | null;
  readonly intent_task_id: string | null;
  readonly expected_head_token: string | null;
  readonly error_code: string | null;
  /** Only `memory.propose`/`memory.correct` record one; `create` mints the identity. */
  readonly memory_mode: string | null;
}

/**
 * Who can create a missing node, and who cannot.
 *
 * A wait is only honest when the intent it waits for can actually produce the
 * missing identity. Anything else — another attach proposal, an acceptance, a
 * correction, another task's requirement — can never create that node, so
 * counting it turns two mutually waiting intents into a permanent `pending`
 * backlog that never settles. The rule is therefore: wait only on an intent
 * whose own commit creates the identity in question.
 */
const createsMemory = (entry: PendingIntentRow, memoryId: string): boolean =>
  (entry.kind === 'memory.propose' || entry.kind === 'memory.episode.record') &&
  entry.memory_mode === 'create' &&
  entry.intent_memory_id === memoryId;

/** Identifies pending intents capable of creating the requested memory version. */
const createsVersion = (entry: PendingIntentRow, versionId: string): boolean =>
  (entry.kind === 'memory.propose' ||
    entry.kind === 'memory.correct' ||
    entry.kind === 'memory.episode.record') &&
  entry.intent_version_id === versionId;

const createsTask = (entry: PendingIntentRow, taskId: string): boolean =>
  entry.kind === 'task.create' && entry.intent_task_id === taskId;

/**
 * Every dependency lookup names the identity the dependent intent concerns, so
 * it stays an indexed, bounded probe rather than a scan of the operation log.
 */
const DEPENDENCY_SELECT = `SELECT id, kind, state,
         intent_memory_id::text AS intent_memory_id,
         intent_version_id::text AS intent_version_id,
         intent_task_id::text AS intent_task_id,
         expected_head_token, error_code,
         payload->>'memoryMode' AS memory_mode
    FROM threadline_memory.operations`;

const PENDING_MEMORY_INTENTS_SQL = `${DEPENDENCY_SELECT}
   WHERE tenant_id = $1 AND project_id = $2 AND id <> $3
     AND kind IN ('memory.propose', 'memory.accept', 'memory.correct', 'memory.episode.record')
     AND state IN ('pending', 'leased', 'ambiguous')
     AND (intent_memory_id = $4
          OR ($5::uuid IS NOT NULL AND intent_version_id = $5)
          OR ($6::uuid IS NOT NULL AND intent_version_id = $6))`;

const LATEST_VERSION_INTENT_SQL = `${DEPENDENCY_SELECT}
   WHERE tenant_id = $1 AND project_id = $2 AND intent_version_id = $3
   ORDER BY created_at DESC, id ASC
   LIMIT 1`;

const PENDING_TASK_INTENTS_SQL = `${DEPENDENCY_SELECT}
   WHERE tenant_id = $1 AND project_id = $2 AND id <> $3
     AND kind IN ('task.create', 'task.require', 'memory.propose', 'memory.correct', 'memory.episode.record')
     AND state IN ('pending', 'leased', 'ambiguous')
     AND (intent_task_id = $4 OR intent_memory_id = $5)`;

interface PlanOutcomeRefuse {
  readonly type: 'refuse';
  readonly code: string;
  readonly detail: string;
}

interface PlanOutcomeRetry {
  readonly type: 'retry';
  readonly code: string;
  readonly detail: string;
  readonly nextState: 'pending' | 'ambiguous';
}

type PlanOutcome = PlanOutcomeRefuse | PlanOutcomeRetry;

interface CommitTimeContext {
  readonly projectRootId: string;
  readonly graphEpoch: string;
  readonly writeGeneration: DecimalString;
  readonly privacyRevision: string;
  readonly receiptId: string;
  readonly eventIdPrefix: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly actorPrincipalId: string;
  readonly nowMs: () => number;
  readonly graphSchemaVersion: number;
}

interface DeliveryPlan {
  readonly project: ProjectFactRow;
  readonly actorPrincipalId: string;
  readonly precheck: (graph: Graph, context: CommitTimeContext) => Promise<PlanOutcome | null>;
  readonly commit: (graph: Graph, context: CommitTimeContext) => Promise<DecimalString | null>;
  readonly diagnose: (graph: Graph, context: CommitTimeContext) => Promise<PlanOutcome | null>;
}

type Preparation =
  | { readonly prepared: 'outcome'; readonly outcome: PlanOutcome }
  | { readonly prepared: 'plan'; readonly plan: DeliveryPlan };

/**
 * The bounded summary a version carries beside its full content.
 *
 * A focused read matches against this, so it is the shortest honest description
 * of the version: the statement for a semantic requirement, the goal for a
 * procedure. It is never a copy of the version and never a summary of evidence.
 */
function summarizeContent(content: MemoryContent): string {
  switch (content.kind) {
    case 'semantic':
      return content.statement;
    case 'procedural':
      return content.goal;
    case 'episodic':
      return content.action;
    default:
      return content.objective;
  }
}

/** The episode versions a stored content cites as supporting reuse. */
function supportingVersionIds(content: MemoryContent): readonly string[] {
  return content.kind === 'procedural' ? content.supportedBy : [];
}

function refuseIntent(code: string, detail: string): PlanOutcomeRefuse {
  return { type: 'refuse', code, detail };
}

function retryPending(code: string, detail: string): PlanOutcomeRetry {
  return { type: 'retry', code, detail, nextState: 'pending' };
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

/** Classifies constraint and connection errors; other failures retain an ambiguous commit outcome. */
function classifyGraphFailure(error: unknown): 'constraint' | 'not_submitted' | 'ambiguous' {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/constraint/i.test(text)) {
    return 'constraint';
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|ClientOfflineError|ClientClosedError|Connection is closed|Connection refused/i.test(text)) {
    return 'not_submitted';
  }
  return 'ambiguous';
}

function exactReceipt(
  row: ClaimedOperationRow,
  receipt: OperationReceiptView | null,
): receipt is OperationReceiptView & { eventSeq: DecimalString; outcome: string; committedAtMs: number } {
  return receipt !== null && receipt.operationId === row.id &&
    receipt.graphEpoch === row.graph_epoch && receipt.requestDigest === row.request_digest &&
    receipt.eventSeq !== null && receipt.outcome === 'committed' && receipt.committedAtMs !== null;
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
