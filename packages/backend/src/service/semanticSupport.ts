import type { Graph } from 'falkordb';

import {
  ThreadlineError,
  authorMemoryContent,
  memoryContentSchema,
  memorySupportSchema,
  memoryVersionSchema,
  parseContract,
  type Applicability,
  type EpisodeEvidencePrecision,
  type EpisodeOutcome,
  type MemoryAuthoring,
  type MemoryContent,
  type MemoryDocument,
  type MemoryOperationResult,
  type MemorySupport,
  type MemoryVersion,
  type ObservedUnder,
  type OperationState,
  type TaskOperationResult,
} from '@threadline/shared';

import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import {
  projectRootIdFor,
  readProjectRoot,
  type ProjectRootView,
  type VersionDetailRow,
  type VersionSupportRow,
} from '../storage/memoryGraph.js';
import type { TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';

/**
 * Shared admission and read support for memory and task intents.
 *
 * Authorization is resolved from the credential's stored scope, never from a
 * request body. Admission is idempotent per `(tenant, project, namespaced key)`:
 * the intent row is inserted once and a retry with the same key and the same
 * request digest reads the existing row back instead of creating a second
 * operation. A retry that reuses a key with a different payload — or a
 * different actor — is refused with `idempotency_mismatch`.
 *
 * A namespaced key is `<kind>:<sha256(idempotency key)>` so the stored key is
 * bounded (a caller key may be up to 200 bytes) while remaining one-to-one with
 * the caller's key inside one kind.
 */

export function requireProjectScope(call: AuthenticatedCall, projectId: string): void {
  if (call.scope.projectId === null || call.scope.projectId !== projectId) {
    throw new ThreadlineError('scope_denied', 'The credential is not scoped to that project.');
  }
}

/** Reads and writes of accepted memory require an owner or member grant. */
export function requireWriteRole(call: AuthenticatedCall): void {
  if (call.scope.role !== 'owner' && call.scope.role !== 'member') {
    throw new ThreadlineError(
      'scope_denied',
      'This project grant is read-only; accepted memory changes require an owner or member grant.',
    );
  }
}

/**
 * Human acceptance authority is resolved from the credential, not the body.
 *
 * A producer token cannot take it: the acceptance record names the acting
 * principal, and only a locally issued human administration credential acts as
 * a human authority here.
 */
export function requireHumanAuthority(call: AuthenticatedCall, action: string): void {
  if (call.scope.principalKind !== 'human' || call.scope.tokenKind !== 'human_admin') {
    throw new ThreadlineError(
      'scope_denied',
      `${action} requires the local human credential; a producer credential cannot grant itself human authority.`,
    );
  }
}

export function intentKeyFor(kind: string, idempotencyKey: string): string {
  return `${kind}:${sha256Hex(idempotencyKey)}`;
}

/**
 * A content-bearing memory intent, reduced to what the caller supplied.
 *
 * Identities this service allocates — a minted memory id, a fresh version id —
 * belong to the admitted operation, not to the request. They are deliberately
 * absent here: a caller that retries the same key with the same payload must
 * read the first admission back rather than collide with it.
 */
export interface MemoryRequestFacts {
  readonly kind: 'memory.propose' | 'memory.correct';
  readonly projectId: string;
  readonly memoryMode: 'create' | 'attach';
  /** The memory the caller named, or `null` when it asked for a new one. */
  readonly requestedMemoryId: string | null;
  /**
   * The authored form, never the resolved one. A procedure's state and review
   * reference are decided by this service, so including them here would make an
   * exact retry disagree with the admission it is retrying.
   */
  readonly content: MemoryAuthoring;
  readonly applicability: Applicability;
  readonly observedUnder: ObservedUnder;
  readonly sourceIds: readonly string[];
  readonly contradictsVersionIds: readonly string[];
  readonly originTaskId: string | null;
  readonly expectedHead: string | null;
  readonly reason: string | null;
  /** Evidence precision the caller asked for; `null` when it asked for none. */
  readonly requestedEvidencePrecision: EpisodeEvidencePrecision | null;
}

/**
 * One canonical request digest for a content-bearing memory intent, derived
 * identically at admission and at delivery so the worker can re-derive it from
 * durable facts and refuse a mismatched document.
 */
export function memoryRequestDigest(facts: MemoryRequestFacts): string {
  return canonicalDigest({
    kind: facts.kind,
    projectId: facts.projectId,
    memoryMode: facts.memoryMode,
    requestedMemoryId: facts.requestedMemoryId,
    content: facts.content,
    applicability: facts.applicability,
    observedUnder: facts.observedUnder,
    sourceIds: [...facts.sourceIds],
    contradictsVersionIds: [...facts.contradictsVersionIds],
    originTaskId: facts.originTaskId,
    expectedHead: facts.expectedHead,
    reason: facts.reason,
    requestedEvidencePrecision: facts.requestedEvidencePrecision,
  });
}

/**
 * The same facts, projected from a captured intent document.
 *
 * An episode is projected by {@link episodeDocumentRequestFacts} instead: its
 * facts are an evidence classification rather than an authored statement, and
 * routing it through this projection would silently drop that difference.
 */
export function memoryDocumentRequestFacts(projectId: string, document: MemoryDocument): MemoryRequestFacts {
  if (document.operationKind === 'memory.episode.record') {
    throw new ThreadlineError('internal_error', 'An episode document is projected by episodeDocumentRequestFacts.');
  }
  return {
    kind: document.operationKind,
    projectId,
    memoryMode: document.memoryMode,
    requestedMemoryId: document.memoryMode === 'create' ? null : document.memoryId,
    // Projected back to the authored form, so a digest never covers a decision
    // this service made rather than the caller.
    content: authorMemoryContent(document.content),
    applicability: document.applicability,
    observedUnder: document.observedUnder,
    sourceIds: document.sourceIds,
    contradictsVersionIds: document.contradictsVersionIds,
    originTaskId: document.originTaskId,
    expectedHead: document.expectedHead,
    reason: document.reason,
    requestedEvidencePrecision: document.requestedEvidencePrecision ?? null,
  };
}

/**
 * The durable facts one episode intent was admitted from.
 *
 * Separate from {@link MemoryRequestFacts} because an episode is not a proposal:
 * it carries the evidence precision the caller *asked* for and nothing about a
 * memory identity the caller may choose. The precision the server granted is
 * resolved from the cited evidence and recorded in the captured document, so an
 * exact retry still matches its first admission even if eligibility later moves.
 */
export interface EpisodeRequestFacts {
  readonly kind: 'memory.episode.record';
  readonly projectId: string;
  readonly action: string;
  readonly outcome: EpisodeOutcome;
  readonly observation: string;
  readonly uncertainty: string | null;
  readonly applicability: Applicability;
  readonly observedUnder: ObservedUnder;
  readonly sourceIds: readonly string[];
  readonly originTaskId: string | null;
  readonly requestedEvidencePrecision: EpisodeEvidencePrecision | null;
}

/** One canonical request digest for an episode intent, shared by admission and delivery. */
export function episodeRequestDigest(facts: EpisodeRequestFacts): string {
  return canonicalDigest({
    kind: facts.kind,
    projectId: facts.projectId,
    action: facts.action,
    outcome: facts.outcome,
    observation: facts.observation,
    uncertainty: facts.uncertainty,
    applicability: facts.applicability,
    observedUnder: facts.observedUnder,
    sourceIds: [...facts.sourceIds],
    originTaskId: facts.originTaskId,
    requestedEvidencePrecision: facts.requestedEvidencePrecision,
  });
}

/** The same episode facts, projected from a captured intent document. */
export function episodeDocumentRequestFacts(projectId: string, document: MemoryDocument): EpisodeRequestFacts {
  if (document.content.kind !== 'episodic') {
    throw new ThreadlineError('internal_error', 'An episode intent document does not carry episodic content.');
  }
  return {
    kind: 'memory.episode.record',
    projectId,
    action: document.content.action,
    outcome: document.content.outcome,
    observation: document.content.observation,
    uncertainty: document.content.uncertainty,
    applicability: document.applicability,
    observedUnder: document.observedUnder,
    sourceIds: document.sourceIds,
    originTaskId: document.originTaskId,
    requestedEvidencePrecision: document.requestedEvidencePrecision ?? null,
  };
}

/**
 * Bound on the captured intent document, including applicability and observed
 * context. The semantic statement itself is already bounded much tighter; this
 * is the whole-document ceiling the byte store and the worker share.
 */
export const MEMORY_DOCUMENT_MAX_BYTES = 128 * 1024;

/**
 * Renders one stored version row as the wire contract, refusing broken JSON.
 *
 * The version's own `content_json` is authoritative, because that is what the
 * correction chain preserved: a superseded procedure still shows its own steps
 * and a superseded episode still shows the outcome and uncertainty it recorded.
 * A row written before this column existed is reconstructed from its semantic
 * summary, which is exact for the only kind that could be written then.
 *
 * `supports` is supplied by the caller because it needs one bounded extra
 * query for the whole page rather than one per version.
 */
export function toMemoryVersion(detail: VersionDetailRow, supports: readonly MemorySupport[] = []): MemoryVersion {
  const applicability = parseStoredJson(detail.applicability_json, 'applicability');
  const observedUnder = parseStoredJson(detail.observed_under_json, 'observed context');
  return parseContract(
    memoryVersionSchema,
    {
      versionId: detail.version_id,
      memoryId: detail.memory_id,
      kind: detail.kind,
      content: storedContentOf(detail),
      acceptance: detail.acceptance,
      authorPrincipalId: detail.author_principal_id,
      authorSessionId: null,
      acceptedByPrincipalId: detail.accepted_by_principal_id,
      createdAtMs: detail.created_at_ms,
      observedAtMs: detail.observed_at_ms,
      sourceIds: [...detail.source_ids].sort(),
      sourceLinkIds: [],
      applicability,
      observedUnder,
      supersedesVersionId: detail.supersedes_version_id ?? null,
      contradictsVersionIds: [...detail.contradicts_ids].sort(),
      delegation: detail.delegation,
      evidencePrecision: detail.evidence_precision ?? null,
      supports: [...supports],
      acceptReason: detail.accept_reason ?? null,
    },
    'memory version',
  );
}

/**
 * The stored content of a version, validated against the one contract.
 *
 * A `content_json` that does not validate is reported as unavailable authority
 * rather than silently replaced: a version whose stored steps cannot be read
 * must not be presented as something smaller than it is.
 */
function storedContentOf(detail: VersionDetailRow): MemoryContent {
  if (detail.content_json === null) {
    return {
      kind: 'semantic',
      subtype: (detail.subtype ?? 'fact') as 'requirement' | 'decision' | 'fact',
      statement: detail.statement ?? '',
    };
  }
  const parsed = parseContract(
    memoryContentSchema,
    parseStoredJson(detail.content_json, 'memory content'),
    'stored memory content',
  );
  if (parsed.kind !== detail.kind) {
    throw new ThreadlineError(
      'authority_unavailable',
      'A stored memory version records a kind that disagrees with its identity.',
    );
  }
  return parsed;
}

/**
 * Resolves the episodes a page of versions cites as supporting reuse.
 *
 * Each reference reports the outcome the referenced episode *actually* recorded
 * and the conditions it was observed under. An episode that is not readable, is
 * no longer episodic, or has no stored outcome makes the reference an explicit
 * refusal rather than an omission, because silently dropping support would
 * understate what a procedure is known to rest on.
 */
export function resolveVersionSupports(
  rows: readonly VersionSupportRow[],
  versionIds: readonly string[],
): ReadonlyMap<string, MemorySupport[]> {
  const byVersion = new Map<string, VersionSupportRow[]>();
  for (const row of rows) {
    const versionId = row.version_id ?? '';
    const bucket = byVersion.get(versionId);
    if (bucket === undefined) {
      byVersion.set(versionId, [row]);
    } else {
      bucket.push(row);
    }
  }
  const resolved = new Map<string, MemorySupport[]>();
  for (const versionId of versionIds) {
    const bucket = byVersion.get(versionId);
    if (bucket === undefined || bucket.length === 0) {
      continue;
    }
    resolved.set(
      versionId,
      bucket.map((row) => toMemorySupport(row)).sort((left, right) =>
        left.versionId.localeCompare(right.versionId),
      ),
    );
  }
  return resolved;
}

function toMemorySupport(row: VersionSupportRow): MemorySupport {
  const versionId = row.support_version_id ?? '';
  const memoryId = row.support_memory_id ?? '';
  const content =
    row.support_content_json === null
      ? null
      : (safeParseStoredContent(row.support_content_json) as MemoryContent | null);
  if (content === null || content.kind !== 'episodic') {
    throw new ThreadlineError(
      'authority_unavailable',
      'A supporting reference does not resolve to a stored episodic version.',
      { supportVersionId: versionId },
    );
  }
  return parseContract(
    memorySupportSchema,
    {
      versionId,
      memoryId,
      outcome: content.outcome,
      observedUnder: parseStoredJson(row.support_observed_under_json ?? '', 'supporting observed context'),
      observedAtMs: row.support_observed_at_ms ?? 0,
    },
    'memory support',
  );
}

/** Parses stored content without refusing the whole read over one row. */
function safeParseStoredContent(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseStoredJson(text: string | null, label: string): unknown {
  if (text === null) {
    throw new ThreadlineError('authority_unavailable', `A stored ${label} member is missing from the graph.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ThreadlineError('authority_unavailable', `A stored ${label} member is not valid JSON.`);
  }
}

export interface IntentRecord {
  readonly operationId: string;
  readonly state: OperationState;
  readonly memoryId: string | null;
  readonly versionId: string | null;
  readonly taskId: string | null;
  readonly committedAtMs: number | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export interface ExistingIntentRow {
  readonly id: string;
  readonly actor_principal_id: string;
  readonly request_digest: string;
  readonly state: OperationState;
  readonly intent_memory_id: string | null;
  readonly intent_version_id: string | null;
  readonly intent_task_id: string | null;
  readonly receipt_committed_at: Date | null;
  readonly error_code: string | null;
  readonly error_detail: string | null;
}

export async function findIntentByKey(
  tx: TxClient,
  tenantId: string,
  projectId: string,
  operationKey: string,
): Promise<ExistingIntentRow | null> {
  const rows = await tx.rows<ExistingIntentRow>(
    `SELECT id, actor_principal_id, request_digest, state,
            intent_memory_id::text AS intent_memory_id,
            intent_version_id::text AS intent_version_id,
            intent_task_id::text AS intent_task_id,
            receipt_committed_at, error_code, error_detail
       FROM threadline_memory.operations
      WHERE tenant_id = $1 AND project_id = $2 AND idempotency_key = $3`,
    [tenantId, projectId, operationKey],
  );
  return rows[0] ?? null;
}

/**
 * One dedupe rule for every intent: same key, same actor, same canonical
 * request digest reads the existing operation back; anything else refuses.
 */
export function classifyDedupe(
  existing: ExistingIntentRow,
  actorPrincipalId: string,
  requestDigest: string,
): IntentRecord {
  if (existing.actor_principal_id !== actorPrincipalId || existing.request_digest !== requestDigest) {
    throw new ThreadlineError(
      'idempotency_mismatch',
      'This idempotency key already names a different intent; the recorded operation was not changed.',
    );
  }
  return {
    operationId: existing.id,
    state: existing.state,
    memoryId: existing.intent_memory_id,
    versionId: existing.intent_version_id,
    taskId: existing.intent_task_id,
    committedAtMs: existing.receipt_committed_at === null ? null : existing.receipt_committed_at.getTime(),
    errorCode: existing.error_code,
    errorDetail: existing.error_detail,
  };
}

export interface IntentInsert {
  readonly id: string;
  readonly kind: string;
  readonly operationKey: string;
  readonly requestDigest: string;
  readonly actorPrincipalId: string;
  readonly actorTokenId: string;
  readonly nativeSessionId: string | null;
  readonly graphEpoch: string;
  readonly privacyRevision: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly intentSourceId?: string | null;
  readonly intentMemoryId?: string | null;
  readonly intentVersionId?: string | null;
  readonly intentTaskId?: string | null;
  readonly expectedHeadToken?: string | null;
  readonly expectedTaskRevision?: string | null;
}

export async function insertIntent(tx: TxClient, tenantId: string, projectId: string, intent: IntentInsert): Promise<void> {
  await tx.rows(
    `INSERT INTO threadline_memory.operations
       (tenant_id, project_id, id, idempotency_key, kind, request_digest, actor_principal_id,
        actor_token_id, native_session_id, intent_source_id, intent_memory_id, intent_version_id,
        intent_task_id, expected_head_token, expected_task_revision, graph_epoch, privacy_revision,
        payload, state, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid, $13::uuid, $14, $15,
             $16, $17, $18::jsonb, 'pending', $19, $19)
     ON CONFLICT (tenant_id, project_id, idempotency_key) DO NOTHING`,
    [
      tenantId,
      projectId,
      intent.id,
      intent.operationKey,
      intent.kind,
      intent.requestDigest,
      intent.actorPrincipalId,
      intent.actorTokenId,
      intent.nativeSessionId,
      intent.intentSourceId ?? null,
      intent.intentMemoryId ?? null,
      intent.intentVersionId ?? null,
      intent.intentTaskId ?? null,
      intent.expectedHeadToken ?? null,
      intent.expectedTaskRevision ?? null,
      intent.graphEpoch,
      intent.privacyRevision,
      JSON.stringify(intent.payload),
      intent.createdAt,
    ],
  );
}

export function toMemoryOperationResult(record: IntentRecord): MemoryOperationResult {
  return {
    operationId: record.operationId,
    state: record.state,
    memoryId: record.memoryId,
    versionId: record.versionId,
    committedAtMs: record.committedAtMs,
    errorCode: record.errorCode,
    errorDetail: record.errorDetail,
  };
}

export function toTaskOperationResult(record: IntentRecord): TaskOperationResult {
  return {
    operationId: record.operationId,
    state: record.state,
    taskId: record.taskId as string,
    memoryId: record.memoryId,
    errorCode: record.errorCode,
    errorDetail: record.errorDetail,
  };
}

/**
 * Verifies the project graph root matches the scope the credential resolved.
 *
 * Reads compare the root against the epoch and privacy revision SQL recorded at
 * authentication time; a mismatch is `authority_unavailable`, never a partial
 * view assembled from two different graph identities.
 */
export async function requireActiveProjectRoot(graph: Graph, call: AuthenticatedCall): Promise<void> {
  const projectId = call.scope.projectId;
  if (projectId === null || call.scope.graphEpoch === null || call.scope.privacyRevision === null) {
    throw new ThreadlineError('scope_denied', 'The credential is not scoped to a project graph.');
  }
  const root = await readProjectRoot(graph, projectRootIdFor(projectId));
  if (root === null || root.graphEpoch === null) {
    throw new ThreadlineError(
      'authority_unavailable',
      'The project graph root is missing; accepted memory cannot be read yet.',
    );
  }
  assertRootMatchesScope(root, call.scope.graphEpoch, call.scope.privacyRevision);
}

export function assertRootMatchesScope(
  root: ProjectRootView,
  graphEpoch: string,
  privacyRevision: string,
): void {
  if (root.graphEpoch !== graphEpoch || root.privacyRevision !== privacyRevision) {
    throw new ThreadlineError(
      'authority_unavailable',
      'The project graph carries a different epoch or privacy revision than the credential resolved.',
    );
  }
  if (root.state !== 'active') {
    throw new ThreadlineError('authority_unavailable', 'The project graph root is not active.');
  }
}

/**
 * Graph reads fail closed: an unreachable or unreadable graph is
 * `authority_unavailable`, and an explicit service error passes through.
 */
export async function withGraphRead<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ThreadlineError) {
      throw error;
    }
    throw new ThreadlineError(
      'authority_unavailable',
      'The project graph is not reachable; current authority cannot be read.',
    );
  }
}
