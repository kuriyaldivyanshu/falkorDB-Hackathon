import { randomUUID } from 'node:crypto';

import { ThreadlineError } from '@threadline/shared';

import type { SqlDatabase, TxClient } from './pg.js';

/**
 * Durable human-command admission in SQL.
 *
 * The original permitted goal text and the complete canonical command envelope
 * are written in one transaction before any graph mutation is attempted. If
 * the process dies between the two, the inbox row survives as `pending` and
 * `reconcilePendingAdmissions` can resolve it from the original receipt.
 *
 * SQL inbox state is deliberately not the same vocabulary the client sees.
 * `pending|leased|committed|rejected|quarantined` describes storage; a pending
 * row is NOT graph-accepted authority.
 */

export type InboxStatus = 'pending' | 'leased' | 'committed' | 'rejected' | 'quarantined';

export interface InboxRow {
  readonly payload: unknown;
  readonly id: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly operation: string;
  readonly status: InboxStatus;
  readonly graphEpoch: string;
  readonly sourceMessageId: string | null;
  readonly graphReceiptId: string | null;
  readonly graphEventSeq: number | null;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
}

export interface RecordIntentParams {
  readonly tenantId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly graphEpoch: string;
  readonly operation: string;
  readonly payload: unknown;
  readonly sourceMessageId: string;
  readonly requestDigest: string;
  readonly goalText: string;
  readonly bodyDigest: string;
  readonly now: Date;
}

export type RecordIntentResult =
  | { readonly kind: 'inserted'; readonly inbox: InboxRow; readonly sourceMessageId: string }
  | { readonly kind: 'existing'; readonly inbox: InboxRow };

export async function recordAdmissionIntent(
  db: SqlDatabase,
  params: RecordIntentParams,
): Promise<RecordIntentResult> {
  return db.withTenantTransaction(params.tenantId, async (client) => {
    await client.rows('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [params.tenantId + ':' + params.projectId + ':' + params.requestId]);
    const existing = await loadInboxRow(client, params.tenantId, params.projectId, params.requestId);
    if (existing !== null) {
      return { kind: 'existing', inbox: existing };
    }

    const messageId = params.sourceMessageId;
    const messageResult = await client.rows<{ id: string }>(
      `INSERT INTO threadline.project_messages
         (tenant_id, project_id, id, author_user_id, user_session_id, run_id, request_id,
          body, body_digest, visibility, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, 'project', $9)
       RETURNING id`,
      [
        params.tenantId,
        params.projectId,
        messageId,
        params.userId,
        params.sessionId,
        params.requestId,
        params.goalText,
        params.bodyDigest,
        params.now,
      ],
    );
    const insertedMessageId = messageResult[0]?.id ?? messageId;

    const inboxId = newInboxId();
    const inboxResult = await client.rows<{
      id: string;
      request_id: string;
      request_digest: string;
      operation: string;
      payload: unknown;
      status: InboxStatus;
      graph_epoch: string;
      source_message_id: string | null;
      graph_receipt_id: string | null;
      graph_event_seq: string | null;
      created_at: Date;
      settled_at: Date | null;
    }>(
      `INSERT INTO threadline.command_inbox
         (tenant_id, project_id, id, initiated_by, user_session_id, source_message_id,
          request_id, graph_epoch, operation, payload, request_digest, status,
          attempts, next_attempt_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 0, $12, $12)
       RETURNING id, request_id, request_digest, operation, payload, status, graph_epoch,
                 source_message_id, graph_receipt_id, graph_event_seq, created_at, settled_at`,
      [
        params.tenantId,
        params.projectId,
        inboxId,
        params.userId,
        params.sessionId,
        insertedMessageId,
        params.requestId,
        params.graphEpoch,
        params.operation,
        JSON.stringify(params.payload),
        params.requestDigest,
        params.now,
      ],
    );
    const row = inboxResult[0];
    if (row === undefined) {
      throw new ThreadlineError('internal_error', 'The command inbox insert returned no row.');
    }
    return { kind: 'inserted', inbox: toInboxRow(row), sourceMessageId: insertedMessageId };
  });
}

export async function findInbox(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  requestId: string,
): Promise<InboxRow | null> {
  return db.withTenantTransaction(tenantId, (client) =>
    loadInboxRow(client, tenantId, projectId, requestId),
  );
}

export async function listPendingAdmissions(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
): Promise<InboxRow[]> {
  return db.withTenantTransaction(tenantId, async (client) => {
    const result = await client.rows<InboxRowShape>(
      `SELECT id, request_id, request_digest, operation, payload, status, graph_epoch,
              source_message_id, graph_receipt_id, graph_event_seq, created_at, settled_at
         FROM threadline.command_inbox
        WHERE tenant_id = $1 AND project_id = $2 AND status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1001`,
      [tenantId, projectId],
    );
    if (result.length > 1000) throw new ThreadlineError('authority_unavailable','More than 1000 admissions need reconciliation; operator intervention is required.');
    return result.map(toInboxRow);
  });
}

export interface SettleParams {
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly receiptId: string;
  readonly eventSeq: number;
  readonly eventGraphId: string;
  readonly eventKind: string;
  readonly aggregateId: string;
  readonly eventPayload: unknown;
  readonly eventPayloadDigest: string;
  readonly graphEpoch: string;
  readonly committedAt: Date;
}

/**
 * Settles one inbox row and records the graph Event projection and an audit
 * entry in the same SQL transaction. The projection is what lets the terminal
 * client show the original evidence rather than local optimistic state.
 */
export async function settleCommitted(
  db: SqlDatabase,
  params: SettleParams,
): Promise<InboxRow> {
  return db.withTenantTransaction(params.tenantId, async (client) => {
    await client.rows('SELECT id FROM threadline.command_inbox WHERE tenant_id=$1 AND project_id=$2 AND request_id=$3 FOR UPDATE', [params.tenantId,params.projectId,params.requestId]);
    const existing = await loadInboxRow(client,params.tenantId,params.projectId,params.requestId);
    if (existing?.status === 'committed') {
      if (existing.graphEpoch !== params.graphEpoch || existing.graphReceiptId !== params.receiptId || existing.graphEventSeq !== params.eventSeq)
        throw new ThreadlineError('authority_conflict','The committed receipt identity differs.');
      return existing;
    }
    const updated = await client.rows<InboxRowShape>(
      `UPDATE threadline.command_inbox
          SET status = 'committed', graph_receipt_id = $1, graph_event_seq = $2,
              settled_at = $3, attempts = attempts + 1, last_error_code = NULL
        WHERE tenant_id = $4 AND project_id = $5 AND request_id = $6
          AND graph_epoch = $7
          AND (graph_receipt_id IS DISTINCT FROM $1)
        RETURNING id, request_id, request_digest, operation, payload, status, graph_epoch,
                  source_message_id, graph_receipt_id, graph_event_seq, created_at, settled_at`,
      [
        params.receiptId,
        params.eventSeq,
        params.committedAt,
        params.tenantId,
        params.projectId,
        params.requestId,
        params.graphEpoch,
      ],
    );
    const row = updated[0];
    if (row === undefined) {
      throw new ThreadlineError(
        'authority_conflict',
        'The inbox row could not be settled on this epoch.',
      );
    }

    await client.rows(
      `INSERT INTO threadline.graph_event_projection
         (tenant_id, project_id, id, graph_epoch, event_seq, event_graph_id, kind,
          aggregate_graph_id, payload, payload_digest, committed_at, projected_at)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (tenant_id, project_id, graph_epoch, event_seq) DO NOTHING`,
      [
        params.tenantId,
        params.projectId,
        params.graphEpoch,
        params.eventSeq,
        params.eventGraphId,
        params.eventKind,
        params.aggregateId,
        JSON.stringify(params.eventPayload),
        params.eventPayloadDigest,
        params.committedAt,
      ],
    );

    await client.rows(
      `INSERT INTO threadline.audit_events (tenant_id, id, actor_user_id, kind, target_id, request_id, payload, created_at)
       VALUES ($1, gen_random_uuid(), (SELECT initiated_by FROM threadline.command_inbox
                                        WHERE tenant_id = $1 AND project_id = $2 AND request_id = $3),
               'goal.admitted', $4, $3, $5, now())`,
      [
        params.tenantId,
        params.projectId,
        params.requestId,
        params.aggregateId,
        JSON.stringify({ receiptId: params.receiptId, eventSeq: params.eventSeq }),
      ],
    );

    return toInboxRow(row);
  });
}

export async function markQuarantined(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  requestId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await db.withTenantTransaction(tenantId, async (client) => {
    await client.rows(
      `UPDATE threadline.command_inbox
          SET status = 'quarantined', last_error_code = $1, settled_at = $2, attempts = attempts + 1
        WHERE tenant_id = $3 AND project_id = $4 AND request_id = $5 AND status = 'pending'`,
      [reason, now, tenantId, projectId, requestId],
    );
  });
}

interface InboxRowShape {
  payload: unknown;
  id: string;
  request_id: string;
  request_digest: string;
  operation: string;
  status: InboxStatus;
  graph_epoch: string;
  source_message_id: string | null;
  graph_receipt_id: string | null;
  graph_event_seq: string | number | null;
  created_at: Date;
  settled_at: Date | null;
}

function toInboxRow(row: InboxRowShape): InboxRow {
  return {
    id: row.id,
    requestId: row.request_id,
    requestDigest: row.request_digest,
    operation: row.operation,
    payload: row.payload,
    status: row.status,
    graphEpoch: row.graph_epoch,
    sourceMessageId: row.source_message_id,
    graphReceiptId: row.graph_receipt_id,
    graphEventSeq: toSafeInteger(row.graph_event_seq),
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

async function loadInboxRow(
  client: TxClient,
  tenantId: string,
  projectId: string,
  requestId: string,
): Promise<InboxRow | null> {
  const result = await client.rows<InboxRowShape>(
    `SELECT id, request_id, request_digest, operation, payload, status, graph_epoch,
            source_message_id, graph_receipt_id, graph_event_seq, created_at, settled_at
       FROM threadline.command_inbox
      WHERE tenant_id = $1 AND project_id = $2 AND request_id = $3`,
    [tenantId, projectId, requestId],
  );
  const row = result[0];
  return row === undefined ? null : toInboxRow(row);
}

/**
 * `bigint` arrives as a string so precision is never silently lost. Reject a
 * value that cannot be represented exactly rather than rounding it.
 */
export function toSafeInteger(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ThreadlineError(
      'internal_error',
      'A persisted sequence value is outside the safe integer range.',
    );
  }
  return parsed;
}

function newInboxId(): string {
  return randomUUID();
}
