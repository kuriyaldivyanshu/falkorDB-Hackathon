import { ThreadlineError } from '@threadline/shared';

import type { SqlDatabase, TxClient } from '../storage/pg.js';

/** Durable project release denial, committed before any graph request is sent. */
export interface GraphSubmission {
  readonly tenantId: string;
  readonly projectId: string;
  readonly operationId: string;
  readonly ownerToken: string;
  readonly graphEpoch: string;
  readonly requestDigest: string;
}

/** Read the recovering operation plus one blocker, independent of legacy backlog size. */
export async function readGraphSubmissions(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  operationId: string,
): Promise<GraphSubmission[]> {
  const fields = `SELECT tenant_id AS "tenantId", project_id AS "projectId", operation_id AS "operationId",
            owner_token AS "ownerToken", graph_epoch AS "graphEpoch", request_digest AS "requestDigest"
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
         (tenant_id, project_id, operation_id, owner_token, graph_epoch, request_digest, state, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', now())`,
      [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken,
        submission.graphEpoch, submission.requestDigest],
    );
  });
  return submission;
}

/** Call in the same transaction that confirms operation settlement; never on an absent receipt. */
export async function finishGraphSubmission(tx: TxClient, submission: GraphSubmission): Promise<void> {
  const deleted = await tx.rows<{ operation_id: string }>(
    `DELETE FROM threadline_memory.graph_submissions
      WHERE tenant_id = $1 AND project_id = $2 AND operation_id = $3 AND owner_token = $4
        AND graph_epoch = $5 AND request_digest = $6
      RETURNING operation_id`,
    [submission.tenantId, submission.projectId, submission.operationId, submission.ownerToken,
      submission.graphEpoch, submission.requestDigest],
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
