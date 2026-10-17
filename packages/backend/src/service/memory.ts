import { randomUUID } from 'node:crypto';

import type { Graph } from 'falkordb';

import {
  ThreadlineError,
  acceptMemoryInputSchema,
  correctMemoryInputSchema,
  encodeMemoryDocument,
  memoryContentFits,
  memoryQueryResultSchema,
  memoryQuerySchema,
  memoryViewSchema,
  parseContract,
  proposeMemoryInputSchema,
  recordEpisodeInputSchema,
  resolveMemoryContent,
  type MemoryAuthoring,
  type MemoryContent,
  type MemoryDocument,
  type MemoryOperationResult,
  type MemoryQueryResult,
  type MemorySupport,
  type MemoryView,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import type { SourceFileStore } from '../storage/files.js';
import type { GraphStore } from '../storage/graph.js';
import {
  projectRootIdFor,
  readScopedMemoryHeadRows,
  readVersionDetailRows,
  readVersionSupportRows,
  type MemoryHeadRow,
  type VersionDetailRow,
} from '../storage/memoryGraph.js';
import type { SqlDatabase } from '../storage/pg.js';
import { withProjectWriteLock } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import {
  MEMORY_DOCUMENT_MAX_BYTES,
  classifyDedupe,
  episodeRequestDigest,
  findIntentByKey,
  insertIntent,
  intentKeyFor,
  memoryRequestDigest,
  requireActiveProjectRoot,
  requireHumanAuthority,
  requireProjectScope,
  requireWriteRole,
  resolveVersionSupports,
  toMemoryOperationResult,
  toMemoryVersion,
  withGraphRead,
  type IntentRecord,
} from './semanticSupport.js';
import { classifyEpisodeEvidence } from './evidence.js';

/**
 * Memory admission, authority and reads for semantic and procedural memory.
 *
 * Content-bearing intents (`memory.propose`, `memory.correct`,
 * `memory.episode.record`) are captured as one immutable `memory_proposal`
 * Source holding the canonical intent document; the operation row stores
 * references, never content. A producer can only propose: acceptance and
 * correction are explicit human decisions recorded as new accepted versions,
 * and every commit is a guarded single graph statement performed by the leased
 * worker on this operation's behalf.
 *
 * Two things a caller may not do are decided here rather than trusted:
 *
 * - a procedure's state, review reference and supporting-episode set are
 *   resolved by this service (`resolveMemoryContent`), so a proposal cannot
 *   arrive already validated;
 * - an episode's evidence precision is resolved from the eligibility of its
 *   cited evidence (`classifyEpisodeEvidence`), so asking for `observed` without
 *   qualifying evidence is refused rather than quietly recorded as authored.
 *
 * Reads report exactly what the graph holds: the single accepted `CURRENT`
 * head, the bounded set of proposed candidates, and an explicit conflict rather
 * than a guess when authority is ambiguous.
 */

export interface MemoryService {
  propose(call: AuthenticatedCall, input: unknown): Promise<MemoryOperationResult>;
  accept(call: AuthenticatedCall, input: unknown): Promise<MemoryOperationResult>;
  correct(call: AuthenticatedCall, input: unknown): Promise<MemoryOperationResult>;
  recordEpisode(call: AuthenticatedCall, input: unknown): Promise<MemoryOperationResult>;
  query(call: AuthenticatedCall, input: unknown): Promise<MemoryQueryResult>;
  view(call: AuthenticatedCall, projectId: string, memoryId: string): Promise<MemoryView>;
}

export interface MemoryServiceDeps {
  readonly db: SqlDatabase;
  readonly files: SourceFileStore;
  readonly graphStore: GraphStore;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export function createMemoryService(deps: MemoryServiceDeps): MemoryService {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  const requireGraph = (call: AuthenticatedCall): Graph => {
    const graphKey = call.scope.graphKey;
    if (graphKey === null) {
      throw new ThreadlineError('storage_unavailable', 'FalkorDB is not configured for this service.');
    }
    return deps.graphStore.graph(graphKey);
  };

  /**
   * Semantic and procedural admission only.
   *
   * An episode arrives through its own operation, which resolves its evidence
   * precision, and a handoff is its own state machine in N04. A proposal
   * carries an authored statement or step list that must fit the admitted bound
   * before anything is published.
   */
  const requireAdmissibleContent = (authoring: MemoryAuthoring): void => {
    const resolved = resolveMemoryContent(authoring);
    if (resolved.kind === 'handoff' || resolved.kind === 'episodic') {
      throw new ThreadlineError(
        'unsupported',
        'This build admits semantic and procedural versions through proposals; an episode is recorded with memory.episode.record.',
      );
    }
    if (!memoryContentFits(resolved)) {
      throw new ThreadlineError('invalid_request', 'The memory version exceeds the admitted byte bound.');
    }
  };

  /**
   * The admission evidence gate reads only sources visible to the acting
   * principal. Missing and unreadable evidence produce one refusal, so the
   * response never confirms that an inaccessible source exists.
   */
  const requireVisibleEvidence = async (
    call: AuthenticatedCall,
    projectId: string,
    sourceIds: readonly string[],
  ): Promise<void> => {
    const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
      tx.rows<{ id: string; availability: string; visibility: string }>(
        `SELECT id, availability, visibility
           FROM threadline_memory.sources
          WHERE tenant_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])
            AND (visibility = 'project' OR owner_principal_id = $4)`,
        [call.scope.tenantId, projectId, [...sourceIds], call.scope.principalId],
      ),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const sourceId of sourceIds) {
      const row = byId.get(sourceId);
      if (row === undefined || row.visibility !== 'project') {
        throw new ThreadlineError(
          'not_found',
          'A cited source is not present in this project scope or cannot be admitted as evidence.',
        );
      }
      if (row.availability !== 'available') {
        throw new ThreadlineError('source_unavailable', 'A cited source is not available for admission as evidence.');
      }
    }
  };

  /**
   * Admits a content-bearing memory intent: publishes the canonical document
   * as immutable source bytes, catalogs it as a `memory_proposal` Source,
   * records the source-append that will anchor it, and records the memory
   * intent that references it — all in one transaction under the project write
   * lock. A retry with the same key and payload reads the first admission back.
   *
   * The identity lookup happens before the bytes are published. The document
   * carries an allocated memory and version id, so every attempt hashes to a
   * different digest; publishing first would strand an unreferenced object per
   * retry, and nothing reclaims those bytes. The in-transaction lookup stays as
   * the race guard, because a concurrent admission can appear between the two.
   */
  const admitDocumentIntent = async (
    call: AuthenticatedCall,
    projectId: string,
    intent: {
      readonly kind: 'memory.propose' | 'memory.correct' | 'memory.episode.record';
      readonly idempotencyKey: string;
      readonly requestDigest: string;
      readonly document: MemoryDocument;
    },
  ): Promise<MemoryOperationResult> => {
    const now = clock();
    const documentBytes = Buffer.from(encodeMemoryDocument(intent.document), 'utf8');
    if (documentBytes.byteLength > MEMORY_DOCUMENT_MAX_BYTES) {
      throw new ThreadlineError('invalid_request', 'The memory intent document exceeds the admitted byte bound.');
    }
    const operationKey = intentKeyFor(intent.kind, intent.idempotencyKey);
    const known = await withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
      const existing = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      return existing === null ? null : classifyDedupe(existing, call.scope.principalId, intent.requestDigest);
    });
    if (known !== null) {
      return toMemoryOperationResult(known);
    }
    const documentDigest = sha256Hex(documentBytes.toString('utf8'));
    const stored = await deps.files.publish({
      tenantId: call.scope.tenantId,
      projectId,
      digest: documentDigest,
      bytes: documentBytes,
      maxBytes: MEMORY_DOCUMENT_MAX_BYTES,
    });
    const contentSourceId = randomUUID();
    const operationId = randomUUID();
    const anchorKey = `source.append:${operationKey}`;

    const record = await withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
      const existing = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (existing !== null) {
        return classifyDedupe(existing, call.scope.principalId, intent.requestDigest);
      }
      const sequence = await tx.rows<{ next_source_seq: string }>(
        `UPDATE threadline_memory.projects
            SET next_source_seq = next_source_seq + 1
          WHERE tenant_id = $1 AND id = $2 AND state = 'active'
          RETURNING next_source_seq::text AS next_source_seq`,
        [call.scope.tenantId, projectId],
      );
      const projectSeq = sequence[0]?.next_source_seq;
      if (projectSeq === undefined) {
        throw new ThreadlineError('authority_unavailable', 'The project could not allocate an ingestion position.');
      }
      await tx.rows(
        `INSERT INTO threadline_memory.sources
           (tenant_id, project_id, id, delivery_id, origin_key, origin_revision, kind,
            producer_principal_id, producer_session_id, native_turn_ref, native_item_ref, native_tool_ref,
            native_order, parent_origin_key, session_seq, project_seq, observed_at, captured_at,
            visibility, owner_principal_id, digest, byte_size, storage_key, media_type,
            completeness, availability, retention, deletion_generation, consent_version, gap_reason)
         VALUES ($1, $2, $3, $4, $5, '1', 'memory_proposal',
                 $6, $7, NULL, NULL, NULL,
                 NULL, NULL, NULL, $8, $9, $9,
                 'project', NULL, $10, $11, $12, 'application/json',
                 'complete', 'available', 'retained', 0, 1, NULL)`,
        [
          call.scope.tenantId,
          projectId,
          contentSourceId,
          operationKey,
          `threadline:memory-document:${contentSourceId}`,
          call.scope.principalId,
          call.scope.nativeSessionId,
          projectSeq,
          now,
          documentDigest,
          documentBytes.byteLength,
          stored.storageKey,
        ],
      );
      await insertIntent(tx, call.scope.tenantId, projectId, {
        id: contentSourceId,
        kind: 'source.append',
        operationKey: anchorKey,
        requestDigest: canonicalDigest({
          digest: documentDigest,
          kind: 'memory_proposal',
          originKey: `threadline:memory-document:${contentSourceId}`,
          originRevision: '1',
        }),
        actorPrincipalId: call.scope.principalId,
        actorTokenId: call.tokenId,
        nativeSessionId: call.scope.nativeSessionId,
        graphEpoch: call.scope.graphEpoch ?? '00000000-0000-0000-0000-000000000000',
        privacyRevision: call.scope.privacyRevision ?? '0',
        payload: { sourceKind: 'memory_proposal' },
        createdAt: now,
        intentSourceId: contentSourceId,
      });
      await insertIntent(tx, call.scope.tenantId, projectId, {
        id: operationId,
        kind: intent.kind,
        operationKey,
        requestDigest: intent.requestDigest,
        actorPrincipalId: call.scope.principalId,
        actorTokenId: call.tokenId,
        nativeSessionId: call.scope.nativeSessionId,
        graphEpoch: call.scope.graphEpoch ?? '00000000-0000-0000-0000-000000000000',
        privacyRevision: call.scope.privacyRevision ?? '0',
        payload: { memoryMode: intent.document.memoryMode },
        createdAt: now,
        intentSourceId: contentSourceId,
        intentMemoryId: intent.document.memoryId,
        intentVersionId: intent.document.versionId,
        intentTaskId: intent.document.originTaskId,
        expectedHeadToken: intent.document.expectedHead,
      });
      const inserted = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (inserted === null) {
        throw new ThreadlineError('internal_error', 'The admitted operation could not be read back.');
      }
      return classifyDedupe(inserted, call.scope.principalId, intent.requestDigest);
    });

    logger.log({
      level: 'info',
      message: 'Memory intent admitted for graph commitment.',
      fields: { operationId: record.operationId, kind: intent.kind, state: record.state },
    });
    return toMemoryOperationResult(record);
  };

  /**
   * Admits an authority intent without content: acceptance and requirement
   * binding reference an existing version and carry only a bounded reason.
   */
  const admitPlainIntent = async (
    call: AuthenticatedCall,
    projectId: string,
    intent: {
      readonly kind: 'memory.accept' | 'task.create' | 'task.require';
      readonly idempotencyKey: string;
      readonly requestDigest: string;
      readonly payload: Record<string, unknown>;
      readonly operationId: string;
      readonly intentMemoryId?: string | null;
      readonly intentVersionId?: string | null;
      readonly intentTaskId?: string | null;
      readonly expectedHeadToken?: string | null;
      readonly expectedTaskRevision?: string | null;
    },
  ): Promise<IntentRecord> => {
    const operationKey = intentKeyFor(intent.kind, intent.idempotencyKey);
    const record = await withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
      const existing = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (existing !== null) {
        return classifyDedupe(existing, call.scope.principalId, intent.requestDigest);
      }
      await insertIntent(tx, call.scope.tenantId, projectId, {
        id: intent.operationId,
        kind: intent.kind,
        operationKey,
        requestDigest: intent.requestDigest,
        actorPrincipalId: call.scope.principalId,
        actorTokenId: call.tokenId,
        nativeSessionId: call.scope.nativeSessionId,
        graphEpoch: call.scope.graphEpoch ?? '00000000-0000-0000-0000-000000000000',
        privacyRevision: call.scope.privacyRevision ?? '0',
        payload: intent.payload,
        createdAt: clock(),
        intentMemoryId: intent.intentMemoryId ?? null,
        intentVersionId: intent.intentVersionId ?? null,
        intentTaskId: intent.intentTaskId ?? null,
        expectedHeadToken: intent.expectedHeadToken ?? null,
        expectedTaskRevision: intent.expectedTaskRevision ?? null,
      });
      const inserted = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (inserted === null) {
        throw new ThreadlineError('internal_error', 'The admitted operation could not be read back.');
      }
      return classifyDedupe(inserted, call.scope.principalId, intent.requestDigest);
    });
    logger.log({
      level: 'info',
      message: 'Memory authority intent admitted for graph commitment.',
      fields: { operationId: record.operationId, kind: intent.kind, state: record.state },
    });
    return record;
  };

  const normalizedUuidList = (values: readonly string[]): string[] => [...new Set(values)].sort();

  return {
    async propose(call, input): Promise<MemoryOperationResult> {
      const parsed = parseContract(proposeMemoryInputSchema, input, 'memory proposal input');
      requireProjectScope(call, parsed.projectId);
      requireWriteRole(call);
      requireAdmissibleContent(parsed.content);
      const memoryMode = parsed.memoryId === undefined || parsed.memoryId === null ? 'create' : 'attach';
      const memoryId = parsed.memoryId ?? randomUUID();
      const versionId = randomUUID();
      const sourceIds = normalizedUuidList(parsed.sourceIds);
      const contradictsVersionIds = normalizedUuidList(parsed.contradictsVersionIds ?? []);
      const expectedHead = parsed.expectedCurrentVersionId ?? null;
      if (memoryMode === 'create' && expectedHead !== null) {
        throw new ThreadlineError(
          'invalid_request',
          'expectedCurrentVersionId only applies when proposing a further version of an existing memory.',
        );
      }
      const originTaskId = parsed.taskId ?? null;
      await requireVisibleEvidence(call, parsed.projectId, sourceIds);
      // Resolved here, not authored: a proposal can never arrive already
      // validated, and the worker re-reads the resolved form from the document.
      const content = resolveMemoryContent(parsed.content);
      const document: MemoryDocument = {
        documentVersion: 1,
        operationKind: 'memory.propose',
        memoryId,
        memoryMode,
        versionId,
        content,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        contradictsVersionIds,
        originTaskId,
        expectedHead,
        reason: null,
        requestedEvidencePrecision: null,
      };
      const requestDigest = memoryRequestDigest({
        kind: 'memory.propose',
        projectId: parsed.projectId,
        memoryMode,
        requestedMemoryId: parsed.memoryId ?? null,
        content: parsed.content,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        contradictsVersionIds,
        originTaskId,
        expectedHead,
        reason: null,
        requestedEvidencePrecision: null,
      });
      return admitDocumentIntent(call, parsed.projectId, {
        kind: 'memory.propose',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest,
        document,
      });
    },

    /**
     * Records one attempted action and the outcome that was established for it.
     *
     * Each episode gets its own Memory identity and a single version: an episode
     * is a record of what happened, so it is never proposed, never corrected and
     * never revised. A report that turns out to be wrong is a *new* episode, and
     * the earlier one keeps the outcome it recorded.
     *
     * An `observed` request is honoured only when every cited source passes this
     * service's eligibility checks; otherwise the call is refused, because a
     * caller that asked for an observation must not be handed back a weaker
     * record without being told. The worker re-derives the same eligibility at
     * delivery from durable facts, so a document cannot grant itself precision.
     */
    async recordEpisode(call, input): Promise<MemoryOperationResult> {
      const parsed = parseContract(recordEpisodeInputSchema, input, 'episode recording input');
      requireProjectScope(call, parsed.projectId);
      requireWriteRole(call);
      const uncertainty = parsed.uncertainty ?? null;
      if (parsed.outcome === 'unknown' && uncertainty === null) {
        throw new ThreadlineError(
          'invalid_request',
          'An episode whose outcome is unknown must state its uncertainty rather than record a bare unknown.',
        );
      }
      const sourceIds = normalizedUuidList(parsed.sourceIds);
      await requireVisibleEvidence(call, parsed.projectId, sourceIds);
      const requested = parsed.evidencePrecision ?? null;
      const classification = await classifyEpisodeEvidence(
        { db: deps.db },
        {
          tenantId: call.scope.tenantId,
          projectId: parsed.projectId,
          sourceIds,
          principalId: call.scope.principalId,
        },
        requested,
      );
      const memoryId = randomUUID();
      const versionId = randomUUID();
      const originTaskId = parsed.taskId ?? null;
      const content: MemoryContent = {
        kind: 'episodic',
        action: parsed.action,
        outcome: parsed.outcome,
        observation: parsed.observation,
        uncertainty,
        evidencePrecision: classification.precision,
      };
      if (!memoryContentFits(content)) {
        throw new ThreadlineError('invalid_request', 'The episode exceeds the admitted byte bound.');
      }
      const document: MemoryDocument = {
        documentVersion: 1,
        operationKind: 'memory.episode.record',
        memoryId,
        memoryMode: 'create',
        versionId,
        content,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        contradictsVersionIds: [],
        originTaskId,
        expectedHead: null,
        reason: null,
        requestedEvidencePrecision: requested,
      };
      const requestDigest = episodeRequestDigest({
        kind: 'memory.episode.record',
        projectId: parsed.projectId,
        action: parsed.action,
        outcome: parsed.outcome,
        observation: parsed.observation,
        uncertainty,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        originTaskId,
        requestedEvidencePrecision: requested,
      });
      logger.log({
        level: 'info',
        message: 'Episode evidence classified.',
        fields: {
          actorPrincipalId: call.scope.principalId,
          evidencePrecision: classification.precision,
          evidenceClass: classification.class,
        },
      });
      return admitDocumentIntent(call, parsed.projectId, {
        kind: 'memory.episode.record',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest,
        document,
      });
    },

    async accept(call, input): Promise<MemoryOperationResult> {
      const parsed = parseContract(acceptMemoryInputSchema, input, 'memory acceptance input');
      requireProjectScope(call, parsed.projectId);
      requireHumanAuthority(call, 'Explicit memory acceptance');
      requireWriteRole(call);
      const reason = parsed.reason ?? null;
      const requestDigest = canonicalDigest({
        kind: 'memory.accept',
        projectId: parsed.projectId,
        memoryId: parsed.memoryId,
        versionId: parsed.versionId,
        expectedCurrentVersionId: parsed.expectedCurrentVersionId,
        reason,
      });
      const record = await admitPlainIntent(call, parsed.projectId, {
        kind: 'memory.accept',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest,
        payload: { reason },
        operationId: randomUUID(),
        intentMemoryId: parsed.memoryId,
        intentVersionId: parsed.versionId,
        expectedHeadToken: parsed.expectedCurrentVersionId,
      });
      return toMemoryOperationResult(record);
    },

    async correct(call, input): Promise<MemoryOperationResult> {
      const parsed = parseContract(correctMemoryInputSchema, input, 'memory correction input');
      requireProjectScope(call, parsed.projectId);
      requireHumanAuthority(call, 'Memory correction');
      requireWriteRole(call);
      requireAdmissibleContent(parsed.content);
      const sourceIds = normalizedUuidList(parsed.sourceIds);
      const contradictsVersionIds = normalizedUuidList(parsed.contradictsVersionIds ?? []);
      await requireVisibleEvidence(call, parsed.projectId, sourceIds);
      const versionId = randomUUID();
      // A correction supersedes the head it names; it never rewrites it, and it
      // may not change the kind of the identity it attaches to.
      const content = resolveMemoryContent(parsed.content);
      const document: MemoryDocument = {
        documentVersion: 1,
        operationKind: 'memory.correct',
        memoryId: parsed.memoryId,
        memoryMode: 'attach',
        versionId,
        content,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        contradictsVersionIds,
        originTaskId: null,
        expectedHead: parsed.expectedCurrentVersionId,
        reason: parsed.reason,
        requestedEvidencePrecision: null,
      };
      const requestDigest = memoryRequestDigest({
        kind: 'memory.correct',
        projectId: parsed.projectId,
        memoryMode: 'attach',
        requestedMemoryId: parsed.memoryId,
        content: parsed.content,
        applicability: parsed.applicability,
        observedUnder: parsed.observedUnder,
        sourceIds,
        contradictsVersionIds,
        originTaskId: null,
        expectedHead: parsed.expectedCurrentVersionId,
        reason: parsed.reason,
        requestedEvidencePrecision: null,
      });
      return admitDocumentIntent(call, parsed.projectId, {
        kind: 'memory.correct',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest,
        document,
      });
    },

    async query(call, input): Promise<MemoryQueryResult> {
      const parsed = parseContract(memoryQuerySchema, input, 'memory query');
      requireProjectScope(call, parsed.projectId);
      const graph = requireGraph(call);
      return withGraphRead(async () => {
        await requireActiveProjectRoot(graph, call);
        const limit = parsed.limit;
        const assemble = async (): Promise<MemoryQueryResult> => {
          const rows = await readScopedMemoryHeadRows(graph, {
            projectRootId: projectRootIdFor(parsed.projectId),
            taskId: parsed.taskId ?? null,
            memoryId: null,
            kind: parsed.kind ?? null,
            focus: parsed.focus ?? null,
            limitPlusOne: limit + 1,
          });
          const grouped = groupHeadRows(rows, parsed.taskId ?? null);
          const entries = [...grouped.entries()];
          const page = entries.slice(0, limit);
          const details = await loadVersionDetails(graph, page.map(([, row]) => row));
          const memories = page.map(([memoryId, row]) => assembleMemoryView(memoryId, row, details));
          return parseContract(
            memoryQueryResultSchema,
            { memories, hasMore: entries.length > limit },
            'memory query result',
          );
        };
        return withConsistencyRetry(assemble);
      });
    },

    async view(call, projectId, memoryId): Promise<MemoryView> {
      requireProjectScope(call, projectId);
      const graph = requireGraph(call);
      return withGraphRead(async () => {
        await requireActiveProjectRoot(graph, call);
        const assemble = async (): Promise<MemoryView> => {
          const rows = await readScopedMemoryHeadRows(graph, {
            projectRootId: projectRootIdFor(projectId),
            taskId: null,
            memoryId,
            kind: null,
            focus: null,
            limitPlusOne: 2,
          });
          const grouped = groupHeadRows(rows, null);
          const entry = [...grouped.entries()][0];
          if (entry === undefined) {
            throw new ThreadlineError('not_found', 'No such memory identity exists in this project scope.');
          }
          const [id, row] = entry;
          const details = await loadVersionDetails(graph, [row]);
          return assembleMemoryView(id, row, details);
        };
        return withConsistencyRetry(assemble);
      });
    },
  };
}

interface MemoryHeadGroup {
  readonly kind: string;
  readonly currentKind: string | null;
  readonly createdAtMs: number;
  readonly taskId: string | null;
  readonly currentIds: string[];
  readonly candidateIds: string[];
}

function groupHeadRows(rows: readonly MemoryHeadRow[], taskId: string | null): Map<string, MemoryHeadGroup> {
  const grouped = new Map<string, MemoryHeadGroup>();
  for (const row of rows) {
    if (row.memory_id === null || row.kind === null) {
      continue;
    }
    let entry = grouped.get(row.memory_id);
    if (entry === undefined) {
      entry = {
        kind: row.kind,
        currentKind: row.current_kind,
        createdAtMs: row.created_at_ms ?? 0,
        taskId,
        currentIds: [],
        candidateIds: [],
      };
      grouped.set(row.memory_id, entry);
    }
    if (row.current_version_id !== null && !entry.currentIds.includes(row.current_version_id)) {
      entry.currentIds.push(row.current_version_id);
    }
    for (const candidateId of row.candidate_version_ids) {
      if (!entry.candidateIds.includes(candidateId)) {
        entry.candidateIds.push(candidateId);
      }
    }
  }
  return grouped;
}

/**
 * Loads a page's versions and, in one extra bounded query, the episodes they
 * cite as supporting reuse.
 *
 * Both queries are keyed by the version ids already selected for this page, so
 * a scan never grows with the size of project memory.
 */
async function loadVersionDetails(
  graph: Graph,
  groups: readonly MemoryHeadGroup[],
): Promise<PageVersionDetail> {
  const versionIds = new Set<string>();
  for (const group of groups) {
    for (const id of group.currentIds) {
      versionIds.add(id);
    }
    for (const id of group.candidateIds) {
      versionIds.add(id);
    }
  }
  const ids = [...versionIds];
  const [rows, supportRows] = await Promise.all([
    readVersionDetailRows(graph, ids),
    readVersionSupportRows(graph, ids),
  ]);
  return {
    details: new Map(rows.map((detail) => [detail.version_id ?? '', detail])),
    supports: resolveVersionSupports(supportRows, ids),
  };
}

interface PageVersionDetail {
  readonly details: ReadonlyMap<string, VersionDetailRow>;
  readonly supports: ReadonlyMap<string, MemorySupport[]>;
}

function assembleMemoryView(memoryId: string, group: MemoryHeadGroup, page: PageVersionDetail): MemoryView {
  if (group.currentIds.length > 1) {
    throw new ThreadlineError(
      'authority_conflict',
      'This memory has more than one current version; authority is ambiguous and no head is reported.',
    );
  }
  let current: MemoryView['current'] = null;
  if (group.currentIds.length === 1) {
    const versionId = group.currentIds[0] ?? '';
    const detail = page.details.get(versionId);
    if (detail === undefined || !detail.is_current || detail.acceptance !== 'accepted') {
      throw new ThreadlineError(
        'authority_conflict',
        'The current version could not be resolved consistently; retry the read.',
      );
    }
    // The identity's kind and the head's own kind must agree. A disagreement
    // means a write changed one without the other, which is not authority a
    // read may resolve by preferring either side.
    if (group.currentKind !== null && detail.kind !== group.currentKind) {
      throw new ThreadlineError(
        'authority_conflict',
        'The current version records a different kind from its memory identity; no head is reported.',
      );
    }
    current = toMemoryVersion(detail, page.supports.get(versionId) ?? []);
  }
  const candidates = group.candidateIds
    .map((id) => {
      const detail = page.details.get(id);
      if (detail === undefined || detail.acceptance !== 'proposed') {
        throw new ThreadlineError(
          'authority_conflict',
          'A proposed candidate could not be resolved consistently; retry the read.',
        );
      }
      return { id, detail };
    })
    .sort(
      (left, right) =>
        (right.detail.created_at_ms ?? 0) - (left.detail.created_at_ms ?? 0) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 8)
    .map(({ id, detail }) => toMemoryVersion(detail, page.supports.get(id) ?? []));
  return parseContract(
    memoryViewSchema,
    { memoryId, kind: group.kind, taskId: group.taskId, current, candidates },
    'memory view',
  );
}

/**
 * A cross-query read is reassembled at most twice; a persistent inconsistency
 * is surfaced as an explicit conflict, never hidden by picking a winner.
 */
async function withConsistencyRetry<TResult>(work: () => Promise<TResult>): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ThreadlineError && error.code === 'authority_conflict') {
      return await work();
    }
    throw error;
  }
}
