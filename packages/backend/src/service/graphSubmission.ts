import { ThreadlineError, type DecimalString } from '@threadline/shared';

import type { SqlDatabase, TxClient } from '../storage/pg.js';

/** Durable project release denial, committed before any graph request is sent. */
export interface GraphSubmission {
  readonly tenantId: string;
  readonly projectId: string;
  readonly operationId: string;
  readonly ownerToken: string;
  readonly graphEpoch: string;
  readonly requestDigest: string;
  /** Null markers use the preexisting privacy-revision guard for legacy recovery. */
  readonly writeGeneration: DecimalString | null;
  readonly recoveryPrivacyRevision: DecimalString | null;
}

/** Read the recovering operation plus one blocker, independent of legacy backlog size. */
export async function readGraphSubmissions(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  operationId: string,
): Promise<GraphSubmission[]> {
  const fields = `SELECT tenant_id AS "tenantId", project_id AS "projectId", operation_id AS "operationId",
            owner_token AS "ownerToken", graph_epoch AS "graphEpoch", request_digest AS "requestDigest",
            write_generation::text AS "writeGeneration",
            recovery_privacy_revision::text AS "recoveryPrivacyRevision"
       FROM threadline_memory.graph_submissions`;
  return db.withTenantTransaction(tenantId, async (tx) => {
    const identity = [tenantId, projectId, operationId];
    const own = await tx.rows<GraphSubmission>(
      `${fields} WHERE tenant_id = $1 AND project_id = $2 AND operation_id = $3 LIMIT 1`,
      identity,
    );
    const other = await tx.rows<GraphSubmission>(
      `${fields} WHERE tenant_id = $1 AND project_id = $2 AND operation_id <> $3
       ORDER BY operation_id LIMIT 1`,
      identity,
    );
    return [...own, ...other];
  });
}

/** Caller holds the project barrier; this transaction must commit before graph submission. */
export async function beginGraphSubmission(db: SqlDatabase, submission: GraphSubmission): Promise<GraphSubmission> {
  await db.withTenantTransaction(submission.tenantId, async (tx) => {
    await tx.rows(
      `INSERT INTO threadline_memory.graph_submissions
         (tenant_id, project_id, operation_id, owner_token, graph_epoch, request_digest, write_generation, state, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_progress', now())`,
      [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken,
        submission.graphEpoch, submission.requestDigest, submission.writeGeneration],
    );
  });
  return submission;
}

/** Clear only with confirmed settlement after an exact receipt or effective fence. */
export async function finishGraphSubmission(tx: TxClient, submission: GraphSubmission): Promise<void> {
  const deleted = await tx.rows<{ operation_id: string }>(
    `DELETE FROM threadline_memory.graph_submissions
      WHERE tenant_id = $1 AND project_id = $2 AND operation_id = $3 AND owner_token = $4
        AND graph_epoch = $5 AND request_digest = $6
        AND write_generation IS NOT DISTINCT FROM $7::bigint
      RETURNING operation_id`,
    [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken,
      submission.graphEpoch, submission.requestDigest, submission.writeGeneration],
  );
  if (deleted.length !== 1) {
    throw new ThreadlineError('authority_unavailable', 'Graph submission settlement lost its durable ownership.');
  }
}

export async function markGraphSubmissionUncertain(tx: TxClient, submission: GraphSubmission): Promise<void> {
  const updated = await tx.rows<{ operation_id: string }>(
    `UPDATE threadline_memory.graph_submissions SET state = 'uncertain'
      WHERE tenant_id = $1 AND project_id = $2 AND operation_id = $3 AND owner_token = $4
      RETURNING operation_id`,
    [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken],
  );
  if (updated.length !== 1) {
    throw new ThreadlineError('authority_unavailable', 'Graph submission uncertainty lost its durable ownership.');
  }
}

/** Persist the legacy fence target before graph submission; retries reuse it. */
export async function reserveRecoveryPrivacyRevision(
  db: SqlDatabase,
  submission: GraphSubmission,
  target: DecimalString,
): Promise<GraphSubmission> {
  const rows = await db.withTenantTransaction(submission.tenantId, (tx) => tx.rows<{ target: DecimalString }>(
    `UPDATE threadline_memory.graph_submissions SET recovery_privacy_revision = $5
      WHERE tenant_id = $1 AND project_id = $2 AND operation_id = $3 AND owner_token = $4
        AND (recovery_privacy_revision IS NULL OR recovery_privacy_revision = $5)
      RETURNING recovery_privacy_revision::text AS target`,
    [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken, target]));
  if (rows.length !== 1) throw new ThreadlineError('authority_unavailable', 'Legacy graph fence reservation lost ownership.');
  return { ...submission, recoveryPrivacyRevision: rows[0]!.target };
}

/** Called only after acknowledged graph fencing and post-fence receipt read. */
export async function settleRecoveryPrivacyRevision(tx: TxClient, submission: GraphSubmission): Promise<void> {
  const target = submission.recoveryPrivacyRevision;
  if (target === null) return;
  const projects = await tx.rows<{ id: string }>(
    `UPDATE threadline_memory.projects SET privacy_revision = $3
      WHERE tenant_id = $1 AND id = $2 AND graph_epoch = $4
        AND (privacy_revision = $3::bigint - 1 OR privacy_revision = $3::bigint)
      RETURNING id`, [submission.tenantId, submission.projectId, target, submission.graphEpoch]);
  if (projects.length !== 1) throw new ThreadlineError('authority_unavailable', 'Legacy graph fence SQL generation changed.');
  // Only this same operation is retried under the new barrier generation.
  await tx.rows(`UPDATE threadline_memory.operations SET privacy_revision = $4
    WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND graph_epoch = $5`,
  [submission.tenantId, submission.projectId, submission.operationId, target, submission.graphEpoch]);
}

/** Reuses the authority transaction: nested BEGIN/COMMIT would release its row locks early. */
export function graphTransactionDatabase(db: SqlDatabase, tx: TxClient, tenantId: string): SqlDatabase {
  const scoped: SqlDatabase = {
    query: (text, values) => tx.rows(text, values),
    withTenantTransaction: async (requestedTenant, work) => {
      if (requestedTenant !== tenantId) {
        throw new ThreadlineError('scope_denied', 'Graph submission cannot change tenant scope.');
      }
      return work(tx);
    },
    withTransaction: (work) => work(tx),
    withConnection: async (work) => work(scoped),
    ping: async () => { await tx.rows('SELECT 1'); },
    close: async () => { throw new ThreadlineError('internal_error', 'Cannot close a graph authority transaction.'); },
    get closed() { return db.closed; },
  };
  return scoped;
}
