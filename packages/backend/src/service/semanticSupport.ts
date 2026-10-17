import type { Graph } from 'falkordb';

import {
  ThreadlineError,
  memoryVersionSchema,
  parseContract,
  type Applicability,
  type MemoryContent,
  type MemoryDocument,
  type MemoryOperationResult,
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
  readonly content: MemoryContent;
  readonly applicability: Applicability;
  readonly observedUnder: ObservedUnder;
  readonly sourceIds: readonly string[];
  readonly contradictsVersionIds: readonly string[];
  readonly originTaskId: string | null;
  readonly expectedHead: string | null;
  readonly reason: string | null;
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
  });
}

/** The same facts, projected from a captured intent document. */
export function memoryDocumentRequestFacts(projectId: string, document: MemoryDocument): MemoryRequestFacts {
  return {
    kind: document.operationKind,
    projectId,
    memoryMode: document.memoryMode,
    requestedMemoryId: document.memoryMode === 'create' ? null : document.memoryId,
    content: document.content,
    applicability: document.applicability,
    observedUnder: document.observedUnder,
    sourceIds: document.sourceIds,
    contradictsVersionIds: document.contradictsVersionIds,
    originTaskId: document.originTaskId,
    expectedHead: document.expectedHead,
    reason: document.reason,
  };
}

/**
 * Bound on the captured intent document, including applicability and observed
 * context. The semantic statement itself is already bounded much tighter; this
 * is the whole-document ceiling the byte store and the worker share.
 */
export const MEMORY_DOCUMENT_MAX_BYTES = 128 * 1024;

/** Renders one stored version row as the wire contract, refusing broken JSON. */
export function toMemoryVersion(detail: VersionDetailRow): MemoryVersion {
  const applicability = parseStoredJson(detail.applicability_json, 'applicability');
  const observedUnder = parseStoredJson(detail.observed_under_json, 'observed context');
  return parseContract(
    memoryVersionSchema,
    {
      versionId: detail.version_id,
      memoryId: detail.memory_id,
      kind: detail.kind,
      content: { kind: 'semantic', subtype: detail.subtype, statement: detail.statement },
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
    },
    'memory version',
  );
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
