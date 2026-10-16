import {
  ThreadlineError,
  type CaptureOutboxService,
  type QuarantinedOperation,
  type SourceReader,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { SqlDatabase, TxClient } from './pg.js';

/**
 * SQL-to-graph delivery for captured evidence.
 *
 * The design point is that **nothing is retried blindly**. The development
 * profile allows an automatic retry only for a known no-effect outcome; an
 * ambiguous result must reconcile first, because a graph write whose
 * acknowledgement was lost may well have committed. Retrying an ambiguous write
 * is how a duplicate Source or a forked episode appears.
 *
 * The deliverer is injected rather than hard-wired, because the graph admission
 * it calls is a separate concern and because leasing, expiry, backoff and
 * exhaustion must be testable without a graph at all.
 */

/** Resolved from the development profile rather than chosen here. */
export interface OutboxProfile {
  readonly leaseMs: number;
  readonly pollMs: number;
  readonly retryBackoffMs: readonly number[];
  readonly maxAttempts: number;
  readonly batchSize: number;
  readonly deliveryTimeoutMs: number;
}

export const DEVELOPMENT_OUTBOX_PROFILE: OutboxProfile = {
  leaseMs: 30_000,
  pollMs: 250,
  retryBackoffMs: [250, 1_000, 2_000],
  maxAttempts: 3,
  batchSize: 100,
  deliveryTimeoutMs: 2000,
};

export interface OutboxDelivery {
  readonly tenantId: string;
  readonly projectId: string;
  readonly operationId: string;
  readonly captureEventId: string;
  readonly sourceKey: string;
  readonly requestDigest: string;
  readonly agentSessionId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly graphEpoch: string;
}

export type DeliveryOutcome =
  /** The graph committed and reported where it landed. */
  | { readonly kind: 'committed'; readonly graphEventSeq: number }
  /**
   * A known no-effect failure: safe to retry on the profile's backoff.
   */
  | { readonly kind: 'failed'; readonly code: string }
  /**
   * An ambiguous result. The write may or may not have committed, so it must be
   * reconciled against its receipt before any retry. A blind retry here is what
   * duplicates provenance.
   */
  | { readonly kind: 'ambiguous'; readonly code: string }
  /** Reconciled: the write had committed after all. */
  | { readonly kind: 'already_committed'; readonly graphEventSeq: number };

export type Deliverer = (delivery: OutboxDelivery) => Promise<DeliveryOutcome>;

export interface OutboxDeps {
  readonly db: SqlDatabase;
  /**
   * The tenant this worker delivers for.
   *
   * Scoped deliberately. Enumerating tenants would need a connection that
   * escapes the row-level tenant fence, and this backend serves exactly one
   * local bootstrap tenant anyway.
   */
  readonly tenantId: string;
  readonly clock: () => Date;
  readonly deliver: Deliverer;
  readonly profile?: OutboxProfile;
  readonly logger?: Logger;
  /** Injected so shutdown can be bounded in tests. */
  readonly schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  project_id: string;
  operation_id: string;
  request_digest: string;
  capture_event_id: string;
  attempts: number;
  agent_session_id: string;
  source_key: string;
  kind: string;
  payload: unknown;
  graph_epoch: string | null;
  lease_owner: string;
}

export interface CaptureOutbox extends CaptureOutboxService {
  /** Runs one drain. Exposed so tests need no timer. */
  drain(ownerId: string): Promise<{ claimed: number; committed: number; quarantined: number }>;
  /** Starts background polling. Returns once started. */
  start(ownerId: string): void;
  /** Reconciles ambiguous outcomes. Graph admission supplies the reconciler. */
  readonly profile: OutboxProfile;
}

export function createCaptureOutbox(deps: OutboxDeps): CaptureOutbox {
  const logger = deps.logger ?? silentLogger;
  const profile = deps.profile ?? DEVELOPMENT_OUTBOX_PROFILE;
  const clock = deps.clock;

  /**
   * Claims a bounded batch under lease.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe: two workers
   * never claim the same row, and neither blocks waiting for the other. The
   * claim and the lease are one transaction, so a crash after claiming still
   * expires on its own and leaves nothing invisible.
   */
  const claimBatch = async (tenantId: string, ownerId: string): Promise<OutboxRow[]> => {
    return deps.db.withTenantTransaction(tenantId, async (tx) => {
      // Claim and lease in one statement, under a row lock, skipping rows another
      // worker already holds. Nothing is visible as `leased` without also
      // having a lease deadline.
      const claimed = await tx.rows<{ id: string }>(
        `WITH claimable AS (
           SELECT o.id
             FROM threadline.capture_outbox o
            WHERE o.tenant_id = $1
              AND o.status = 'pending'
              AND o.next_attempt_at <= $2::timestamptz
              AND o.attempts < $3
            ORDER BY o.next_attempt_at ASC, o.created_at ASC
            LIMIT $4
            FOR UPDATE SKIP LOCKED
         )
         UPDATE threadline.capture_outbox o
            SET status = 'leased',
                lease_owner = $5,
                lease_expires_at = $2::timestamptz + ($6 || ' milliseconds')::interval,
                attempts = o.attempts + 1
           FROM claimable
          WHERE o.id = claimable.id
        RETURNING o.id`,
        [tenantId, clock(), profile.maxAttempts, profile.batchSize, ownerId, String(profile.leaseMs)],
      );
      if (claimed.length === 0) {
        return [];
      }
      // Captured payload lives on the capture row; the outbox row only carries
      // delivery state.
      return tx.rows<OutboxRow>(
        `SELECT o.id, o.tenant_id, o.project_id, o.operation_id, o.request_digest,
                o.capture_event_id, o.attempts, o.graph_epoch, o.lease_owner,
                c.agent_session_id, c.source_key, c.kind, c.payload
           FROM threadline.capture_outbox o
           JOIN threadline.capture_events c
             ON c.tenant_id = o.tenant_id AND c.id = o.capture_event_id
          WHERE o.tenant_id = $1 AND o.id = ANY($2::uuid[])
          ORDER BY c.capture_seq ASC`,
        [tenantId, claimed.map((row) => row.id)],
      );
    });
  };

  /**
   * Records a committed delivery.
   *
   * The epoch is read from the project rather than taken from the caller,
   * because the outbox row carries none: it records *where in which epoch* the
   * evidence landed, and that is a fact about the project, not an input.
   */
  const markCommitted = async (tenantId: string, row: OutboxRow, graphEventSeq: number): Promise<void> => {
    await deps.db.withTenantTransaction(tenantId, (tx) =>
      tx.rows(
        `UPDATE threadline.capture_outbox o
            SET status = 'committed',
                graph_event_seq = $2,
                graph_epoch = COALESCE(o.graph_epoch,p.graph_epoch),
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = NULL
           FROM threadline.projects p
          WHERE o.tenant_id = $1 AND o.id = $3 AND o.status='leased' AND o.lease_owner=$4
            AND p.tenant_id = o.tenant_id AND p.id = o.project_id`,
        [tenantId, graphEventSeq, row.id, row.lease_owner],
      ),
    );
  };

  /**
   * Records a non-commit without inventing a success.
   *
   * A transaction that fails here must never leave a `committed` row, because a
   * failed delivery that reads as committed is worse than an obvious gap: it
   * hides the fact that the evidence was never admitted.
   */
  const recordFailure = async (
    tenantId: string,
    row: OutboxRow,
    code: string,
    quarantined: boolean,
    retryInMs: number,
  ): Promise<void> => {
    await deps.db.withTenantTransaction(tenantId, async (tx) => {
      await tx.rows(
        `UPDATE threadline.capture_outbox
            SET status = $2, lease_owner = NULL, lease_expires_at = NULL,
                last_error_code = $3,
                next_attempt_at = CASE WHEN $2 = 'quarantined'
                                      THEN next_attempt_at
                                      ELSE $4::timestamptz END
          WHERE tenant_id = $1 AND id = $5 AND status='leased' AND lease_owner=$6`,
        [
          tenantId,
          quarantined ? 'quarantined' : 'pending',
          code.slice(0, 120),
          new Date(clock().getTime() + retryInMs).toISOString(),
          row.id, row.lease_owner,
        ],
      );
    });
  };

  /**
   * Returns leased rows whose lease has expired to `pending`.
   *
   * Lease expiry revokes the worker's claim; it does not prove the graph write
   * did not happen. An expired attempt is therefore reconciled by its receipt,
   * never assumed lost.
   */
  const recoverExpired = async (tenantId: string): Promise<number> => {
    // Deliberately not scoped to one owner. A lease that has expired belongs to
    // nobody, and the worker holding it is usually the one that died -- scoping
    // recovery to the surviving worker would leave the row invisible forever.
    const rows = await deps.db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{ id: string }>(
        `UPDATE threadline.capture_outbox
            SET status = CASE WHEN attempts >= ${profile.maxAttempts} THEN 'quarantined' ELSE 'pending' END, lease_owner = NULL, lease_expires_at = NULL
          WHERE tenant_id = $1 AND status = 'leased' AND lease_expires_at < $2::timestamptz
        RETURNING id`,
        [tenantId, clock()],
      ),
    );
    return rows.length;
  };

  const drainOnce = async (
    tenantId: string,
    ownerId: string,
  ): Promise<{ claimed: number; committed: number; quarantined: number }> => {
    const claimed = await claimBatch(tenantId, ownerId);
    let committed = 0;
    let quarantined = 0;

    for (const row of claimed) {
      const exhausted = row.attempts >= profile.maxAttempts;
      let outcome: DeliveryOutcome;
      try {
        const lease = await deps.db.withTenantTransaction(tenantId, tx => tx.rows(
          `UPDATE threadline.capture_outbox SET lease_expires_at=$4::timestamptz + ($5 || ' milliseconds')::interval
            WHERE tenant_id=$1 AND id=$2 AND lease_owner=$3 AND status='leased' AND lease_expires_at >= $4::timestamptz RETURNING id`,
          [tenantId,row.id,row.lease_owner,clock(),String(profile.leaseMs)]));
        if (!lease.length) continue;
        let deadline: NodeJS.Timeout | undefined;
        try {
          outcome = await Promise.race([deps.deliver({
          tenantId: row.tenant_id,
          projectId: row.project_id,
          operationId: row.operation_id,
          captureEventId: row.capture_event_id,
          sourceKey: row.source_key,
          requestDigest: row.request_digest,
          agentSessionId: row.agent_session_id,
          kind: row.kind,
          payload: row.payload,
          graphEpoch: row.graph_epoch ?? '',
        }), new Promise<DeliveryOutcome>(resolve => { deadline=setTimeout(()=>resolve({kind:'ambiguous',code:'delivery_timeout'}),profile.deliveryTimeoutMs); })]);
        } finally { clearTimeout(deadline); }
      } catch (error) {
        // A thrown deliverer is treated as ambiguous, not as a known failure:
        // we genuinely do not know whether the write landed.
        outcome = {
          kind: 'ambiguous',
          code: error instanceof ThreadlineError ? error.code : 'delivery_threw',
        };
      }

      if (outcome.kind === 'committed' || outcome.kind === 'already_committed') {
        await markCommitted(tenantId, row, outcome.graphEventSeq);
        committed += 1;
        continue;
      }

      // Backoff follows the profile. Exhaustion quarantines rather than looping.
      const backoff = profile.retryBackoffMs[Math.min(row.attempts - 1, profile.retryBackoffMs.length - 1)];
      const shouldQuarantine = exhausted || outcome.kind === 'ambiguous';
      if (shouldQuarantine) {
        // An ambiguous outcome is quarantined immediately: the profile allows
        // automatic retry only for a known no-effect result, so this must be
        // reconciled by a human or a reconciler before it is retried.
        quarantined += 1;
      }
      await recordFailure(tenantId, row, outcome.code, shouldQuarantine, backoff ?? 0);
      logger.log({
        level: shouldQuarantine ? 'error' : 'warn',
        message: 'Graph delivery did not commit.',
        fields: {
          sourceKey: row.source_key,
          attempt: row.attempts,
          outcome: outcome.kind,
          quarantined: shouldQuarantine,
        },
      });
    }

    return { claimed: claimed.length, committed, quarantined };
  };

  let timer: { cancel: () => void } | null = null;
  let stopped = false;

  return {
    profile,

    async drain(ownerId: string) {
      // Expiry recovery runs first so a crashed worker's rows are visible again
      // in the same pass, rather than waiting for a separate sweep.
      await recoverExpired(deps.tenantId);
      return drainOnce(deps.tenantId, ownerId);
    },

    async drainOnce(ownerId: string) {
      return this.drain(ownerId);
    },

    start(ownerId: string) {
      if (timer !== null || stopped) {
        return;
      }
      const schedule =
        deps.schedule ??
        ((fn: () => void, ms: number) => {
          const handle = setInterval(fn, ms);
          return { cancel: () => clearInterval(handle) };
        });
      timer = schedule(() => {
        void this.drain(ownerId).catch((error: unknown) => {
          logger.log({
            level: 'warn',
            message: 'Outbox drain failed; the next tick retries.',
            fields: { error: error instanceof Error ? error.name : typeof error },
          });
        });
      }, profile.pollMs);
    },

    async recoverExpired() {
      // `ownerId` is part of the port because a deployment may run several
      // workers, but expiry recovery is not owner-scoped: an expired lease
      // belongs to nobody, and the holder is usually the worker that died.
      return { recovered: await recoverExpired(deps.tenantId) };
    },

    async status(reader: SourceReader) {
      const rows = await deps.db.withTenantTransaction(reader.tenantId, (tx) =>
        tx.rows<{
          pending: string;
          leased: string;
          quarantined: string;
          oldest_pending_at: Date | null;
        }>(
          `SELECT
             count(*) FILTER (WHERE o.status = 'pending')::text AS pending,
             count(*) FILTER (WHERE o.status = 'leased')::text AS leased,
             count(*) FILTER (WHERE o.status = 'quarantined')::text AS quarantined,
             min(o.created_at) FILTER (WHERE o.status = 'pending') AS oldest_pending_at
             FROM threadline.capture_outbox o
             JOIN threadline.capture_events c
               ON c.tenant_id = o.tenant_id AND c.id = o.capture_event_id
            WHERE o.tenant_id = $1 AND o.project_id = $2 AND c.agent_session_id IS NOT NULL`,
          [reader.tenantId, reader.projectId],
        ),
      );
      const row = rows[0];
      const quarantined = await deps.db.withTenantTransaction(reader.tenantId, (tx) =>
        tx.rows<{
          operation_id: string;
          source_key: string;
          attempts: number;
          last_error_code: string | null;
        }>(
          `SELECT o.operation_id, c.source_key, o.attempts, o.last_error_code
             FROM threadline.capture_outbox o
             JOIN threadline.capture_events c
               ON c.tenant_id = o.tenant_id AND c.id = o.capture_event_id
            WHERE o.tenant_id = $1 AND o.project_id = $2 AND o.status = 'quarantined'
            ORDER BY o.created_at ASC`,
          [reader.tenantId, reader.projectId],
        ),
      );
      const operations: QuarantinedOperation[] = quarantined.map((entry) => ({
        operationId: entry.operation_id,
        sourceKey: entry.source_key,
        attempts: entry.attempts,
        lastErrorCode: entry.last_error_code,
      }));
      return {
        pending: Number(row?.pending ?? '0'),
        leased: Number(row?.leased ?? '0'),
        quarantined: Number(row?.quarantined ?? '0'),
        oldestPendingAt: row?.oldest_pending_at?.toISOString() ?? null,
        quarantinedOperations: operations,
      };
    },

    async stop() {
      stopped = true;
      // Bounded drain: stop taking new work, then release the timer without
      // waiting for in-flight delivery to finish.
      timer?.cancel();
      timer = null;
    },
  };
}

/** Exposed for the delivery path, which needs the same fencing semantics. */
export async function withOutboxTransaction<TResult>(
  db: SqlDatabase,
  tenantId: string,
  work: (tx: TxClient) => Promise<TResult>,
): Promise<TResult> {
  return db.withTenantTransaction(tenantId, work);
}