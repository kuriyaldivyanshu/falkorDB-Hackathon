import { type AdmissionService } from './admission.js';
import { encodePageCursor, decodePageCursor } from './cursors.js';
import { randomUUID } from 'node:crypto';

import {
  CONTEXT_EXCERPT_BYTES, CONTEXT_MAX_MANDATORY_ITEMS, CONTEXT_MAX_OPTIONAL_MEMORIES,
  CONTEXT_MAX_SOURCE_REFS, CONTEXT_MANIFEST_SCHEMA_VERSION, CONTEXT_RENDERER_VERSION,
  ThreadlineError, contextManifestSchema, contextOccurrenceSchema, contextResultSchema,
  parseContract, prepareContextInputSchema, recordOccurrenceInputSchema,
  type ContextItem, type ContextManifest, type ContextManifestItem, type ContextOccurrence,
  type ContextResult, type ContextSourceRef, type MemoryVersion, type PrepareContextInput,
  type TaskView,
} from '@threadline/shared';

import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import { readContextCandidates, readContextHeads, readContextRequirementIds, readContextTaskRevision } from '../storage/contextGraph.js';
import type { GraphStore } from '../storage/graph.js';
import { projectRootIdFor, readProjectRoot, readVersionDetailRows } from '../storage/memoryGraph.js';
import { projectWriteLockKey, type SqlDatabase, type TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';
import { requireNativeSession } from './nativeAuthority.js';
import { assertRootMatchesScope, requireProjectScope, toMemoryVersion, withGraphRead } from './semanticSupport.js';
import type { SourceService } from './sources.js';
import { lockReleaseAuthority, identityOf, type ReleaseService } from './release.js';
import type { TaskService } from './tasks.js';

export const CONTEXT_CANDIDATE_LIMIT = 32;
const MAX_ATTEMPTS = 2;

export interface ContextService {
  prepare(call: AuthenticatedCall, input: unknown): Promise<ContextResult>;
  recordOccurrence(call: AuthenticatedCall, input: unknown): Promise<ContextOccurrence>;
}
export interface ContextServiceDeps {
  readonly db: SqlDatabase;
  readonly admission: AdmissionService;
  readonly graphStore: GraphStore;
  readonly sources: SourceService;
  readonly tasks: TaskService;
  readonly release: ReleaseService;
  readonly clock?: () => Date;
}

/** One selector for every transport. No request text is copied into durable data. */
export function createContextService(deps: ContextServiceDeps): ContextService {
  const clock = deps.clock ?? (() => new Date());

  const graphFor = (call: AuthenticatedCall) => {
    if (call.scope.graphKey === null) throw new ThreadlineError('storage_unavailable', 'The project graph is unavailable.');
    return deps.graphStore.graph(call.scope.graphKey);
  };

  const rootFor = async (call: AuthenticatedCall) => {
    const root = await withGraphRead(() => readProjectRoot(graphFor(call), projectRootIdFor(call.scope.projectId!)));
    if (root === null || root.eventHead === null || root.graphEpoch === null || root.privacyRevision === null) {
      throw new ContextRefusal('store_unavailable');
    }
    try { assertRootMatchesScope(root, call.scope.graphEpoch!, call.scope.privacyRevision!); }
    catch { throw new ContextRefusal('stale_snapshot'); }
    return { graphEpoch: root.graphEpoch, graphHead: root.eventHead, privacyRevision: root.privacyRevision };
  };

  const taskFor = async (call: AuthenticatedCall, taskId: string | null | undefined): Promise<TaskView | null> => {
    if (taskId == null) return null;
    const ids = await withGraphRead(() => readContextRequirementIds(graphFor(call), projectRootIdFor(call.scope.projectId!), taskId));
    if (ids.length > CONTEXT_MAX_MANDATORY_ITEMS) throw new ContextRefusal('mandatory_overflow');
    const task = await deps.tasks.view(call, call.scope.projectId!, taskId);
    if (task.state !== 'open') throw new ContextRefusal('missing_current_authority');
    return task;
  };
  const checkTask = async (call: AuthenticatedCall, task: { taskId: string | null; taskRevision: string | null }): Promise<void> => {
    if (task.taskId === null) return;
    const revision = await withGraphRead(() => readContextTaskRevision(graphFor(call), projectRootIdFor(call.scope.projectId!), task.taskId!));
    if (revision !== task.taskRevision) throw new ContextRefusal('stale_snapshot');
  };

  /** Recheck current credential/grant/policy facts under the release SQL barrier.
   * clock_timestamp advances inside the transaction for absolute and idle expiry.
   * Bearer authentication at route entry remains the sole source of scope.
   */
  const releaseScope = async (tx: TxClient, call: AuthenticatedCall): Promise<void> => {
    const current = await lockReleaseAuthority(tx, identityOf(call));
    if (current.graphEpoch !== call.scope.graphEpoch || current.privacyRevision !== call.scope.privacyRevision) {
      throw new ContextRefusal('stale_snapshot');
    }
  };

  /** Full bounded SQL provenance closure, then the existing source service's
   * visibility, availability and whole-object digest verification. Never truncate refs.
   */
  const provenance = async (tx: TxClient, call: AuthenticatedCall, ids: readonly string[]): Promise<ContextSourceRef[]> => {
    if (ids.length === 0 || ids.length > CONTEXT_MAX_SOURCE_REFS) throw new ContextRefusal('incomplete_provenance');
    const seen = new Set(ids);
    let frontier = [...seen];
    while (frontier.length > 0) {
      const parents = await tx.rows<{ id: string }>(
        `SELECT DISTINCT parent_source_id AS id FROM threadline_memory.source_links
          WHERE tenant_id=$1 AND project_id=$2 AND child_source_id=ANY($3::uuid[])
          ORDER BY id LIMIT 65`,
        [call.scope.tenantId, call.scope.projectId, frontier],
      );
      if (parents.length > CONTEXT_MAX_SOURCE_REFS) throw new ContextRefusal('incomplete_provenance');
      frontier = [];
      for (const parent of parents) {
        if (!seen.has(parent.id)) { seen.add(parent.id); frontier.push(parent.id); }
      }
      if (seen.size > CONTEXT_MAX_SOURCE_REFS) throw new ContextRefusal('incomplete_provenance');
    }
    const refs: ContextSourceRef[] = [];
    for (const id of [...seen].sort()) {
      try {
        const source = await deps.sources.view(call, call.scope.projectId!, id, tx);
        if (source.visibility !== 'project' || source.availability !== 'available') {
          throw new ContextRefusal('incomplete_provenance');
        }
        // range verifies the complete object before returning even an empty slice.
        await deps.sources.range(call, call.scope.projectId!, id, 0, 0, tx);
        refs.push({ sourceId: id, kind: source.kind, digest: source.digest, start: null, end: null });
      } catch (error) {
        if (error instanceof ThreadlineError && ['not_found', 'source_unavailable', 'scope_denied'].includes(error.code)) {
          throw new ContextRefusal('incomplete_provenance');
        }
        throw error;
      }
    }
    return refs;
  };

  const version = async (call: AuthenticatedCall, memoryId: string, expected?: string): Promise<MemoryVersion> => {
    const graph = graphFor(call);
    const heads = await withGraphRead(() => readContextHeads(graph, projectRootIdFor(call.scope.projectId!), memoryId));
    if (heads.length !== 1 || (expected !== undefined && heads[0] !== expected)) {
      throw new ContextRefusal(expected === undefined ? 'missing_current_authority' : 'stale_preparation');
    }
    const rows = await withGraphRead(() => readVersionDetailRows(graph, heads));
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || !row.is_current || row.acceptance !== 'accepted' || row.memory_id !== memoryId) {
      throw new ContextRefusal('missing_current_authority');
    }
    return toMemoryVersion(row);
  };

  const makeItem = async (tx: TxClient, call: AuthenticatedCall, v: MemoryVersion, mandatory: boolean, taskId: string | null): Promise<ContextItem> => {
    if (v.content.kind !== 'semantic' && v.content.kind !== 'episodic') throw new ContextRefusal('missing_current_authority');
    const text = memoryText(v);
    return {
      priority: mandatory ? 'mandatory' : 'optional', kind: v.content.kind,
      memoryId: v.memoryId, versionId: v.versionId, taskId,
      applicability: v.applicability, observedUnder: v.observedUnder,
      representation: 'exact', text, byteLength: Buffer.byteLength(text, 'utf8'),
      reason: mandatory ? 'current_required_obligation' : v.content.kind === 'episodic' ? 'applicable_episode'
        : v.content.subtype === 'decision' ? 'accepted_decision' : 'accepted_fact',
      sourceRefs: await provenance(tx, call, v.sourceIds),
    };
  };

  const checkItemSources = async (tx: TxClient, call: AuthenticatedCall, items: readonly ContextItem[]): Promise<void> => {
    for (const item of items) {
      const refs = await provenance(tx, call, item.sourceRefs.map((ref) => ref.sourceId));
      if (canonicalDigest(refs) !== canonicalDigest(item.sourceRefs)) throw new ContextRefusal('incomplete_provenance');
    }
  };

  const replay = async (tx: TxClient, call: AuthenticatedCall, row: OccurrenceRow, parsed: PrepareContextInput): Promise<ContextResult> => {
    const before = await rootFor(call);
    const source = await deps.sources.view(call, parsed.projectId, row.manifest_source_id, tx);
    if (source.kind !== 'context_manifest' || source.availability !== 'available' || source.byteSize > 131072) {
      throw new ContextRefusal('incomplete_provenance');
    }
    const range = await deps.sources.range(call, parsed.projectId, row.manifest_source_id, 0, source.byteSize, tx);
    if (range.truncated) throw new ContextRefusal('incomplete_provenance');
    const manifest = parseContract(contextManifestSchema, JSON.parse(Buffer.from(range.base64, 'base64').toString('utf8')), 'context manifest');
    if (manifest.rendererVersion !== CONTEXT_RENDERER_VERSION) throw new ContextRefusal('stale_preparation');
    if (manifest.graphEpoch !== before.graphEpoch || manifest.privacyRevision !== before.privacyRevision) throw new ContextRefusal('stale_preparation');
    const task = await taskFor(call, parsed.taskId);
    if ((task?.revision ?? null) !== manifest.taskRevision) throw new ContextRefusal('stale_preparation');
    const items: ContextItem[] = [];
    for (const meta of manifest.items) {
      if (meta.memoryId === null || meta.versionId === null) throw new ContextRefusal('stale_preparation');
      const v = await version(call, meta.memoryId, meta.versionId);
      let item = await makeItem(tx, call, v, meta.priority === 'mandatory', meta.taskId);
      if (meta.representation === 'excerpt') item = excerpt(item);
      if (canonicalDigest(metadata(item)) !== canonicalDigest(meta)) throw new ContextRefusal('stale_preparation');
      items.push(item);
    }
    const required = items.filter((item) => item.priority === 'mandatory').map((item) => item.memoryId).sort();
    if (canonicalDigest(required) !== canonicalDigest([...(task?.requiredMemoryIds ?? [])].sort())) throw new ContextRefusal('stale_preparation');
    const body = render(items);
    if (sha256Hex(body) !== manifest.renderDigest || Buffer.byteLength(body) !== manifest.bodyBytes) throw new ContextRefusal('stale_preparation');
    await checkItemSources(tx, call, items);
    await checkTask(call, manifest);
    if (canonicalDigest(before) !== canonicalDigest(await rootFor(call))) throw new ContextRefusal('stale_snapshot');
    const candidates = await withGraphRead(() => readContextCandidates(graphFor(call), projectRootIdFor(parsed.projectId), 257,
      decodePageCursor(call, `context:${parsed.taskId ?? ''}:${parsed.focus ?? ''}`, parsed.discoveryCursor, '')));
    const discoveryCursor = candidates.length > 256
      ? encodePageCursor(call, `context:${parsed.taskId ?? ''}:${parsed.focus ?? ''}`, candidates[255]!) : null;
    return packet(manifest, row.manifest_source_id, row.id, items, body, clock().getTime(), discoveryCursor);
  };

  return {
    async prepare(call, input) {
      requirePermission(call, 'context.audit');
      const parsed = parseContract(prepareContextInputSchema, input, 'context preparation');
      requireProjectScope(call, parsed.projectId);
      validateHints(parsed);
      const ticket = await deps.admission.check(call, 'context.prepare', parsed);
      const nonce = canonicalDigest({ principalId: call.scope.principalId, key: parsed.idempotencyKey });
      const { idempotencyKey: _key, ...request } = parsed;
      const requestDigest = canonicalDigest(request);
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          return await withContextLock(deps.db, call, async (tx) => {
            await deps.admission.revalidate(ticket, tx);
            // A bounded database lock wait; no indefinite release barrier.
            await releaseScope(tx, call);
            await requireNativeSession(tx, call, parsed.nativeSessionId ?? null);
            const known = await tx.rows<OccurrenceRow>(
              `SELECT * FROM threadline_memory.context_occurrences WHERE tenant_id=$1 AND project_id=$2 AND nonce=$3`,
              [call.scope.tenantId, parsed.projectId, nonce],
            );
            if (known[0] !== undefined) {
              const row = known[0];
              if (row.principal_id !== call.scope.principalId || row.token_id !== call.tokenId || row.request_digest !== requestDigest) {
                throw new ThreadlineError('idempotency_mismatch', 'The context identity already names another request or credential.');
              }
              const result = await replay(tx, call, row, parsed);
              await releaseScope(tx, call);
              return result;
            }
            const before = await rootFor(call);
            const task = await taskFor(call, parsed.taskId);
            if ((task?.requiredMemoryIds.length ?? 0) > CONTEXT_MAX_MANDATORY_ITEMS) throw new ContextRefusal('mandatory_overflow');
            const items: ContextItem[] = [];
            const omissions: ContextManifest['omissions'] = [
              { kind: 'procedural', reason: 'candidate_procedure', count: 0 },
              { kind: 'handoff', reason: 'category_unavailable', count: 0 },
            ];
            const omit = (kind: ContextItem['kind'], reason: ContextManifest['omissions'][number]['reason']) => {
              const prior = omissions.find((entry) => entry.kind === kind && entry.reason === reason);
              if (prior === undefined) omissions.push({ kind, reason, count: 1 }); else prior.count++;
            };
            for (const id of [...(task?.requiredMemoryIds ?? [])].sort()) {
              if (!await deps.release.eligible(call, [{projectId: parsed.projectId,kind:'memory',id}], tx)) throw new ContextRefusal('missing_current_authority');
              const v = await version(call, id);
              if (v.content.kind !== 'semantic') throw new ContextRefusal('missing_current_authority');
              items.push(await makeItem(tx, call, v, true, parsed.taskId ?? null));
            }
            if (sourceIds(items).length > CONTEXT_MAX_SOURCE_REFS) throw new ContextRefusal('incomplete_provenance');
            if (Buffer.byteLength(render(items)) > parsed.maxBodyBytes) throw new ContextRefusal('mandatory_overflow');
            const candidates = await withGraphRead(() => readContextCandidates(graphFor(call), projectRootIdFor(parsed.projectId), 257,decodePageCursor(call,`context:${parsed.taskId??''}:${parsed.focus??''}`,parsed.discoveryCursor,'')));
            const scan = candidates.slice(0,256);
            const discoveryCursor = candidates.length>256 ? encodePageCursor(call,`context:${parsed.taskId??''}:${parsed.focus??''}`,scan.at(-1)!) : null;
            const eligible = await deps.release.eligibleMany(call, scan.map(id=>[{projectId:parsed.projectId,kind:'memory' as const,id}]),tx);
            const ranked: MemoryVersion[] = [];
            for (const [index,id] of scan.entries()) {
              if (task?.requiredMemoryIds.includes(id)) continue;
              try {
                if (!eligible[index]) continue;
                const v = await version(call, id);
                if (v.content.kind === 'semantic' && v.content.subtype === 'requirement') continue;
                if (!applicable(v, parsed, task)) { omit(v.content.kind, 'not_applicable'); continue; }
                ranked.push(v);
              } catch (error) {
                if (error instanceof ContextRefusal) continue;
                throw error;
              }
            }
            // Truncation concerns eligible/applicable candidates only. Do not
            // publish private skipped counts. A fixed count-free coverage marker
            // describes the bounded discovery policy on every packet.
            omissions.push({kind:'orientation',reason:'candidate_limit',count:0});
            ranked.sort((a, b) => priority(a) - priority(b) || focusScore(b, parsed.focus) - focusScore(a, parsed.focus)
              || b.createdAtMs - a.createdAtMs || a.memoryId.localeCompare(b.memoryId));
            for (const v of ranked) {
              if (items.filter((item) => item.priority === 'optional').length >= CONTEXT_MAX_OPTIONAL_MEMORIES) {
                omit(v.content.kind, 'optional_budget_exhausted'); continue;
              }
              let item: ContextItem;
              try { item = await makeItem(tx, call, v, false, parsed.taskId ?? null); }
              catch (error) {
                if (error instanceof ContextRefusal) { omit('orientation', 'source_unavailable'); continue; }
                throw error;
              }
              if (sourceIds([...items, item]).length > CONTEXT_MAX_SOURCE_REFS) {
                omit('orientation', 'source_reference_limit'); continue;
              }
              if (Buffer.byteLength(render([...items, item])) > parsed.maxBodyBytes) item = excerpt(item);
              if (Buffer.byteLength(render([...items, item])) > parsed.maxBodyBytes) { omit(item.kind, 'optional_budget_exhausted'); continue; }
              items.push(item);
            }
            const body = render(items);
            const manifest = parseContract(contextManifestSchema, {
              manifestVersion: CONTEXT_MANIFEST_SCHEMA_VERSION, rendererVersion: CONTEXT_RENDERER_VERSION,
              projectId: parsed.projectId, taskId: parsed.taskId ?? null, taskRevision: task?.revision ?? null,
              focusDigest: null, ...before,
              bodyBytes: Buffer.byteLength(body), maxBodyBytes: parsed.maxBodyBytes,
              items: items.map(metadata), omissions, renderDigest: sha256Hex(body),
              selectedSourceIds: sourceIds(items), selectionPolicyVersion: 1,
            }, 'context manifest');
            // Recheck provenance immediately before the final graph-head check.
            await checkItemSources(tx, call, items);
            await releaseScope(tx, call);
            await checkTask(call, manifest);
            if (canonicalDigest(before) !== canonicalDigest(await rootFor(call))) throw new ContextRefusal('stale_snapshot');
            const outcome = (await deps.sources.appendContextManifest(call, manifest, nonce, tx)).outcomes[0];
            if (outcome === undefined || outcome.status === 'rejected') throw new ThreadlineError('idempotency_mismatch', 'The context manifest identity is unavailable.');
            const dependencies = [
              ...items.map((item) => ({kind:'version',id:item.versionId})),
              ...sourceIds(items).map((id) => ({kind:'source',id})),
              ...(task ? [{kind:'task',id:task.taskId}] : []),
            ];
            for (const dependency of dependencies) await tx.rows(`INSERT INTO threadline_memory.release_dependencies
              (tenant_id,project_id,resource_kind,resource_id,dependency_project_id,dependency_kind,dependency_id)
              VALUES ($1,$2,'source',$3,$2,$4,$5) ON CONFLICT DO NOTHING`,
            [call.scope.tenantId,parsed.projectId,outcome.sourceId,dependency.kind,dependency.id]);
            const id = randomUUID();
            await tx.rows(
              `INSERT INTO threadline_memory.context_occurrences
               (tenant_id,project_id,id,manifest_source_id,principal_id,token_id,native_session_id,task_id,
                packet_digest,graph_epoch,graph_head,privacy_revision,state,nonce,request_digest,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::bigint,$12::bigint,'prepared',$13,$14,$15)`,
              [call.scope.tenantId, parsed.projectId, id, outcome.sourceId, call.scope.principalId, call.tokenId,
                parsed.nativeSessionId ?? null, parsed.taskId ?? null, manifest.renderDigest, before.graphEpoch,
                before.graphHead, before.privacyRevision, nonce, requestDigest, clock()],
            );
            // This is the selection consistency point. The source append operation
            // cannot be leased until SQL commits; its later graph event is separate.
            await checkItemSources(tx, call, items);
            await checkTask(call, manifest);
            if (canonicalDigest(before) !== canonicalDigest(await rootFor(call))) throw new ContextRefusal('stale_snapshot');
            const result = packet(manifest, outcome.sourceId, id, items, body, clock().getTime(),discoveryCursor);
            // Last asynchronous work before commit/release, including time spent
            // reading graph state and validating the complete released packet.
            await releaseScope(tx, call);
            return result;
          });
        } catch (error) {
          const refusal = classifyRefusal(error);
          if (refusal === null) throw error;
          if (refusal === 'stale_snapshot' && attempt + 1 < MAX_ATTEMPTS) continue;
          return { kind: 'refused', reason: refusal, detail: null };
        }
      }
      return { kind: 'refused', reason: 'stale_snapshot', detail: null };
    },

    async recordOccurrence(call, input) {
      requirePermission(call, 'context.audit');
      const parsed = parseContract(recordOccurrenceInputSchema, input, 'context occurrence');
      requireProjectScope(call, parsed.projectId);
      if (parsed.state === 'native_observed') throw new ThreadlineError('unsupported', 'Native context observation requires qualified evidence and is unavailable.');
      if (!['emitted', 'unknown', 'refused'].includes(parsed.state)) throw new ThreadlineError('invalid_request', 'An occurrence can only leave prepared for a reported terminal state.');
      const ticket = await deps.admission.check(call, 'context.occurrence', parsed);
      const key = sha256Hex(parsed.idempotencyKey);
      const { idempotencyKey: _key, ...request } = parsed;
      const digest = canonicalDigest(request);
      return withContextLock(deps.db, call, async (tx) => {
        await deps.admission.revalidate(ticket, tx);
        await releaseScope(tx, call);
        const rows = await tx.rows<OccurrenceRow>(
          `SELECT * FROM threadline_memory.context_occurrences
            WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND principal_id=$4 AND token_id=$5 FOR UPDATE`,
          [call.scope.tenantId, parsed.projectId, parsed.occurrenceId, call.scope.principalId, call.tokenId],
        );
        const row = rows[0];
        if (row === undefined) throw new ThreadlineError('not_found', 'No such occurrence exists in this credential scope.');
        await requireNativeSession(tx, call, row.native_session_id);
        if (row.update_key === key) {
          if (row.update_digest !== digest) throw new ThreadlineError('idempotency_mismatch', 'This occurrence update identity names another report.');
          const result = occurrence(row);
          await releaseScope(tx, call);
          return result;
        }
        if (row.state !== parsed.expectedState) throw new ThreadlineError('stale_revision', 'The occurrence has already left the expected state.');
        const updated = await tx.rows<OccurrenceRow>(
          `UPDATE threadline_memory.context_occurrences SET state=$4,boundary=$5,refusal_reason=$6,
             emitted_at=$7,update_key=$8,update_digest=$9
           WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND state='prepared' RETURNING *`,
          [call.scope.tenantId, parsed.projectId, parsed.occurrenceId, parsed.state, parsed.boundary ?? null,
            parsed.refusalReason ?? null, parsed.state === 'emitted' ? clock() : null, key, digest],
        );
        if (updated[0] === undefined) throw new ThreadlineError('stale_revision', 'The occurrence changed before the report.');
        const result = occurrence(updated[0]);
        await releaseScope(tx, call);
        return result;
      });
    },
  };
}

type RefusalReason = Extract<ContextResult, { kind: 'refused' }>['reason'];
class ContextRefusal extends ThreadlineError {
  constructor(readonly reason: RefusalReason) { super('authority_unavailable', 'Context preparation refused.'); }
}
function classifyRefusal(error: unknown): RefusalReason | null {
  if (error instanceof ContextRefusal) return error.reason;
  if (error instanceof ThreadlineError) {
    if (['storage_unavailable', 'authority_unavailable'].includes(error.code)) return 'store_unavailable';
    if (error.code === 'authority_conflict') return 'missing_current_authority';
    if (error.code === 'deleting') return 'deleting';
  }
  return null;
}

function validateHints(input: PrepareContextInput): void {
  const keys = input.conditions?.selectionHints.map((hint) => hint.key) ?? [];
  if (new Set(keys).size !== keys.length) throw new ThreadlineError('invalid_request', 'Context condition keys must be unique.');
}
function applicable(v: MemoryVersion, input: PrepareContextInput, task: TaskView | null): boolean {
  const facts = new Map<string, readonly string[]>();
  for (const hint of input.conditions?.selectionHints ?? []) facts.set(hint.key, hint.values);
  if (task?.taskFamily != null) facts.set('task_family', [task.taskFamily]);
  return v.applicability.predicates.every((predicate) => {
    const values = facts.get(predicate.key);
    if (values === undefined || values.length === 0) return false;
    if (predicate.operator === 'present') return predicate.values.length === 0;
    if (predicate.operator === 'equals') return predicate.values.length === 1 && values.length === 1 && values[0] === predicate.values[0];
    return predicate.values.length > 0 && values.every((value) => predicate.values.includes(value));
  });
}
function memoryText(v: MemoryVersion): string {
  const content = v.content;
  if (content.kind === 'semantic') return content.statement;
  if (content.kind === 'episodic') return `Evidence: ${content.evidencePrecision}; outcome: ${content.outcome}\nAction: ${content.action}\nObservation: ${content.observation}\nUncertainty: ${content.uncertainty ?? 'none stated'}`;
  throw new ContextRefusal('missing_current_authority');
}
function priority(v: MemoryVersion): number {
  if (v.content.kind === 'episodic' && v.content.outcome !== 'succeeded') return 0;
  if (v.content.kind === 'semantic') return v.content.subtype === 'decision' ? 1 : 2;
  return 3;
}
function focusScore(v: MemoryVersion, focus: string | undefined): number {
  return focus !== undefined && memoryText(v).toLowerCase().includes(focus.toLowerCase()) ? 1 : 0;
}
function excerpt(item: ContextItem): ContextItem {
  // Prefix the whole episode with its precision/outcome, before truncating.
  let text = '';
  for (const point of item.text ?? '') {
    if (Buffer.byteLength(text + point, 'utf8') > CONTEXT_EXCERPT_BYTES) break;
    text += point;
  }
  return { ...item, text, representation: 'excerpt', byteLength: Buffer.byteLength(text) };
}
function sourceIds(items: readonly ContextItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.sourceRefs.map((ref) => ref.sourceId)))].sort();
}
function metadata(item: ContextItem): ContextManifestItem {
  // Explicit allowlist: new released plaintext fields must never be persisted
  // by a rest/spread or an omit(text)-only projection.
  return {
    priority: item.priority, kind: item.kind, memoryId: item.memoryId,
    versionId: item.versionId, taskId: item.taskId, representation: item.representation,
    reason: item.reason, sourceRefs: item.sourceRefs, byteLength: item.byteLength,
  };
}
function render(items: readonly ContextItem[]): string {
  return ['# Threadline context', ...items.map((item) =>
    `## ${item.priority} ${item.kind} (${item.representation}) ${item.memoryId}@${item.versionId}\n${item.text ?? ''}\nApplicability (current selection predicates; caller hints are not verified facts): ${JSON.stringify(item.applicability)}\nObserved under (historical conditions, not current applicability): ${JSON.stringify(item.observedUnder)}\nSources:\n${item.sourceRefs.map((ref) => `${ref.sourceId} ${ref.kind} sha256:${ref.digest}`).join('\n')}`,
  )].join('\n\n');
}
function packet(manifest: ContextManifest, sourceId: string, occurrenceId: string, items: ContextItem[], body: string, releasedAtMs: number, discoveryCursor: string|null = null): ContextResult {
  return parseContract(contextResultSchema, { kind: 'packet', packet: {
    manifest, manifestSourceId: sourceId, manifestOperationId: sourceId, occurrenceId, items, body, releasedAtMs,discoveryCursor,
  } }, 'context result');
}
interface OccurrenceRow {
  [key: string]: unknown;
  id: string; manifest_source_id: string; project_id: string; task_id: string | null;
  native_session_id: string | null; principal_id: string; token_id: string | null;
  state: ContextOccurrence['state']; boundary: string | null; native_turn_ref: string | null;
  packet_digest: string; privacy_revision: string; emitted_at: Date | null; refusal_reason: string | null;
  request_digest: string | null; update_key: string | null; update_digest: string | null;
}
function occurrence(row: OccurrenceRow): ContextOccurrence {
  return parseContract(contextOccurrenceSchema, {
    occurrenceId: row.id, manifestSourceId: row.manifest_source_id, projectId: row.project_id,
    taskId: row.task_id, nativeSessionId: row.native_session_id, state: row.state,
    boundary: row.boundary, nativeTurnRef: row.native_turn_ref, packetDigest: row.packet_digest,
    privacyRevision: row.privacy_revision, emittedAtMs: row.emitted_at?.getTime() ?? null, refusalReason: row.refusal_reason,
  }, 'context occurrence');
}
/** Local timeouts are set before waiting for the project lock. All SQL reads
 * during selection reuse this transaction, preventing pool starvation. */
async function withContextLock<T>(db: SqlDatabase, call: AuthenticatedCall, work: (tx: TxClient) => Promise<T>): Promise<T> {
  return db.withTenantTransaction(call.scope.tenantId, async (tx) => {
    await tx.rows("SET LOCAL lock_timeout = '2000ms'");
    await tx.rows("SET LOCAL statement_timeout = '10000ms'");
    await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [projectWriteLockKey(call.scope.tenantId, call.scope.projectId!)]);
    return work(tx);
  });
}
