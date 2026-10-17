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

/**
 * Identity convention for domain nodes.
 *
 * A Task, Memory and MemoryVersion node carries its wire identity as its `id`,
 * the same convention a SourceAnchor already uses. Synthetic nodes (the project
 * root, receipts, events) keep a prefixed id because their identity is scoped
 * to the graph, not to the domain.
 *
 * Every statement below follows one rule: all guards evaluate before the first
 * write clause, so a refused statement writes nothing. A receipt check is part
 * of every commit, so a replay under the same operation identity is inert.
 */

export interface GraphCommitBase {
  readonly projectRootId: string;
  readonly graphEpoch: string;
  readonly privacyRevision: DecimalString;
  readonly receiptId: string;
  readonly eventIdPrefix: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly actorPrincipalId: string;
  readonly nowMs: number;
  readonly graphSchemaVersion: number;
}

const COMMIT_TASK_CREATE = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
OPTIONAL MATCH (collision:Entity:Task {id: $taskId})
WITH p, collision
WHERE collision IS NULL
CREATE (task:Entity:Task)
SET task.id = $taskId,
    task.tenant_id = $tenantId,
    task.project_id = $projectId,
    task.title = $title,
    task.task_family = $taskFamily,
    task.state = 'open',
    task.revision = $revision,
    task.created_by_principal_id = $actorPrincipalId,
    task.created_at_ms = $nowMs,
    task.graph_epoch = $graphEpoch,
    task.graph_schema_version = $graphSchemaVersion
CREATE (p)-[:HAS_TASK]->(task)
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, task, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'task.created',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.task_id = $taskId,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = 'task.create',
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
RETURN toString(eventSeq) AS event_seq`;

export interface TaskCreateCommit extends GraphCommitBase {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly title: string;
  readonly taskFamily: string | null;
  readonly revision: string;
}

export async function commitTaskCreate(graph: Graph, commit: TaskCreateCommit): Promise<DecimalString | null> {
  return runCommit(graph, COMMIT_TASK_CREATE, { ...commit });
}

const COMMIT_MEMORY_PROPOSE = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
MATCH (anchor:Entity:SourceAnchor)
WHERE anchor.id IN $sourceAnchorIds
WITH p, collect(DISTINCT anchor) AS anchors
WHERE size(anchors) = $sourceAnchorCount
OPTIONAL MATCH (other:Entity:MemoryVersion)
WHERE other.id IN $contradictionVersionIds
WITH p, anchors, collect(DISTINCT other) AS contradictions
WHERE size(contradictions) = $contradictionCount
OPTIONAL MATCH (supportNode:Entity:MemoryVersion)
WHERE supportNode.id IN $supportVersionIds
WITH p, anchors, contradictions, collect(DISTINCT supportNode) AS supports
WHERE size(supports) = $supportCount
OPTIONAL MATCH (m0:Entity:Memory {id: $memoryId})
WITH p, anchors, contradictions, supports, m0
WHERE ($memoryMode = 'attach' AND m0 IS NOT NULL AND m0.kind = $kind)
   OR ($memoryMode = 'create' AND m0 IS NULL)
OPTIONAL MATCH (m0)-[:HAS_VERSION]->(proposed:Entity:MemoryVersion)
WHERE proposed.acceptance = 'proposed'
WITH p, anchors, contradictions, supports, m0, count(proposed) AS proposedCount
WHERE proposedCount < $candidateCap
MERGE (m:Entity:Memory {id: $memoryId})
ON CREATE SET m.tenant_id = $tenantId, m.project_id = $projectId,
              m.kind = $kind, m.created_at_ms = $nowMs,
              m.created_by_principal_id = $actorPrincipalId,
              m.graph_epoch = $graphEpoch, m.graph_schema_version = $graphSchemaVersion
MERGE (p)-[:HAS_MEMORY]->(m)
CREATE (v:Entity:MemoryVersion)
SET v.id = $versionId,
    v.memory_id = $memoryId,
    v.kind = $kind,
    v.content_json = $contentJson,
    v.subtype = $subtype,
    v.statement = $statement,
    v.applicability_json = $applicabilityJson,
    v.observed_under_json = $observedUnderJson,
    v.acceptance = $acceptance,
    v.delegation = $delegation,
    v.evidence_precision = $evidencePrecision,
    v.author_principal_id = $actorPrincipalId,
    v.created_at_ms = $nowMs,
    v.observed_at_ms = $observedAtMs,
    v.accepted_at_ms = $acceptedAtMs,
    v.origin_task_id = $originTaskId,
    v.proposed_against_head = $expectedHead,
    v.graph_epoch = $graphEpoch,
    v.graph_schema_version = $graphSchemaVersion
CREATE (m)-[:HAS_VERSION]->(v)
FOREACH (anchor IN anchors | CREATE (v)-[:SOURCED_FROM]->(anchor))
FOREACH (other IN contradictions | CREATE (v)-[:CONTRADICTS]->(other))
FOREACH (support IN supports | CREATE (v)-[:SUPPORTED_BY]->(support))
// A deterministically observed episode is proposal-free, so its version becomes
// the identity's current authority here. The accepted branch is unreachable for
// a proposal, so this never fires on that path.
FOREACH (adopt IN CASE WHEN $acceptance = 'accepted' THEN [1] ELSE [] END |
  CREATE (m)-[:CURRENT]->(v))
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, m, v, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'memory.version_proposed',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.memory_id = $memoryId,
    event.version_id = $versionId,
    event.memory_kind = $kind,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = $operationKind,
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
RETURN toString(eventSeq) AS event_seq`;

/**
 * The proposal commit serves `memory.propose` and `memory.episode.record`.
 *
 * The statements are identical; only who resolves `delegation` and
 * `evidencePrecision` differs. An episode's are resolved from evidence
 * eligibility by this service, a proposal's are always `authored`/`null`. That
 * is deliberate: an episode gains no authority by taking a different path
 * through the graph, because there is only one path.
 *
 * `supportVersionIds` was verified against project memory by the worker before
 * this call. `SUPPORTED_BY` is a reference, never a copy: the outcome each
 * supporting episode actually recorded is read back through the version read.
 */
export interface MemoryProposeCommit extends GraphCommitBase {
  readonly tenantId: string;
  readonly projectId: string;
  readonly memoryId: string;
  readonly memoryMode: 'create' | 'attach';
  readonly versionId: string;
  readonly kind: string;
  readonly operationKind: string;
  readonly contentJson: string;
  readonly subtype: string;
  readonly statement: string;
  readonly delegation: string;
  readonly evidencePrecision: string | null;
  /**
   * `accepted` is reachable only for an episode this service admitted
   * deterministically from evidence it verified. It carries no accepting
   * principal on purpose: no human accepted it, and an `acceptedByPrincipalId`
   * of null on a current version is exactly what tells a reader the authority
   * is an observation rather than a human decision.
   */
  readonly acceptance: 'proposed' | 'accepted';
  readonly acceptedAtMs: number | null;
  readonly applicabilityJson: string;
  readonly observedUnderJson: string;
  readonly observedAtMs: number;
  readonly originTaskId: string | null;
  readonly expectedHead: string | null;
  readonly sourceAnchorIds: readonly string[];
  readonly contradictionVersionIds: readonly string[];
  readonly supportVersionIds: readonly string[];
  readonly candidateCap: number;
}

export async function commitMemoryPropose(
  graph: Graph,
  commit: MemoryProposeCommit,
): Promise<DecimalString | null> {
  return runCommit(graph, COMMIT_MEMORY_PROPOSE, {
    ...commit,
    sourceAnchorIds: [...commit.sourceAnchorIds],
    contradictionVersionIds: [...commit.contradictionVersionIds],
    supportVersionIds: [...commit.supportVersionIds],
    sourceAnchorCount: commit.sourceAnchorIds.length,
    contradictionCount: commit.contradictionVersionIds.length,
    supportCount: commit.supportVersionIds.length,
  });
}

const COMMIT_MEMORY_ACCEPT = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
MATCH (p)-[:HAS_MEMORY]->(m:Entity:Memory {id: $memoryId})
MATCH (m)-[:HAS_VERSION]->(v:Entity:MemoryVersion {id: $versionId})
WHERE v.acceptance = 'proposed'
OPTIONAL MATCH (m)-[cur:CURRENT]->(prev:Entity:MemoryVersion)
WITH p, m, v, collect(cur) AS currentEdges, collect(prev) AS currentVersions
WHERE (size(currentEdges) = 0 AND $expectedHead IS NULL)
   OR (size(currentEdges) = 1 AND currentVersions[0].id = $expectedHead)
FOREACH (version IN currentVersions |
  SET version.acceptance = 'superseded',
      version.superseded_at_ms = $nowMs,
      version.superseded_by_version_id = $versionId
)
FOREACH (version IN currentVersions | SET v.supersedes_version_id = version.id)
FOREACH (version IN currentVersions | CREATE (v)-[:SUPERSEDES]->(version))
FOREACH (edge IN currentEdges | DELETE edge)
SET v.acceptance = 'accepted',
    v.accepted_by_principal_id = $actorPrincipalId,
    v.accepted_at_ms = $nowMs,
    v.accept_reason = $reason
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, m, v, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'memory.version_accepted',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.memory_id = $memoryId,
    event.version_id = $versionId,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = 'memory.accept',
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
CREATE (m)-[:CURRENT]->(v)
RETURN toString(eventSeq) AS event_seq`;

export interface MemoryAcceptCommit extends GraphCommitBase {
  readonly memoryId: string;
  readonly versionId: string;
  readonly expectedHead: string | null;
  readonly reason: string | null;
}

export async function commitMemoryAccept(
  graph: Graph,
  commit: MemoryAcceptCommit,
): Promise<DecimalString | null> {
  return runCommit(graph, COMMIT_MEMORY_ACCEPT, { ...commit });
}

const COMMIT_MEMORY_CORRECT = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
MATCH (p)-[:HAS_MEMORY]->(m:Entity:Memory {id: $memoryId})
WHERE m.kind = $kind
MATCH (m)-[:HAS_VERSION]->(head:Entity:MemoryVersion {id: $expectedHead})
WHERE head.acceptance = 'accepted'
MATCH (anchor:Entity:SourceAnchor)
WHERE anchor.id IN $sourceAnchorIds
WITH p, m, head, collect(DISTINCT anchor) AS anchors
WHERE size(anchors) = $sourceAnchorCount
OPTIONAL MATCH (other:Entity:MemoryVersion)
WHERE other.id IN $contradictionVersionIds
WITH p, m, head, anchors, collect(DISTINCT other) AS contradictions
WHERE size(contradictions) = $contradictionCount
OPTIONAL MATCH (supportNode:Entity:MemoryVersion)
WHERE supportNode.id IN $supportVersionIds
WITH p, m, head, anchors, contradictions, collect(DISTINCT supportNode) AS supports
WHERE size(supports) = $supportCount
OPTIONAL MATCH (m)-[cur:CURRENT]->(head)
WITH p, m, head, anchors, contradictions, supports, cur
WHERE cur IS NOT NULL
OPTIONAL MATCH (m)-[:HAS_VERSION]->(collision:Entity:MemoryVersion {id: $versionId})
WITH p, m, head, anchors, contradictions, supports, cur, collision
WHERE collision IS NULL
CREATE (v:Entity:MemoryVersion)
SET v.id = $versionId,
    v.memory_id = $memoryId,
    v.kind = $kind,
    v.content_json = $contentJson,
    v.subtype = $subtype,
    v.statement = $statement,
    v.applicability_json = $applicabilityJson,
    v.observed_under_json = $observedUnderJson,
    v.acceptance = 'accepted',
    v.delegation = $delegation,
    v.evidence_precision = $evidencePrecision,
    v.author_principal_id = $actorPrincipalId,
    v.accepted_by_principal_id = $actorPrincipalId,
    v.created_at_ms = $nowMs,
    v.observed_at_ms = $observedAtMs,
    v.accepted_at_ms = $nowMs,
    v.accept_reason = $reason,
    v.origin_task_id = $originTaskId,
    v.supersedes_version_id = $expectedHead,
    v.graph_epoch = $graphEpoch,
    v.graph_schema_version = $graphSchemaVersion
CREATE (m)-[:HAS_VERSION]->(v)
CREATE (v)-[:SUPERSEDES]->(head)
FOREACH (anchor IN anchors | CREATE (v)-[:SOURCED_FROM]->(anchor))
FOREACH (other IN contradictions | CREATE (v)-[:CONTRADICTS]->(other))
FOREACH (support IN supports | CREATE (v)-[:SUPPORTED_BY]->(support))
SET head.acceptance = 'superseded',
    head.superseded_at_ms = $nowMs,
    head.superseded_by_version_id = $versionId
DELETE cur
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, m, v, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'memory.version_corrected',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.memory_id = $memoryId,
    event.version_id = $versionId,
    event.memory_kind = $kind,
    event.superseded_version_id = $expectedHead,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = 'memory.correct',
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
CREATE (m)-[:CURRENT]->(v)
RETURN toString(eventSeq) AS event_seq`;

export interface MemoryCorrectCommit extends GraphCommitBase {
  readonly tenantId: string;
  readonly projectId: string;
  readonly memoryId: string;
  readonly versionId: string;
  readonly expectedHead: string;
  /**
   * The head's own kind. A correction may not change the kind of a memory
   * identity: a requirement cannot silently become a procedure, because every
   * task requirement bound to it would follow the pointer to a different kind
   * of obligation. The statement refuses rather than rewriting the identity.
   */
  readonly kind: string;
  readonly contentJson: string;
  readonly subtype: string;
  readonly statement: string;
  readonly delegation: string;
  readonly evidencePrecision: string | null;
  readonly applicabilityJson: string;
  readonly observedUnderJson: string;
  readonly observedAtMs: number;
  readonly originTaskId: string | null;
  readonly reason: string;
  readonly sourceAnchorIds: readonly string[];
  readonly contradictionVersionIds: readonly string[];
  readonly supportVersionIds: readonly string[];
}

export async function commitMemoryCorrect(
  graph: Graph,
  commit: MemoryCorrectCommit,
): Promise<DecimalString | null> {
  return runCommit(graph, COMMIT_MEMORY_CORRECT, {
    ...commit,
    sourceAnchorIds: [...commit.sourceAnchorIds],
    contradictionVersionIds: [...commit.contradictionVersionIds],
    supportVersionIds: [...commit.supportVersionIds],
    sourceAnchorCount: commit.sourceAnchorIds.length,
    contradictionCount: commit.contradictionVersionIds.length,
    supportCount: commit.supportVersionIds.length,
  });
}

const COMMIT_TASK_REQUIRE = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
WHERE p.graph_epoch = $graphEpoch
  AND toString(p.privacy_revision) = $privacyRevision
  AND p.state = 'active'
OPTIONAL MATCH (existing:Entity:OperationReceipt {id: $receiptId})
WITH p, existing
WHERE existing IS NULL
MATCH (p)-[:HAS_TASK]->(t:Entity:Task {id: $taskId})
WHERE t.revision = $expectedTaskRevision AND t.state = 'open'
MATCH (p)-[:HAS_MEMORY]->(m:Entity:Memory {id: $memoryId})
WHERE m.kind = $obligationKind
OPTIONAL MATCH (t)-[:REQUIRES]->(already:Entity:Memory)
WITH p, t, m, collect(DISTINCT already.id) AS boundMemoryIds
WHERE size(boundMemoryIds) < $maxRequirements
  AND NOT $memoryId IN boundMemoryIds
CREATE (t)-[:REQUIRES]->(m)
SET t.revision = $newRevision
SET p.event_head = coalesce(p.event_head, 0) + 1
WITH p, t, p.event_head AS eventSeq
CREATE (event:Entity:Event)
SET event.id = $eventIdPrefix + toString(eventSeq),
    event.kind = 'task.requirement_bound',
    event.operation_id = $operationId,
    event.graph_epoch = $graphEpoch,
    event.seq = eventSeq,
    event.task_id = $taskId,
    event.memory_id = $memoryId,
    event.privacy_revision = toInteger($privacyRevision),
    event.committed_at_ms = $nowMs,
    event.graph_schema_version = $graphSchemaVersion
CREATE (receipt:Entity:OperationReceipt)
SET receipt.id = $receiptId,
    receipt.operation_id = $operationId,
    receipt.kind = 'task.require',
    receipt.request_digest = $requestDigest,
    receipt.graph_epoch = $graphEpoch,
    receipt.event_seq = eventSeq,
    receipt.outcome = 'committed',
    receipt.committed_at_ms = $nowMs,
    receipt.graph_schema_version = $graphSchemaVersion
CREATE (receipt)-[:RECEIPT_EVENT]->(event)
RETURN toString(eventSeq) AS event_seq`;

export interface TaskRequireCommit extends GraphCommitBase {
  readonly taskId: string;
  readonly memoryId: string;
  readonly expectedTaskRevision: string;
  readonly newRevision: string;
  readonly maxRequirements: number;
  /**
   * Only a semantic memory can govern a task. An episode records what happened
   * and a procedure proposes how to act; neither is an obligation, so binding
   * one as a requirement would let advice and history govern a task.
   */
  readonly obligationKind: string;
}

export async function commitTaskRequire(
  graph: Graph,
  commit: TaskRequireCommit,
): Promise<DecimalString | null> {
  return runCommit(graph, COMMIT_TASK_REQUIRE, { ...commit });
}

const READ_TASK = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})-[:HAS_TASK]->(t:Entity:Task {id: $taskId})
OPTIONAL MATCH (t)-[:REQUIRES]->(m:Entity:Memory)
RETURN t.title AS title, t.task_family AS task_family, t.state AS state, t.revision AS revision,
       t.created_at_ms AS created_at_ms, collect(DISTINCT m.id) AS required_memory_ids`;

export interface TaskReadRow {
  readonly title: string | null;
  readonly task_family: string | null;
  readonly state: string | null;
  readonly revision: string | null;
  readonly created_at_ms: number | null;
  readonly required_memory_ids: readonly string[];
}

export async function readTaskRow(graph: Graph, projectRootId: string, taskId: string): Promise<TaskReadRow | null> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_TASK, { params: { projectRootId, taskId } });
  const row = reply.data?.[0];
  if (row === undefined) {
    return null;
  }
  return {
    title: asString(row.title),
    task_family: asString(row.task_family),
    state: asString(row.state),
    revision: asString(row.revision),
    created_at_ms: asInteger(row.created_at_ms),
    required_memory_ids: asStringList(row.required_memory_ids),
  };
}

const READ_TASK_REQUIREMENTS = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})-[:HAS_TASK]->(t:Entity:Task {id: $taskId})
OPTIONAL MATCH (t)-[:REQUIRES]->(m:Entity:Memory)
OPTIONAL MATCH (m)-[cur:CURRENT]->(v:Entity:MemoryVersion)
RETURN t.revision AS revision, m.id AS memory_id, m.kind AS memory_kind,
       [version IN collect(DISTINCT v.id) | version] AS current_version_ids`;

export interface TaskRequirementHeadRow {
  readonly revision: string | null;
  readonly memory_id: string | null;
  readonly memory_kind: string | null;
  readonly current_version_ids: readonly string[];
}

export async function readTaskRequirementHeadRows(
  graph: Graph,
  projectRootId: string,
  taskId: string,
): Promise<TaskRequirementHeadRow[] | null> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_TASK_REQUIREMENTS, {
    params: { projectRootId, taskId },
  });
  const rows = reply.data ?? [];
  if (rows.length === 0) {
    return null;
  }
  return rows.map((row) => ({
    revision: asString(row.revision),
    memory_id: asString(row.memory_id),
    memory_kind: asString(row.memory_kind),
    current_version_ids: asStringList(row.current_version_ids),
  }));
}

const READ_MEMORY_HEAD_ROWS_TASK = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})-[:HAS_TASK]->(t:Entity:Task {id: $taskId})-[:REQUIRES]->(m:Entity:Memory)
WHERE ($kind IS NULL OR m.kind = $kind)
  AND ($memoryId IS NULL OR m.id = $memoryId)
OPTIONAL MATCH (m)-[cur:CURRENT]->(curv:Entity:MemoryVersion)
OPTIONAL MATCH (m)-[:HAS_VERSION]->(cand:Entity:MemoryVersion)
WITH m, curv, collect(DISTINCT cand) AS cands
WHERE $focus IS NULL
   OR toLower(coalesce(curv.statement, '')) CONTAINS toLower($focus)
   OR any(c IN cands WHERE c.acceptance = 'proposed' AND toLower(coalesce(c.statement, '')) CONTAINS toLower($focus))
RETURN m.id AS memory_id, m.kind AS kind, curv.id AS current_version_id,
       curv.kind AS current_kind,
       [c IN cands WHERE c.acceptance = 'proposed' | c.id] AS candidate_version_ids,
       m.created_at_ms AS created_at_ms
ORDER BY created_at_ms DESC, memory_id ASC
LIMIT $limitPlusOne`;

const READ_MEMORY_HEAD_ROWS_PROJECT = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})-[:HAS_MEMORY]->(m:Entity:Memory)
WHERE ($kind IS NULL OR m.kind = $kind)
  AND ($memoryId IS NULL OR m.id = $memoryId)
OPTIONAL MATCH (m)-[cur:CURRENT]->(curv:Entity:MemoryVersion)
OPTIONAL MATCH (m)-[:HAS_VERSION]->(cand:Entity:MemoryVersion)
WITH m, curv, collect(DISTINCT cand) AS cands
WHERE $focus IS NULL
   OR toLower(coalesce(curv.statement, '')) CONTAINS toLower($focus)
   OR any(c IN cands WHERE c.acceptance = 'proposed' AND toLower(coalesce(c.statement, '')) CONTAINS toLower($focus))
RETURN m.id AS memory_id, m.kind AS kind, curv.id AS current_version_id,
       curv.kind AS current_kind,
       [c IN cands WHERE c.acceptance = 'proposed' | c.id] AS candidate_version_ids,
       m.created_at_ms AS created_at_ms
ORDER BY created_at_ms DESC, memory_id ASC
LIMIT $limitPlusOne`;

export interface MemoryHeadRow {
  readonly memory_id: string | null;
  readonly kind: string | null;
  readonly current_version_id: string | null;
  /** The kind the current version recorded; it must agree with the identity. */
  readonly current_kind: string | null;
  readonly candidate_version_ids: readonly string[];
  readonly created_at_ms: number | null;
}

export async function readScopedMemoryHeadRows(
  graph: Graph,
  params: {
    readonly projectRootId: string;
    readonly taskId: string | null;
    readonly memoryId: string | null;
    readonly kind: string | null;
    readonly focus: string | null;
    readonly limitPlusOne: number;
  },
): Promise<MemoryHeadRow[]> {
  const statement = params.taskId === null ? READ_MEMORY_HEAD_ROWS_PROJECT : READ_MEMORY_HEAD_ROWS_TASK;
  const reply = await graph.roQuery<Record<string, unknown>>(statement, {
    params: {
      projectRootId: params.projectRootId,
      taskId: params.taskId,
      memoryId: params.memoryId,
      kind: params.kind,
      focus: params.focus,
      limitPlusOne: params.limitPlusOne,
    },
  });
  return (reply.data ?? []).map((row) => ({
    memory_id: asString(row.memory_id),
    kind: asString(row.kind),
    current_version_id: asString(row.current_version_id),
    current_kind: asString(row.current_kind),
    candidate_version_ids: asStringList(row.candidate_version_ids),
    created_at_ms: asInteger(row.created_at_ms),
  }));
}

const READ_VERSION_DETAILS = `MATCH (v:Entity:MemoryVersion)
WHERE v.id IN $versionIds
MATCH (m:Entity:Memory {id: v.memory_id})
OPTIONAL MATCH (m)-[cur:CURRENT]->(v)
OPTIONAL MATCH (v)-[:SOURCED_FROM]->(a:Entity:SourceAnchor)
OPTIONAL MATCH (v)-[:CONTRADICTS]->(c:Entity:MemoryVersion)
RETURN v.id AS version_id, v.memory_id AS memory_id, v.kind AS kind, v.subtype AS subtype,
       v.statement AS statement, v.content_json AS content_json,
       v.applicability_json AS applicability_json,
       v.observed_under_json AS observed_under_json, v.acceptance AS acceptance,
       v.delegation AS delegation, v.evidence_precision AS evidence_precision,
       v.author_principal_id AS author_principal_id,
       v.accepted_by_principal_id AS accepted_by_principal_id,
       v.accept_reason AS accept_reason,
       v.supersedes_version_id AS supersedes_version_id,
       v.created_at_ms AS created_at_ms, v.observed_at_ms AS observed_at_ms,
       (cur IS NOT NULL) AS is_current,
       collect(DISTINCT a.id) AS source_ids,
       collect(DISTINCT c.id) AS contradicts_ids`;

export interface VersionDetailRow {
  readonly version_id: string | null;
  readonly memory_id: string | null;
  readonly kind: string | null;
  readonly subtype: string | null;
  readonly statement: string | null;
  readonly content_json: string | null;
  readonly applicability_json: string | null;
  readonly observed_under_json: string | null;
  readonly acceptance: string | null;
  readonly delegation: string | null;
  readonly evidence_precision: string | null;
  readonly author_principal_id: string | null;
  readonly accepted_by_principal_id: string | null;
  readonly accept_reason: string | null;
  readonly supersedes_version_id: string | null;
  readonly created_at_ms: number | null;
  readonly observed_at_ms: number | null;
  readonly is_current: boolean;
  readonly source_ids: readonly string[];
  readonly contradicts_ids: readonly string[];
}

export async function readVersionDetailRows(graph: Graph, versionIds: readonly string[]): Promise<VersionDetailRow[]> {
  if (versionIds.length === 0) {
    return [];
  }
  const reply = await graph.roQuery<Record<string, unknown>>(READ_VERSION_DETAILS, {
    params: { versionIds: [...versionIds] },
  });
  return (reply.data ?? []).map((row) => ({
    version_id: asString(row.version_id),
    memory_id: asString(row.memory_id),
    kind: asString(row.kind),
    subtype: asString(row.subtype),
    statement: asString(row.statement),
    content_json: asString(row.content_json),
    applicability_json: asString(row.applicability_json),
    observed_under_json: asString(row.observed_under_json),
    acceptance: asString(row.acceptance),
    delegation: asString(row.delegation),
    evidence_precision: asString(row.evidence_precision),
    author_principal_id: asString(row.author_principal_id),
    accepted_by_principal_id: asString(row.accepted_by_principal_id),
    accept_reason: asString(row.accept_reason),
    supersedes_version_id: asString(row.supersedes_version_id),
    created_at_ms: asInteger(row.created_at_ms),
    observed_at_ms: asInteger(row.observed_at_ms),
    is_current: row.is_current === true,
    source_ids: asStringList(row.source_ids),
    contradicts_ids: asStringList(row.contradicts_ids),
  }));
}

/**
 * Resolves the episodes a set of versions cite as supporting reuse.
 *
 * One bounded query for the whole page: the `SUPPORTED_BY` edges are followed
 * one step only, and each supporting version reports the outcome *it* recorded.
 * A procedure therefore cannot present a success its evidence never had, and a
 * later correction of a supporting episode is visible here as a different
 * outcome rather than being smoothed over.
 */
const READ_VERSION_SUPPORTS = `MATCH (v:Entity:MemoryVersion)-[:SUPPORTED_BY]->(s:Entity:MemoryVersion)
WHERE v.id IN $versionIds
RETURN v.id AS version_id, s.id AS support_version_id, s.memory_id AS support_memory_id,
       s.kind AS support_kind, s.content_json AS support_content_json,
       s.observed_under_json AS support_observed_under_json,
       s.observed_at_ms AS support_observed_at_ms, s.acceptance AS support_acceptance`;

export interface VersionSupportRow {
  readonly version_id: string | null;
  readonly support_version_id: string | null;
  readonly support_memory_id: string | null;
  readonly support_kind: string | null;
  readonly support_content_json: string | null;
  readonly support_observed_under_json: string | null;
  readonly support_observed_at_ms: number | null;
  readonly support_acceptance: string | null;
}

export async function readVersionSupportRows(
  graph: Graph,
  versionIds: readonly string[],
): Promise<VersionSupportRow[]> {
  if (versionIds.length === 0) {
    return [];
  }
  const reply = await graph.roQuery<Record<string, unknown>>(READ_VERSION_SUPPORTS, {
    params: { versionIds: [...versionIds] },
  });
  return (reply.data ?? []).map((row) => ({
    version_id: asString(row.version_id),
    support_version_id: asString(row.support_version_id),
    support_memory_id: asString(row.support_memory_id),
    support_kind: asString(row.support_kind),
    support_content_json: asString(row.support_content_json),
    support_observed_under_json: asString(row.support_observed_under_json),
    support_observed_at_ms: asInteger(row.support_observed_at_ms),
    support_acceptance: asString(row.support_acceptance),
  }));
}

const READ_MEMORY_STATE = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
OPTIONAL MATCH (p)-[:HAS_MEMORY]->(m:Entity:Memory {id: $memoryId})
OPTIONAL MATCH (m)-[cur:CURRENT]->(curv:Entity:MemoryVersion)
OPTIONAL MATCH (m)-[:HAS_VERSION]->(proposed:Entity:MemoryVersion)
WHERE proposed.acceptance = 'proposed'
RETURN m.id AS memory_id, m.kind AS kind, collect(DISTINCT curv.id) AS current_version_ids,
       collect(DISTINCT proposed.id) AS proposed_version_ids`;

export interface MemoryStateRow {
  readonly memoryExists: boolean;
  /** The kind the identity was created with; a correction may not change it. */
  readonly kind: string | null;
  readonly currentVersionIds: readonly string[];
  readonly proposedVersionIds: readonly string[];
}

export async function readMemoryState(graph: Graph, projectRootId: string, memoryId: string): Promise<MemoryStateRow> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_MEMORY_STATE, {
    params: { projectRootId, memoryId },
  });
  const row = reply.data?.[0];
  return {
    memoryExists: asString(row?.memory_id) !== null,
    kind: asString(row?.kind),
    currentVersionIds: asStringList(row?.current_version_ids),
    proposedVersionIds: asStringList(row?.proposed_version_ids),
  };
}

const READ_VERSION_STATE = `MATCH (v:Entity:MemoryVersion {id: $versionId})
RETURN v.acceptance AS acceptance, v.memory_id AS memory_id, v.kind AS kind`;

export interface VersionStateRow {
  readonly acceptance: string | null;
  readonly memoryId: string | null;
  readonly kind: string | null;
}

export async function readVersionState(graph: Graph, versionId: string): Promise<VersionStateRow | null> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_VERSION_STATE, { params: { versionId } });
  const row = reply.data?.[0];
  if (row === undefined) {
    return null;
  }
  return {
    acceptance: asString(row.acceptance),
    memoryId: asString(row.memory_id),
    kind: asString(row.kind),
  };
}

const READ_TASK_STATE = `MATCH (p:Entity:ProjectRoot {id: $projectRootId})
OPTIONAL MATCH (p)-[:HAS_TASK]->(t:Entity:Task {id: $taskId})
OPTIONAL MATCH (t)-[:REQUIRES]->(m:Entity:Memory)
RETURN t.id AS task_id, t.revision AS revision, t.state AS state,
       collect(DISTINCT m.id) AS required_memory_ids`;

export interface TaskStateRow {
  readonly taskExists: boolean;
  readonly revision: string | null;
  readonly state: string | null;
  readonly requiredMemoryIds: readonly string[];
}

export async function readTaskState(graph: Graph, projectRootId: string, taskId: string): Promise<TaskStateRow> {
  const reply = await graph.roQuery<Record<string, unknown>>(READ_TASK_STATE, {
    params: { projectRootId, taskId },
  });
  const row = reply.data?.[0];
  return {
    taskExists: asString(row?.task_id) !== null,
    revision: asString(row?.revision),
    state: asString(row?.state),
    requiredMemoryIds: asStringList(row?.required_memory_ids),
  };
}

const COUNT_SOURCE_ANCHORS = `MATCH (anchor:Entity:SourceAnchor)
WHERE anchor.id IN $sourceIds
RETURN count(anchor) AS anchor_count`;

/** How many of the named source anchors are present; used only to diagnose a refused commit. */
export async function countSourceAnchors(graph: Graph, sourceIds: readonly string[]): Promise<number> {
  if (sourceIds.length === 0) {
    return 0;
  }
  const reply = await graph.roQuery<Record<string, unknown>>(COUNT_SOURCE_ANCHORS, {
    params: { sourceIds: [...sourceIds] },
  });
  return asInteger(reply.data?.[0]?.anchor_count) ?? 0;
}

const COUNT_MEMORY_VERSIONS = `MATCH (v:Entity:MemoryVersion)
WHERE v.id IN $versionIds
RETURN count(v) AS version_count`;

/** How many of the named versions are present; used only to diagnose a refused commit. */
export async function countMemoryVersions(graph: Graph, versionIds: readonly string[]): Promise<number> {
  if (versionIds.length === 0) {
    return 0;
  }
  const reply = await graph.roQuery<Record<string, unknown>>(COUNT_MEMORY_VERSIONS, {
    params: { versionIds: [...versionIds] },
  });
  return asInteger(reply.data?.[0]?.version_count) ?? 0;
}

async function runCommit(
  graph: Graph,
  statement: string,
  params: NonNullable<NonNullable<Parameters<Graph['query']>[1]>['params']>,
): Promise<DecimalString | null> {
  const reply = await graph.query<Record<string, unknown>>(statement, { params });
  const row = reply.data?.[0];
  return row === undefined ? null : asDecimal(row.event_seq);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
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
