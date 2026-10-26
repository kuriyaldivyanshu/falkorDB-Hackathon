import { type AdmissionService } from './admission.js';
import { createHash, randomUUID } from 'node:crypto';

import {
  contextManifestSchema, isContextManifestSourceKind,
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
import { createPublicationService, type PublicationService } from './publication.js';
import type { AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';
import { ADMISSION_SCANNER_VERSION } from './admission.js';
import { encodePageCursor, decodePageCursor } from './cursors.js';
import { requireNativeSession } from './nativeAuthority.js';
import { createReleaseService, RELEASE_LIMITS, type ReleaseService } from './release.js';

/**
 * Source capture and history.
 *
 * An append bounds and normalizes the admitted envelope, preflights retry
 * identity under the authenticated actor namespace, then durably reserves its
 * objects before publication. The shared coordinator retains project/object
 * ownership through filesystem durability, catalog commit and outcome recovery.
 * Internal context callers finalize their occurrence in that same catalog
 * transaction, after a separate read-only selection transaction has ended.
 * Reads may join an existing release transaction.
 */

export interface SourceService {
  /** Trusted metadata-only publication, never reachable through public append input. */
  appendContextManifest<T>(call: AuthenticatedCall, manifest: unknown, nonce: string,
    finalize: (tx: TxClient, result: SourceAppendResult) => Promise<T>): Promise<T>;
  /** Public append always requires knowledge-write permission. */
  append(call: AuthenticatedCall, input: unknown, transaction?: TxClient): Promise<SourceAppendResult>;
  view(call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient, deadline?: number): Promise<SourceView>;
  range(call: AuthenticatedCall, projectId: string, sourceId: string, start?: number, end?: number, transaction?: TxClient, deadline?: number): Promise<SourceRange>;
  history(call: AuthenticatedCall, query: unknown): Promise<SourceHistoryPage>;
}

export interface SourceServiceDeps {
  readonly db: SqlDatabase;
  readonly admission: AdmissionService;
  readonly files: SourceFileStore;
  readonly release?: ReleaseService;
  readonly publication?: PublicationService;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

/** One validated record, still encoded, with its decoded bytes. */
interface PreparedRecord {
  readonly record: SourceAppendRecord;
  readonly bytes: Buffer;
  readonly digest: string;
  readonly namespace: string;
  readonly envelope: string;
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
  const release = deps.release ?? createReleaseService({ db: deps.db, files: deps.files, policies:deps.admission.policies });
  const publication = deps.publication ?? createPublicationService(deps);
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  const requireProject = (call: AuthenticatedCall, projectId: string): void => {
    requirePermission(call, 'read');
    if (call.scope.projectId === null || call.scope.projectId !== projectId) {
      throw new ThreadlineError('scope_denied', 'The credential is not scoped to that project.');
    }
  };

  const readRow = async (call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient, deadline?: number): Promise<SourceRow> => {
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
    if (!await release.eligible(call, [{projectId, kind: 'source', id: sourceId}], transaction, deadline)) {
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

  const appendStored = async <T = SourceAppendResult>(call: AuthenticatedCall, input: unknown,
    surface: 'source.append'|'context.manifest' = 'source.append',
    finalize?: (tx: TxClient, result: SourceAppendResult) => Promise<T>): Promise<T> => {
    const parsed = parseContract(sourceAppendInputSchema, input, 'source append');
    const projectId = parsed.projectId;
    requireProject(call, projectId);

    // Bound first: normalize and limit every record before anything durable
    // is written, so an oversized batch fails without a partial publication.
    const ticket = await deps.admission.check(call, surface, parsed);
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
      const digest = createHash('sha256').update(bytes).digest('hex');
      prepared.push({ record, bytes, digest, namespace: sourceRetryNamespace(call),
        envelope: sourceEnvelopeDigest(record, digest, deps.admission.policy(ticket).revision) });
    }

    const summarize = (outcomes: SourceAppendOutcome[]): SourceAppendResult => {
      let highest: string | null = null;
      for (const outcome of outcomes) if(outcome.status!=='rejected' && (highest===null || compareDecimalStrings(outcome.projectSeq,highest)>0)) highest=outcome.projectSeq;
      return parseContract(sourceAppendResultSchema,{outcomes,projectSeq:highest},'source append result');
    };
    return publication.run(call.scope.tenantId,projectId,async tx=> {
      const known = new Map<PreparedRecord,SourceAppendOutcome>();
      for (const item of prepared) {
        const outcome=await preflight(tx,call,projectId,item,release);
        if(outcome)known.set(item,outcome);
      }
      return { value:known, inputs:prepared.filter(item=>!known.has(item)).map(item=>({
        tenantId:call.scope.tenantId,projectId,digest:item.digest,bytes:item.bytes,maxBytes:SOURCE_LIMITS.maxSourceBytes,
      })) };
    }, async(tx,known,stored)=> {
      const outcomes:SourceAppendOutcome[]=[];
      for(const item of prepared) {
        // Transactional race and attribution/current-release recheck, including
        // known duplicates, precedes receipt disclosure.
        const current=await preflight(tx,call,projectId,item,release);
        outcomes.push(current ?? known.get(item) ?? await appendOne(tx,call,projectId,item,stored.get(item.digest),clock()));
      }
      const result=summarize(outcomes);
      logger.log({level:'info',message:'Source append settled.',fields:{accepted:outcomes.filter(o=>o.status==='accepted').length}});
      return finalize ? finalize(tx,result) : result as T;
    },tx=>deps.admission.revalidate(ticket,tx));
  };

  return {
    async append(call, input, transaction) {
      requirePermission(call, 'knowledge.write');
      const parsed = parseContract(sourceAppendInputSchema, input, 'source append');
      if (parsed.records.some((record) => isContextManifestSourceKind(record.kind))) {
        throw new ThreadlineError('scope_denied', 'Context manifests require the trusted audit path.');
      }
      if(transaction)throw new ThreadlineError('invalid_request','Source publication requires its own durable preparation boundary.');
      return appendStored(call, input);
    },
    async appendContextManifest(call, input, nonce, finalize) {
      requirePermission(call, 'context.audit');
      const manifest = parseContract(contextManifestSchema, input, 'context manifest');
      requireProject(call, manifest.projectId);
      const bytes = Buffer.from(JSON.stringify(manifest));
      return appendStored(call, { projectId: manifest.projectId, records: [{
        deliveryId: `context:${nonce}`, originKey: `threadline:context:${nonce}`, originRevision: '1',
        kind: 'context_manifest', nativeSessionId: call.scope.nativeSessionId,
        mediaType: 'application/json', bytesBase64: bytes.toString('base64'),
        observedAtMs: clock().getTime(), completeness: 'complete',
      }] }, 'context.manifest', finalize);
    },

    async view(call: AuthenticatedCall, projectId: string, sourceId: string, transaction?: TxClient, deadline?: number): Promise<SourceView> {
      requireProject(call, projectId);
      return toView(await readRow(call, projectId, sourceId, transaction, deadline));
    },

    async range(
      call: AuthenticatedCall,
      projectId: string,
      sourceId: string,
      start = 0,
      end = SOURCE_LIMITS.maxRangeBytes,
      transaction?: TxClient,
      deadline?: number,
    ): Promise<SourceRange> {
      requireProject(call, projectId);
      const row = await readRow(call, projectId, sourceId, transaction, deadline);
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
      await release.policy(call);

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

  await tx.rows(`UPDATE threadline_memory.sources SET retry_namespace=$4,envelope_digest=$5
    WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,[call.scope.tenantId,projectId,sourceId,item.namespace,item.envelope]);

  {
    await tx.rows(`UPDATE threadline_memory.sources SET release_state='eligible',sanitizer_version=$4
      WHERE tenant_id=$1 AND project_id=$2 AND id=$3`, [call.scope.tenantId, projectId, sourceId,ADMISSION_SCANNER_VERSION]);
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
      `source.append:${item.namespace}:${sha256Hex(record.deliveryId)}`,
      item.envelope,
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

/** Full normalized admitted metadata; bytes are represented by their verified digest. */
export function sourceEnvelopeDigest(record: SourceAppendRecord, digest: string, policyRevision: string): string {
  return canonicalDigest({version:1,digest,kind:record.kind,deliveryId:record.deliveryId,
    originKey:record.originKey,originRevision:record.originRevision,
    nativeSessionId:record.nativeSessionId??null,nativeTurnRef:record.nativeTurnRef??null,
    nativeItemRef:record.nativeItemRef??null,nativeToolRef:record.nativeToolRef??null,
    nativeOrder:record.nativeOrder??null,parentOriginKey:record.parentOriginKey??null,
    observedAtMs:record.observedAtMs,mediaType:record.mediaType??'application/octet-stream',
    completeness:record.completeness,visibility:record.visibility??'project',retention:record.retention??'raw_expiring',
    gapReason:record.gapReason??null,policyRevision,sanitizer:ADMISSION_SCANNER_VERSION});
}
export function sourceRetryNamespace(call:AuthenticatedCall):string {
  return canonicalDigest({version:1,principal:call.scope.principalId,credential:call.tokenId,
    session:call.scope.nativeSessionId,enrollment:call.enrollmentId,binding:call.bindingGeneration});
}
async function preflight(tx:TxClient,call:AuthenticatedCall,projectId:string,item:PreparedRecord,release:ReleaseService):Promise<SourceAppendOutcome|null> {
  const reject=(code:string,detail:string):SourceAppendOutcome=>({status:'rejected',deliveryId:item.record.deliveryId,code,detail});
  try {await requireNativeSession(tx,call,item.record.nativeSessionId??null);}
  catch(error) {if(!(error instanceof ThreadlineError)||error.code!=='scope_denied')throw error;
    return reject('unknown_native_session','No active native session belongs to this principal and binding.');}
  const rows=await tx.rows<{id:string;project_seq:string;envelope_digest:string}>(`SELECT id,project_seq::text,envelope_digest
    FROM threadline_memory.sources WHERE tenant_id=$1 AND project_id=$2 AND retry_namespace=$3 AND delivery_id=$4`,
  [call.scope.tenantId,projectId,item.namespace,item.record.deliveryId]);
  let duplicate=rows[0];
  if(!duplicate) {
    const legacy=await tx.rows<{[key:string]:unknown;id:string;project_seq:string;actor_token_id:string|null;policy_revision:string|null;sanitizer_version:string;release_state:string;digest:string}>(`SELECT s.*,s.project_seq::text,a.policy_revision::text,
      o.actor_token_id FROM threadline_memory.sources s LEFT JOIN threadline_memory.operations o
        ON o.tenant_id=s.tenant_id AND o.project_id=s.project_id AND o.id=s.id AND o.kind='source.append'
        AND o.intent_source_id=s.id AND o.actor_principal_id=s.producer_principal_id
        AND o.admission_id=s.admission_id AND o.native_session_id IS NOT DISTINCT FROM s.producer_session_id
      LEFT JOIN threadline_memory.ingress_admissions a ON a.tenant_id=s.tenant_id AND a.id=s.admission_id
        AND a.state='accepted' AND a.token_id=o.actor_token_id AND a.principal_id=s.producer_principal_id
      WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.retry_namespace IS NULL AND s.delivery_id=$3 LIMIT 2`,
    [call.scope.tenantId,projectId,item.record.deliveryId]);
    if(legacy.length) {
      const old=legacy[0]!;
      if(legacy.length!==1 || old.actor_token_id!==call.tokenId || old.producer_principal_id!==call.scope.principalId
        || old.sanitizer_version!==ADMISSION_SCANNER_VERSION || !old.policy_revision || old.release_state!=='eligible'
        || !await release.eligible(call,[{projectId,kind:'source',id:old.id}],tx))
        return reject('legacy_retry_unavailable','This historical delivery requires an explicit safe transition.');
      const envelope=sourceEnvelopeDigest({deliveryId:String(old.delivery_id),originKey:String(old.origin_key),originRevision:String(old.origin_revision),
        kind:old.kind as SourceAppendRecord['kind'],nativeSessionId:old.producer_session_id as string|null,
        nativeTurnRef:old.native_turn_ref as string|null,nativeItemRef:old.native_item_ref as string|null,nativeToolRef:old.native_tool_ref as string|null,
        nativeOrder:old.native_order===null?null:String(old.native_order),parentOriginKey:old.parent_origin_key as string|null,
        observedAtMs:(old.observed_at as Date).getTime(),bytesBase64:'',mediaType:String(old.media_type),
        completeness:old.completeness as SourceAppendRecord['completeness'],visibility:old.visibility as SourceAppendRecord['visibility'],
        retention:old.retention as SourceAppendRecord['retention'],gapReason:old.gap_reason as string|null},old.digest,old.policy_revision);
      await tx.rows(`UPDATE threadline_memory.sources SET retry_namespace=$4,envelope_digest=$5
        WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND retry_namespace IS NULL`,[call.scope.tenantId,projectId,old.id,item.namespace,envelope]);
      duplicate={id:old.id,project_seq:old.project_seq,envelope_digest:envelope};
    }
  }
  if(!duplicate)return null;
  if(!await release.eligible(call,[{projectId,kind:'source',id:duplicate.id}],tx))return reject('source_unavailable','The prior source is not currently eligible.');
  if(duplicate.envelope_digest!==item.envelope)return reject('idempotency_mismatch','This delivery identity already names a different admitted envelope.');
  return {status:'duplicate',deliveryId:item.record.deliveryId,sourceId:duplicate.id,projectSeq:duplicate.project_seq};
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
