import { createHash, randomUUID } from 'node:crypto';

import {
  contextManifestSchema,
  parseContract,
  sourceAppendInputSchema,
  sourceAppendResultSchema,
  sourceHistoryPageSchema,
  sourceHistoryQuerySchema,
  sourceRangeSchema,
  sourceViewSchema,
  SOURCE_LIMITS,
  ThreadlineError,
  compareDecimalStrings,
  type SourceAppendOutcome,
  type SourceAppendRecord,
  type SourceAppendResult,
  type SourceHistoryPage,
  type SourceRange,
  type SourceView,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import type { SourceFileStore } from '../storage/files.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import { withProjectWriteLock } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';
import { requireSafeManualText, MANUAL_SCANNER_VERSION } from './ingress.js';
import { encodePageCursor, decodePageCursor } from './cursors.js';
import { requireNativeSession } from './nativeAuthority.js';
import { createReleaseService, RELEASE_LIMITS, type ReleaseService } from './release.js';

/**
 * Source capture and history.
 *
 * An append normalizes and bounds its records first, publishes the permitted
 * bytes as immutable files, and only then takes the short project-scoped SQL
 * transaction that deduplicates, allocates ingestion positions and records the
 * Source plus its graph-admission operation. Standalone appends publish before
 * the project lock; an internal atomic caller may publish bounded metadata while
 * joining its existing transaction. Reads may join the same release barrier.
 * A retry of the same delivery is stable while a changed payload refuses.
 */

export interface SourceService {
  /** Trusted metadata-only publication, never reachable through public append input. */
  appendContextManifest(call: AuthenticatedCall, manifest: unknown, nonce: string, transaction: TxClient): Promise<SourceAppendResult>;
  /** Public append always requires knowledge-write permission. */
  append(call: AuthenticatedCall, input: unknown, transaction?: TxClient): Promise<SourceAppendResult>;
  view(call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient): Promise<SourceView>;
  range(call: AuthenticatedCall, projectId: string, sourceId: string, start?: number, end?: number, transaction?: TxClient): Promise<SourceRange>;
  history(call: AuthenticatedCall, query: unknown): Promise<SourceHistoryPage>;
}

export interface SourceServiceDeps {
  readonly db: SqlDatabase;
  readonly files: SourceFileStore;
  readonly release?: ReleaseService;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

/** One validated record, still encoded, with its decoded bytes. */
interface PreparedRecord {
  readonly record: SourceAppendRecord;
  readonly bytes: Buffer;
  readonly digest: string;
}

interface SourceRow {
  readonly id: string;
  readonly project_id: string;
  readonly kind: SourceView['kind'];
  readonly digest: string;
  readonly byte_size: string;
  readonly media_type: string;
  readonly observed_at: Date;
  readonly captured_at: Date;
  readonly completeness: SourceView['completeness'];
  readonly availability: SourceView['availability'];
  readonly retention: SourceView['retention'];
  readonly visibility: SourceView['visibility'];
  readonly producer_session_id: string | null;
  readonly native_turn_ref: string | null;
  readonly native_item_ref: string | null;
  readonly native_order: string | null;
  readonly parent_source_id: string | null;
  readonly origin_key: string;
  readonly origin_revision: string;
  readonly project_seq: string;
  readonly gap_reason: string | null;
  readonly storage_key: string;
}

/**
 * The visibility rule for resolving a parent source.
 *
 * A child can be project-visible while its parent is principal-private, so the
 * parent reference must be resolved under the *reader's* own visibility, not
 * the child's. Without this a public child discloses the identity of a parent
 * the caller is not allowed to read.
 *
 * The parameter position differs per query, so the placeholder is passed in
 * rather than fixed here — the rule stays single-sourced.
 */
const parentVisibleTo = (principalParam: string): string =>
  `(ps.visibility = 'project' OR ps.owner_principal_id = ${principalParam})`;

/**
 * The reading queries below bind the caller's principal id as `$4` (after
 * tenant, project and the source/sequence key), so the parent rule references
 * the same placeholder in every read path.
 */
const SOURCE_SELECT = `
  SELECT s.id, s.project_id, s.kind, s.digest, s.byte_size::text AS byte_size, s.media_type,
         s.observed_at, s.captured_at, s.completeness, s.availability, s.retention,
         s.visibility, s.producer_session_id, s.native_turn_ref, s.native_item_ref,
         s.native_order::text AS native_order,
         (SELECT ps.id FROM threadline_memory.sources ps
           WHERE ps.tenant_id = s.tenant_id AND ps.project_id = s.project_id
             AND ps.origin_key = s.parent_origin_key
             AND ${parentVisibleTo('$4')}
           ORDER BY ps.project_seq DESC LIMIT 1) AS parent_source_id,
         s.origin_key, s.origin_revision, s.project_seq::text AS project_seq,
         s.gap_reason, s.storage_key
    FROM threadline_memory.sources s`;

export function createSourceService(deps: SourceServiceDeps): SourceService {
  const release = deps.release ?? createReleaseService({ db: deps.db, files: deps.files });
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  const requireProject = (call: AuthenticatedCall, projectId: string): void => {
    requirePermission(call, 'read');
    if (call.scope.projectId === null || call.scope.projectId !== projectId) {
      throw new ThreadlineError('scope_denied', 'The credential is not scoped to that project.');
    }
  };

  const readRow = async (call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient): Promise<SourceRow> => {
    const read = (tx: TxClient) => tx.rows<SourceRow>(
        `${SOURCE_SELECT}
          WHERE s.tenant_id = $1 AND s.project_id = $2 AND s.id = $3
            AND (s.visibility = 'project' OR s.owner_principal_id = $4)`,
        [call.scope.tenantId, projectId, sourceId, call.scope.principalId],
      );
    const rows = transaction === undefined ? await deps.db.withTenantTransaction(call.scope.tenantId, read) : await read(transaction);
    const row = rows[0];
    if (row === undefined) {
      throw new ThreadlineError('not_found', 'No such source exists in this project scope.');
    }
    if (!await release.eligible(call, [{projectId, kind: 'source', id: sourceId}], transaction)) {
      throw new ThreadlineError('not_found', 'The requested resource does not exist.');
    }
    return row;
  };

  const toView = (row: SourceRow): SourceView => {
    const byteSize = Number(row.byte_size);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new ThreadlineError('internal_error', 'A source byte size is outside the safe range.');
    }
    return parseContract(
      sourceViewSchema,
      {
        sourceId: row.id,
        projectId: row.project_id,
        kind: row.kind,
        digest: row.digest,
        byteSize,
        mediaType: row.media_type,
        observedAtMs: row.observed_at.getTime(),
        capturedAtMs: row.captured_at.getTime(),
        completeness: row.completeness,
        availability: row.availability,
        retention: row.retention,
        visibility: row.visibility,
        nativeSessionId: row.producer_session_id,
        nativeTurnRef: row.native_turn_ref,
        nativeItemRef: row.native_item_ref,
        nativeOrder: row.native_order,
        parentSourceId: row.parent_source_id,
        originKey: row.origin_key,
        originRevision: row.origin_revision,
        projectSeq: row.project_seq,
        gapReason: row.gap_reason,
      },
      'source view',
    );
  };

  const appendStored = async (call: AuthenticatedCall, input: unknown, transaction?: TxClient): Promise<SourceAppendResult> => {
    const parsed = parseContract(sourceAppendInputSchema, input, 'source append');
    const projectId = parsed.projectId;
    requireProject(call, projectId);

    // Bound first: normalize and limit every record before anything durable
    // is written, so an oversized batch fails without a partial publication.
    const prepared: PreparedRecord[] = [];
    let batchBytes = 0;
    for (const record of parsed.records) {
      const bytes = decodeBase64(record.bytesBase64);
      if (bytes.byteLength > SOURCE_LIMITS.maxSourceBytes) {
        throw new ThreadlineError('invalid_request', 'A source record exceeds the maximum size.', {
          limit: SOURCE_LIMITS.maxSourceBytes,
          received: bytes.byteLength,
        });
      }
      batchBytes += bytes.byteLength;
      if (prepared.length + 1 > SOURCE_LIMITS.maxBatchRecords || batchBytes > SOURCE_LIMITS.maxBatchBytes) {
        throw new ThreadlineError('invalid_request', 'The source batch exceeds a declared capture limit.', {
          limitBytes: SOURCE_LIMITS.maxBatchBytes,
          records: prepared.length + 1,
        });
      }
      if (record.kind === 'capture_gap' && (record.gapReason ?? null) === null) {
        throw new ThreadlineError('invalid_request', 'A capture-gap record must state why evidence is missing.', {
          field: 'gapReason',
        });
      }
      if (record.kind !== 'context_manifest') {
        let text: string;
        try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
        catch { throw new ThreadlineError('invalid_request','Manual source content must be supported UTF-8 text.'); }
        if (text.includes('\0')) throw new ThreadlineError('invalid_request','Manual source content must be supported UTF-8 text.');
        requireSafeManualText(text);
        for (const [field,value] of Object.entries(record)) {
          if (field !== 'bytesBase64' && typeof value === 'string') requireSafeManualText(value);
        }
      }
      prepared.push({ record, bytes, digest: createHash('sha256').update(bytes).digest('hex') });
    }

    // Immutable bytes are published before the catalog row exists. A crash
    // between the two leaves a verified orphan object, never a dangling row.
    const stored = new Map<string, { storageKey: string }>();
    for (const item of prepared) {
      stored.set(item.record.deliveryId, await deps.files.publish({
        tenantId: call.scope.tenantId,
        projectId,
        digest: item.digest,
        bytes: item.bytes,
        maxBytes: SOURCE_LIMITS.maxSourceBytes,
      }));
    }

    const catalog = async (tx: TxClient): Promise<SourceAppendOutcome[]> => {
      const results: SourceAppendOutcome[] = [];
      for (const item of prepared) {
        results.push(await appendOne(tx, call, projectId, item, stored.get(item.record.deliveryId), clock()));
      }
      return results;
    };
    const outcomes = transaction === undefined
      ? await withProjectWriteLock(deps.db, call.scope.tenantId, projectId, catalog)
      : await catalog(transaction);

    let highest: string | null = null;
    for (const outcome of outcomes) {
      if (outcome.status !== 'rejected' && (highest === null || compareDecimalStrings(outcome.projectSeq, highest) > 0)) {
        highest = outcome.projectSeq;
      }
    }
    if (transaction === undefined) logger.log({
      level: 'info',
      message: 'Source append settled.',
      fields: {
        accepted: outcomes.filter((outcome) => outcome.status === 'accepted').length,
        duplicates: outcomes.filter((outcome) => outcome.status === 'duplicate').length,
        rejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
      },
    });
    return parseContract(
      sourceAppendResultSchema,
      { outcomes, projectSeq: highest },
      'source append result',
    );
  };

  return {
    async append(call, input, transaction) {
      requirePermission(call, 'knowledge.write');
      const parsed = parseContract(sourceAppendInputSchema, input, 'source append');
      if (parsed.records.some((record) => record.kind === 'context_manifest')) {
        throw new ThreadlineError('scope_denied', 'Context manifests require the trusted audit path.');
      }
      return appendStored(call, input, transaction);
    },
    async appendContextManifest(call, input, nonce, transaction) {
      requirePermission(call, 'context.audit');
      const manifest = parseContract(contextManifestSchema, input, 'context manifest');
      requireProject(call, manifest.projectId);
      const bytes = Buffer.from(JSON.stringify(manifest));
      return appendStored(call, { projectId: manifest.projectId, records: [{
        deliveryId: `context:${nonce}`, originKey: `threadline:context:${nonce}`, originRevision: '1',
        kind: 'context_manifest', mediaType: 'application/json', bytesBase64: bytes.toString('base64'),
        observedAtMs: clock().getTime(), completeness: 'complete',
      }] }, transaction);
    },

    async view(call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient): Promise<SourceView> {
      requireProject(call, projectId);
      return toView(await readRow(call, projectId, sourceId, transaction));
    },

    async range(
      call: AuthenticatedCall,
      projectId: string,
      sourceId: string,
      start = 0,
      end = SOURCE_LIMITS.maxRangeBytes,
      transaction?: TxClient,
    ): Promise<SourceRange> {
      requireProject(call, projectId);
      const row = await readRow(call, projectId, sourceId, transaction);
      if (row.availability !== 'available') {
        throw new ThreadlineError('source_unavailable', 'The source bytes are not available.', {
          availability: row.availability,
        });
      }
      const byteSize = Number(row.byte_size);
      const requestedEnd = Math.min(end, start + SOURCE_LIMITS.maxRangeBytes);
      const range = await deps.files.readRange({
        tenantId: call.scope.tenantId,
        projectId,
        storageKey: row.storage_key,
        digest: row.digest,
        byteSize,
        maxBytes: SOURCE_LIMITS.maxSourceBytes,
        start,
        end: requestedEnd,
      });
      return parseContract(
        sourceRangeSchema,
        {
          start: range.start,
          end: range.end,
          totalBytes: range.totalBytes,
          truncated: range.truncated,
          base64: range.bytes.toString('base64'),
        },
        'source range',
      );
    },

    async history(call: AuthenticatedCall, query: unknown): Promise<SourceHistoryPage> {
      const deadline = Date.now() + RELEASE_LIMITS.workMs;
      const parsed = parseContract(sourceHistoryQuerySchema, query, 'history query');
      requireProject(call, parsed.projectId);

      const kinds = parsed.kinds === undefined ? null : [...parsed.kinds].sort();
      const filterDigest = sha256Hex(
        canonicalDigest({
          kinds: kinds === null ? null : kinds.map((kind) => kind),
          nativeSessionId: parsed.nativeSessionId ?? null,
        }),
      );

      const afterSeq = decodePageCursor(call, filterDigest, parsed.cursor, '0');

      const limit = parsed.limit;
      const conditions: string[] = [
        's.tenant_id = $1',
        's.project_id = $2',
        "s.project_seq > $3::bigint",
        "(s.visibility = 'project' OR s.owner_principal_id = $4)",
      ];
      const values: unknown[] = [call.scope.tenantId, parsed.projectId, afterSeq, call.scope.principalId];
      if (kinds !== null) {
        values.push(kinds);
        conditions.push(`s.kind = ANY($${String(values.length)}::text[])`);
      }
      if (parsed.nativeSessionId !== undefined) {
        values.push(parsed.nativeSessionId);
        conditions.push(`s.producer_session_id = $${String(values.length)}::uuid`);
      }
      values.push(65);
      const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
        tx.rows<SourceRow>(
          `${SOURCE_SELECT}
            WHERE ${conditions.join(' AND ')}
            ORDER BY s.project_seq ASC
            LIMIT $${String(values.length)}`,
          values,
        ),
      );

      const scan = rows.slice(0,64);
      const eligible = await release.eligibleMany(call, scan.map((row) => [{projectId:parsed.projectId,kind:'source' as const,id:row.id}]), undefined, deadline);
      const entries: SourceView[] = [];
      let lastScanned = afterSeq;
      let hasMore = rows.length > scan.length;
      for (let index=0; index<scan.length; index++) {
        const row = scan[index]!;
        if (entries.length === limit) { hasMore = true; break; }
        lastScanned = row.project_seq;
        if (eligible[index]) entries.push(toView(row));
      }
      const nextCursor = hasMore ? encodePageCursor(call,filterDigest,lastScanned) : null;
      const unavailableCount = 0; // hidden resource counts are deliberately not disclosed

      return parseContract(
        sourceHistoryPageSchema,
        { entries, nextCursor, hasMore, unavailableCount },
        'history page',
      );
    },
  };
}

async function appendOne(
  tx: TxClient,
  call: AuthenticatedCall,
  projectId: string,
  item: PreparedRecord,
  stored: { storageKey: string } | undefined,
  now: Date,
): Promise<SourceAppendOutcome> {
  const { record } = item;
  if (stored === undefined) {
    throw new ThreadlineError('internal_error', 'Source bytes were not published before catalog insertion.');
  }

  // Validate attribution even on a byte-identical delivery retry. A duplicate
  // identity must not turn an unauthorized supplied session into an accepted
  // request, or keep accepting a now-closed session.
  if (record.nativeSessionId != null) {
    try { await requireNativeSession(tx, call, record.nativeSessionId); }
    catch (error) {
      if (!(error instanceof ThreadlineError) || error.code !== 'scope_denied') throw error;
      return {
        status: 'rejected', deliveryId: record.deliveryId, code: 'unknown_native_session',
        detail: 'No active native session belongs to this principal and binding.',
      };
    }
  }

  const duplicate = await findExisting(tx, call.scope.tenantId, projectId, record);
  if (duplicate !== null) {
    if (duplicate.digest === item.digest) {
      return {
        status: 'duplicate',
        deliveryId: record.deliveryId,
        sourceId: duplicate.id,
        projectSeq: duplicate.project_seq,
      };
    }
    return {
      status: 'rejected',
      deliveryId: record.deliveryId,
      code: 'idempotency_mismatch',
      detail: duplicate.same_delivery
        ? 'This delivery identity already exists with different bytes.'
        : 'This origin revision already exists with different bytes.',
    };
  }

  let parentOriginKey: string | null = null;
  if (record.parentOriginKey != null && record.parentOriginKey.length > 0) {
    // The parent is resolved under the appending principal's own visibility: an
    // actor cannot establish a link to a source it is not allowed to read.
    const parent = await tx.rows<{ id: string }>(
      `SELECT ps.id FROM threadline_memory.sources ps
        WHERE ps.tenant_id = $1 AND ps.project_id = $2 AND ps.origin_key = $3
          AND ${parentVisibleTo('$4')}
        ORDER BY ps.project_seq DESC LIMIT 1`,
      [call.scope.tenantId, projectId, record.parentOriginKey, call.scope.principalId],
    );
    if (parent[0] === undefined) {
      return {
        status: 'rejected',
        deliveryId: record.deliveryId,
        code: 'unknown_parent',
        detail: 'The parent origin was not found in this project.',
      };
    }
    parentOriginKey = record.parentOriginKey;
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

  const sourceId = randomUUID();
  const visibility = record.visibility ?? 'project';
  await tx.rows(
    `INSERT INTO threadline_memory.sources
       (tenant_id, project_id, id, delivery_id, origin_key, origin_revision, kind,
        producer_principal_id, producer_session_id, native_turn_ref, native_item_ref, native_tool_ref,
        native_order, parent_origin_key, session_seq, project_seq, observed_at, captured_at,
        visibility, owner_principal_id, digest, byte_size, storage_key, media_type,
        completeness, availability, retention, deletion_generation, consent_version, gap_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, 'available', $25, 0, 1, $26)`,
    [
      call.scope.tenantId,
      projectId,
      sourceId,
      record.deliveryId,
      record.originKey,
      record.originRevision,
      record.kind,
      call.scope.principalId,
      record.nativeSessionId ?? null,
      record.nativeTurnRef ?? null,
      record.nativeItemRef ?? null,
      record.nativeToolRef ?? null,
      record.nativeOrder ?? null,
      parentOriginKey,
      projectSeq,
      new Date(record.observedAtMs),
      now,
      visibility,
      visibility === 'principal' ? call.scope.principalId : null,
      item.digest,
      item.bytes.byteLength,
      stored.storageKey,
      record.mediaType ?? 'application/octet-stream',
      record.completeness,
      record.retention ?? 'raw_expiring',
      record.gapReason ?? null,
    ],
  );

  {
    await tx.rows(`UPDATE threadline_memory.sources SET release_state='eligible',sanitizer_version=$4
      WHERE tenant_id=$1 AND project_id=$2 AND id=$3`, [call.scope.tenantId, projectId, sourceId,MANUAL_SCANNER_VERSION]);
  }

  if (parentOriginKey !== null) {
    await tx.rows(
      `INSERT INTO threadline_memory.source_links
         (tenant_id, project_id, parent_source_id, child_source_id, relation, start_offset, end_offset,
          created_policy_version, created_at)
       SELECT $1, $2, ps.id, $3, 'depends_on', NULL, NULL, 1, $4
         FROM threadline_memory.sources ps
        WHERE ps.tenant_id = $1 AND ps.project_id = $2 AND ps.origin_key = $5
          AND ${parentVisibleTo('$6')}
        ORDER BY ps.project_seq DESC LIMIT 1
       ON CONFLICT DO NOTHING`,
      [call.scope.tenantId, projectId, sourceId, now, parentOriginKey, call.scope.principalId],
    );
  }

  // The graph admission intent is recorded with the source, in the same
  // transaction: a source that exists always has an operation that will either
  // commit its anchor or stay visibly pending. The worker that commits it lands
  // with the memory graph contract.
  await tx.rows(
    `INSERT INTO threadline_memory.operations
       (tenant_id, project_id, id, idempotency_key, kind, request_digest, actor_principal_id,
        actor_token_id, native_session_id, intent_source_id, graph_epoch, privacy_revision,
        payload, state, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, 'source.append', $5, $6, $7, $8, $3, $9, $10, $11::jsonb, 'pending', $12, $12)
     ON CONFLICT (tenant_id, project_id, idempotency_key) DO NOTHING`,
    [
      call.scope.tenantId,
      projectId,
      sourceId,
      `source.append:${record.deliveryId}`,
      canonicalDigest({ digest: item.digest, kind: record.kind, originKey: record.originKey, originRevision: record.originRevision }),
      call.scope.principalId,
      call.tokenId,
      record.nativeSessionId ?? null,
      call.scope.graphEpoch ?? '00000000-0000-0000-0000-000000000000',
      call.scope.privacyRevision ?? '0',
      JSON.stringify({ sourceKind: record.kind }),
      now,
    ],
  );

  return { status: 'accepted', deliveryId: record.deliveryId, sourceId, projectSeq };
}

async function findExisting(
  tx: TxClient,
  tenantId: string,
  projectId: string,
  record: SourceAppendRecord,
): Promise<{ id: string; digest: string; project_seq: string; same_delivery: boolean } | null> {
  const rows = await tx.rows<{ id: string; digest: string; project_seq: string; same_delivery: boolean }>(
    `SELECT id, digest, project_seq::text AS project_seq, (delivery_id = $3) AS same_delivery
       FROM threadline_memory.sources
      WHERE tenant_id = $1 AND project_id = $2
        AND (delivery_id = $3 OR (origin_key = $4 AND origin_revision = $5))
      ORDER BY (delivery_id = $3) DESC, project_seq ASC LIMIT 1`,
    [tenantId, projectId, record.deliveryId, record.originKey, record.originRevision],
  );
  return rows[0] ?? null;
}

function decodeBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)) {
    throw new ThreadlineError('invalid_request', 'Source bytes must be canonical base64.', {
      field: 'bytesBase64',
    });
  }
  return Buffer.from(trimmed, 'base64');
}
