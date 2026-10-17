import type { Graph } from 'falkordb';

import { isDecimalString, type DecimalString } from '@threadline/shared';

/**
 * Reviewed Cypher statements for the project memory graph.
 *
 * This module is the only place that writes memory-graph structure. Statements
 * are parameterized and fixed; a caller supplies facts the backend resolved
 * from SQL, never a request body. Every write that a worker may retry is
 * idempotent under its operation identity:
 *
 * - the receipt id is `receipt:<graph_epoch>:<operation>` and the event id is
 *   `event:<graph_epoch>:<seq>`, so the `Entity(id)` uniqueness constraint
 *   already enforces operation-receipt and event identity;
 * - the source-anchor commit checks for the receipt inside the same statement,
 *   so a replay writes nothing and reports the same conclusion;
 * - the event head is incremented and the Event/OperationReceipt/SourceAnchor
 *   nodes are created in one statement, so a graph observer never sees a
 *   receipt without its event or an event without its receipt.
 *
 * Graph payloads are metadata only: ids, digests, epochs, revisions and
 * timestamps. Captured bytes stay in the source ledger and files.
 */

export const projectRootIdFor = (projectId: string): string => `project:${projectId}`;

export const receiptIdFor = (graphEpoch: string, operationId: string): string =>
  `receipt:${graphEpoch}:${operationId}`;

export const eventIdPrefixFor = (graphEpoch: string): string => `event:${graphEpoch}:`;

export interface ProjectRootFacts {
  readonly projectRootId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly graphEpoch: string;
  /** Canonical decimal string; a 64-bit counter never crosses as a JS number. */
  readonly privacyRevision: DecimalString;
  readonly nowMs: number;
  readonly graphSchemaVersion: number;
}

export interface ProjectRootView {
  readonly graphEpoch: string | null;
  readonly privacyRevision: DecimalString | null;
  readonly state: string | null;
  readonly eventHead: DecimalString | null;
  readonly graphSchemaVersion: number | null;
}

export interface OperationReceiptView {
  readonly operationId: string | null;
  readonly outcome: string | null;
  readonly eventSeq: DecimalString | null;
  readonly graphEpoch: string | null;
  readonly requestDigest: string | null;
  readonly committedAtMs: number | null;
}

export interface SourceAnchorCommit {
  readonly projectRootId: string;
  readonly graphEpoch: string;
  readonly privacyRevision: DecimalString;
  readonly receiptId: string;
  readonly eventIdPrefix: string;
  readonly operationId: string;
  readonly sourceId: string;
  readonly sourceDigest: string;
  readonly sourceKind: string;
  readonly requestDigest: string;
  readonly nowMs: number;
  readonly graphSchemaVersion: number;
}

/**
 * Creates the root node when it is absent. An existing root is returned
 * unchanged: this statement never rewrites epoch, privacy revision or state,
 * so the caller can compare and refuse a mismatch explicitly.
 *
 * Counters are stored as engine integers (written through `toInteger` on the
 * decimal-string parameter) and returned through `toString`, so a 64-bit value
 * is never rounded into a JavaScript number on either leg.
 */
const ENSURE_PROJECT_ROOT = `MERGE (p:Entity:ProjectRoot {id: $projectRootId})
ON CREATE SET p.tenant_id = $tenantId, p.project_id = $projectId, p.graph_epoch = $graphEpoch,
              p.privacy_revision = toInteger($privacyRevision), p.state = 'active', p.event_head = 0,
              p.graph_schema_version = $graphSchemaVersion, p.created_at_ms = $nowMs
RETURN p.graph_epoch AS graph_epoch, toString(p.privacy_revision) AS privacy_revision,
       p.state AS state, toString(p.event_head) AS event_head, p.graph_schema_version AS graph_schema_version`;

const READ_PROJECT_ROOT = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
RETURN p.graph_epoch AS graph_epoch, toString(p.privacy_revision) AS privacy_revision,
       p.state AS state, toString(p.event_head) AS event_head, p.graph_schema_version AS graph_schema_version`;

const READ_OPERATION_RECEIPT = `MATCH (r:Entity:OperationReceipt {id: $receiptId})
RETURN r.operation_id AS operation_id, r.outcome AS outcome, toString(r.event_seq) AS event_seq,
       r.graph_epoch AS graph_epoch, r.request_digest AS request_digest,
       r.committed_at_ms AS committed_at_ms`;

/**
 * The single atomic commit for a `source.append` admission: guarded head
 * increment, Event, OperationReceipt and SourceAnchor in one statement.
 *
 * Guards (all must hold or nothing is written):
 * - the root exists with the operation's graph epoch;
 * - the root's privacy revision equals the operation's;
 * - the root is active;
 * - no receipt with this operation's identity exists yet.
 *
 * Returns the new event sequence, or nothing when the receipt already exists
 * or a guard refused the write. A constraint violation (for example, a
 * concurrent writer taking the same event sequence) surfaces as an error and
 * is retried under the same operation identity.
 */
const COMMIT_SOURCE_ANCHOR = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'source.anchor_registered',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.source_id = $sourceId,
    event.source_digest = $sourceDigest,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = 'source.append',
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
MERGE (anchor:Entity:SourceAnchor {id: $sourceId})
ON CREATE SET anchor.digest = $sourceDigest, anchor.source_kind = $sourceKind,
              anchor.visibility = 'project', anchor.privacy_revision = toInteger($privacyRevision),
              anchor.graph_epoch = $graphEpoch, anchor.availability = 'available',
              anchor.created_at_ms = $nowMs, anchor.graph_schema_version = $graphSchemaVersion
ON MATCH SET anchor.availability = 'available', anchor.digest = $sourceDigest
MERGE (p)-[:HAS_SOURCE]->(anchor)
RETURN toString(eventSeq) AS event_seq`;

export async function ensureProjectRoot(graph: Graph, facts: ProjectRootFacts): Promise<ProjectRootView> {
  const reply = await graph.query<Record<string, unknown>>(ENSURE_PROJECT_ROOT, {
    params: {
      projectRootId: facts.projectRootId,
      tenantId: facts.tenantId,
      projectId: facts.projectId,
      graphEpoch: facts.graphEpoch,
      privacyRevision: facts.privacyRevision,
      graphSchemaVersion: facts.graphSchemaVersion,
      nowMs: facts.nowMs,
    },
  });
  const row = reply.data?.[0];
  return row === undefined ? emptyRootView() : toProjectRootView(row);
}

export async function readProjectRoot(graph: Graph, projectRootId: string): Promise<ProjectRootView | null> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_PROJECT_ROOT, {
    params: { projectRootId },
  });
  const row = reply.data?.[0];
  return row === undefined ? null : toProjectRootView(row);
}

export async function readOperationReceipt(
  graph: Graph,
  receiptId: string,
): Promise<OperationReceiptView | null> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_OPERATION_RECEIPT, {
    params: { receiptId },
  });
  const row = reply.data?.[0];
  if (row === undefined) {
    return null;
  }
  return {
    operationId: asString(row.operation_id),
    outcome: asString(row.outcome),
    eventSeq: asDecimal(row.event_seq),
    graphEpoch: asString(row.graph_epoch),
    requestDigest: asString(row.request_digest),
    committedAtMs: asInteger(row.committed_at_ms),
  };
}

/**
 * Runs the atomic commit. Returns the committed event sequence, or null when
 * the receipt already existed or a guard refused the write; the caller
 * classifies the null outcome with `readOperationReceipt` and `readProjectRoot`.
 */
export async function commitSourceAnchor(
  graph: Graph,
  commit: SourceAnchorCommit,
): Promise<DecimalString | null> {
  const reply = await graph.query<Record<string, unknown>>(COMMIT_SOURCE_ANCHOR, {
    params: {
      projectRootId: commit.projectRootId,
      graphEpoch: commit.graphEpoch,
      privacyRevision: commit.privacyRevision,
      receiptId: commit.receiptId,
      eventIdPrefix: commit.eventIdPrefix,
      operationId: commit.operationId,
      sourceId: commit.sourceId,
      sourceDigest: commit.sourceDigest,
      sourceKind: commit.sourceKind,
      requestDigest: commit.requestDigest,
      nowMs: commit.nowMs,
      graphSchemaVersion: commit.graphSchemaVersion,
    },
  });
  const row = reply.data?.[0];
  return row === undefined ? null : asDecimal(row.event_seq);
}

function emptyRootView(): ProjectRootView {
  return { graphEpoch: null, privacyRevision: null, state: null, eventHead: null, graphSchemaVersion: null };
}

function toProjectRootView(row: Record<string, unknown>): ProjectRootView {
  return {
    graphEpoch: asString(row.graph_epoch),
    privacyRevision: asDecimal(row.privacy_revision),
    state: asString(row.state),
    eventHead: asDecimal(row.event_head),
    graphSchemaVersion: asInteger(row.graph_schema_version),
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads a 64-bit counter that Cypher returned through `toString`.
 *
 * Only the canonical decimal form is accepted. A value that arrives as a
 * JavaScript number has already been rounded somewhere, so it is refused rather
 * than silently converted back into a string that cannot recover the original.
 */
function asDecimal(value: unknown): DecimalString | null {
  return isDecimalString(value) ? value : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  return null;
}
