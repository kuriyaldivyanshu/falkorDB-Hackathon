import { z } from 'zod';

import { minimumGraphBoundaryV3Schema, projectProjectionV3Schema, readReleaseV3Schema } from './access.js';
import { memoryFiltersV3Schema } from './explorer.js';
import { APPLICABILITY_KEYS, MEMORY_KINDS, applicabilitySchema, memoryAcceptanceV3Schema, memoryVersionRefV3Schema, observedUnderSchema, taskViewSchema } from './memory.js';
import { CONTRACT_PROTOCOL_VERSION_V3, serializeSuccessEnvelopeV3 } from './protocol.js';
import { SOURCE_KINDS } from './sources.js';
import { byteBoundedText, compareDecimalStrings, decimalStringSchema, isDecimalString, isoInstantSchema, sha256HexSchema, utf8ByteLength, uuidSchema } from './validation.js';

/**
 * Context contracts.
 *
 * A context packet is the bounded authority and applicable evidence selected
 * for one session, with source references and omission reasons. Threadline
 * controls the bytes it supplies; Codex owns its whole request budget and final
 * context management.
 *
 * A `ContextManifest` is a metadata-only Source: it records what was selected,
 * why, and at which graph head and privacy revision. Rendered plaintext is
 * issued in memory and is not retained a second time by default.
 */

/** Released by default: 4 KiB body with an 8 KiB hard maximum. */
export const CONTEXT_DEFAULT_BODY_BYTES = 4 * 1024;
export const CONTEXT_MAX_BODY_BYTES = 8 * 1024;
export const CONTEXT_MAX_SOURCE_REFS = 64;
export const CONTEXT_MAX_OPTIONAL_MEMORIES = 8;
export const CONTEXT_MAX_MANDATORY_ITEMS = 16;
export const CONTEXT_EXCERPT_BYTES = 1024;

export const CONTEXT_PRIORITIES = ['mandatory', 'optional'] as const;
export type ContextPriority = (typeof CONTEXT_PRIORITIES)[number];

/** How much of a memory body is released. Exact authority is never excerpted. */
export const CONTEXT_REPRESENTATIONS = ['exact', 'excerpt', 'reference'] as const;
export type ContextRepresentation = (typeof CONTEXT_REPRESENTATIONS)[number];

export const CONTEXT_ITEM_KINDS = [...MEMORY_KINDS, 'orientation', 'task'] as const;
export type ContextItemKind = (typeof CONTEXT_ITEM_KINDS)[number];

/** Stable reason codes, so an omission can be shown rather than guessed. */
export const CONTEXT_ITEM_REASONS = [
  'current_required_obligation',
  'task_applicable_handoff',
  'applicable_recent_failure',
  'compatible_procedure',
  'accepted_decision',
  'project_orientation',
  'current_task',
  'accepted_fact',
  'applicable_episode',
] as const;
export type ContextItemReason = (typeof CONTEXT_ITEM_REASONS)[number];

export const CONTEXT_OMISSION_REASONS = [
  'optional_budget_exhausted',
  'not_applicable',
  'superseded',
  'source_unavailable',
  'privacy_restricted',
  'candidate_limit',
  'stale_head',
  'category_unavailable',
  'candidate_procedure',
  'source_reference_limit',
] as const;
export type ContextOmissionReason = (typeof CONTEXT_OMISSION_REASONS)[number];

export const contextSourceRefSchema = z.object({
  sourceId: uuidSchema,
  kind: z.enum(SOURCE_KINDS),
  digest: sha256HexSchema,
  /** Byte range actually cited; null when the whole record is meant. */
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable(),
});
export type ContextSourceRef = z.infer<typeof contextSourceRefSchema>;

export const contextItemSchema = z.object({
  priority: z.enum(CONTEXT_PRIORITIES),
  kind: z.enum(CONTEXT_ITEM_KINDS),
  memoryId: uuidSchema.nullable(),
  versionId: uuidSchema.nullable(),
  taskId: uuidSchema.nullable(),
  representation: z.enum(CONTEXT_REPRESENTATIONS),
  /** Present for `exact`/`excerpt`. Absent for `reference`. */
  text: z.string().nullable(),
  /** Current selection predicates, separate from historical observation conditions. */
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  reason: z.enum(CONTEXT_ITEM_REASONS),
  sourceRefs: z.array(contextSourceRefSchema).max(CONTEXT_MAX_SOURCE_REFS),
  /** UTF-8 bytes of text alone; manifest.bodyBytes includes all rendered qualifications. */
  byteLength: z.number().int().nonnegative(),
});
export type ContextItem = z.infer<typeof contextItemSchema>;

export const contextOmissionSchema = z.object({
  kind: z.enum(CONTEXT_ITEM_KINDS),
  reason: z.enum(CONTEXT_OMISSION_REASONS),
  count: z.number().int().nonnegative(),
  detail: byteBoundedText(256).nullable(),
});
export type ContextOmission = z.infer<typeof contextOmissionSchema>;

/** Persisted items deliberately have no plaintext-bearing field. */
export const contextManifestItemSchema = contextItemSchema.pick({
  priority: true, kind: true, memoryId: true, versionId: true, taskId: true,
  representation: true, reason: true, sourceRefs: true, byteLength: true,
}).strict();
export type ContextManifestItem = z.infer<typeof contextManifestItemSchema>;

export const CONTEXT_MANIFEST_SCHEMA_VERSION = 2;
export const CONTEXT_RENDERER_VERSION = 2;

export const contextManifestSchema = z.object({
  manifestVersion: z.literal(CONTEXT_MANIFEST_SCHEMA_VERSION),
  rendererVersion: z.number().int().nonnegative(),
  projectId: uuidSchema,
  taskId: uuidSchema.nullable(),
  focusDigest: sha256HexSchema.nullable(),
  taskRevision: taskViewSchema.shape.revision.nullable(),
  graphEpoch: uuidSchema,
  graphHead: decimalStringSchema,
  privacyRevision: decimalStringSchema,
  bodyBytes: z.number().int().nonnegative(),
  maxBodyBytes: z.number().int().nonnegative(),
  items: z.array(contextManifestItemSchema).max(CONTEXT_MAX_MANDATORY_ITEMS + CONTEXT_MAX_OPTIONAL_MEMORIES),
  omissions: z.array(contextOmissionSchema.omit({ detail: true }).strict()).max(32),
  /** Digest over the exact rendered body. The body itself is not retained. */
  renderDigest: sha256HexSchema,
  selectedSourceIds: z.array(uuidSchema).max(CONTEXT_MAX_SOURCE_REFS),
  selectionPolicyVersion: z.number().int().nonnegative(),
}).strict();
export type ContextManifest = z.infer<typeof contextManifestSchema>;

export const CONTEXT_OCCURRENCE_STATES = [
  'prepared',
  /** The adapter reported it wrote the packet at a native boundary. */
  'emitted',
  /** Native evidence confirmed the boundary item; still not model comprehension. */
  'native_observed',
  'unknown',
  'refused',
] as const;
export type ContextOccurrenceState = (typeof CONTEXT_OCCURRENCE_STATES)[number];

export const contextOccurrenceSchema = z.object({
  occurrenceId: uuidSchema,
  manifestSourceId: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema.nullable(),
  nativeSessionId: uuidSchema.nullable(),
  state: z.enum(CONTEXT_OCCURRENCE_STATES),
  boundary: byteBoundedText(128).nullable(),
  nativeTurnRef: z.string().max(256).nullable(),
  packetDigest: sha256HexSchema,
  privacyRevision: decimalStringSchema,
  emittedAtMs: z.number().int().nonnegative().nullable(),
  refusalReason: byteBoundedText(256).nullable(),
});
export type ContextOccurrence = z.infer<typeof contextOccurrenceSchema>;

/** Caller assertions are selection hints, never authenticated runtime evidence.
 * task_family is derived exclusively from the stored task, so it is absent here.
 */
export const contextConditionsSchema = z.strictObject({
  selectionHints: z.array(z.strictObject({
    key: z.enum(APPLICABILITY_KEYS.filter((key) => key !== 'task_family')),
    values: z.array(byteBoundedText(256)).min(1).max(16),
  })).max(6).default([]),
});
export type ContextConditions = z.infer<typeof contextConditionsSchema>;

export const prepareContextInputSchema = z.strictObject({
  discoveryCursor: z.string().max(2048).optional(),
  projectId: uuidSchema,
  idempotencyKey: byteBoundedText(200),
  taskId: uuidSchema.nullable().optional(),
  nativeSessionId: uuidSchema.nullable().optional(),
  focus: byteBoundedText(1024).optional(),
  conditions: contextConditionsSchema.optional(),
  maxBodyBytes: z.number().int().min(1024).max(CONTEXT_MAX_BODY_BYTES).default(CONTEXT_DEFAULT_BODY_BYTES),
});
export type PrepareContextInput = z.infer<typeof prepareContextInputSchema>;

export const contextPacketSchema = z.object({
  discoveryCursor: z.string().max(2048).nullable().optional(),
  manifest: contextManifestSchema,
  manifestSourceId: uuidSchema,
  occurrenceId: uuidSchema,
  items: z.array(contextItemSchema).max(CONTEXT_MAX_MANDATORY_ITEMS + CONTEXT_MAX_OPTIONAL_MEMORIES),
  /** Admission is asynchronous; inspect this operation for its actual receipt. */
  manifestOperationId: uuidSchema,
  /** The rendered bounded body actually released to the caller. */
  body: z.string(),
  releasedAtMs: z.number().int().nonnegative(),
});
export type ContextPacket = z.infer<typeof contextPacketSchema>;

export const recordOccurrenceInputSchema = z.strictObject({
  projectId: uuidSchema,
  occurrenceId: uuidSchema,
  idempotencyKey: byteBoundedText(200),
  expectedState: z.literal('prepared'),
  // native_observed is explicitly refused by the service, never promoted.
  state: z.enum(CONTEXT_OCCURRENCE_STATES),
  boundary: z.enum(['operator_report', 'adapter_report']).nullable().optional(),
  // Free native references and refusal text are not persisted by this checkpoint.
  nativeTurnRef: z.null().optional(),
  refusalReason: z.enum(['delivery_failed', 'cancelled', 'unknown']).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.state === 'emitted' && (value.boundary == null || value.refusalReason != null)) {
    ctx.addIssue({ code: 'custom', path: ['boundary'], message: 'Emission needs a reporting boundary and no refusal reason.' });
  }
  if (value.state === 'refused' && value.refusalReason == null) {
    ctx.addIssue({ code: 'custom', path: ['refusalReason'], message: 'A refusal needs a reason code.' });
  }
});
export type RecordOccurrenceInput = z.infer<typeof recordOccurrenceInputSchema>;

/** Context results are never silent: refusal is a typed outcome. */
export const contextResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('packet'), packet: contextPacketSchema }),
  z.object({
    kind: z.literal('refused'),
    reason: z.enum([
      'mandatory_overflow',
      'missing_current_authority',
      'incomplete_provenance',
      'store_unavailable',
      'deleting',
      'stale_snapshot',
      'stale_preparation',
    ]),
    detail: byteBoundedText(256).nullable(),
  }),
]);
export type ContextResult = z.infer<typeof contextResultSchema>;

export const RECALL_LIMITS_V3 = {
  defaultTokens: 2000, followupTokens: 1000, advisoryActiveTokens: 4000,
  maxTokens: 16_000, maxBodyBytes: CONTEXT_MAX_BODY_BYTES,
  maxPacketBytes: 60 * 1024, maxEnvelopeBytes: 64 * 1024,
  deadlineMs: 1000, optionalDiscoveryMs: 300,
  optionalCandidates: 40, maxExaminedCandidates: 200, relationshipCandidates: 20, relationshipHops: 1,
} as const;
export const RECALL_STATUSES_V3 = ['complete', 'no_match', 'partial', 'conflict',
  'unavailable', 'incomplete_context', 'index_pending'] as const;
export const recallBudgetV3Schema = z.strictObject({
  maxTokens: z.number().int().min(1).max(RECALL_LIMITS_V3.maxTokens),
  maxBodyBytes: z.number().int().min(1).max(RECALL_LIMITS_V3.maxBodyBytes).default(CONTEXT_DEFAULT_BODY_BYTES),
  maxPacketBytes: z.number().int().min(1).max(RECALL_LIMITS_V3.maxPacketBytes).default(RECALL_LIMITS_V3.maxPacketBytes),
});
export type RecallBudgetV3 = z.infer<typeof recallBudgetV3Schema>;
export const recallRequestV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  requestId: uuidSchema, projectId: uuidSchema,
  mode: z.literal('requested'), purpose: z.enum(['recall', 'followup', 'handoff']),
  query: byteBoundedText(2048).nullable(),
  filters: memoryFiltersV3Schema,
  memoryIds: z.array(uuidSchema).max(16).default([]),
  channelId: uuidSchema,
  budget: recallBudgetV3Schema.optional(),
  minimumBoundary: minimumGraphBoundaryV3Schema.nullable().default(null),
}).transform((v) => ({ ...v, budget: v.budget ?? recallBudgetV3Schema.parse({
  maxTokens: v.purpose === 'followup' ? RECALL_LIMITS_V3.followupTokens : RECALL_LIMITS_V3.defaultTokens,
}) })).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (v.projectId !== v.filters.projectId ||
    (v.minimumBoundary !== null && v.projectId !== v.minimumBoundary.projectId)) issue('Recall project scope mismatch.');
  const f = v.filters;
  const hasFilter = [f.session, f.agent, f.task, f.topic, f.ticket, f.feature, f.tag, f.kinds]
    .some((values) => values.length > 0) || f.dateFrom !== null || f.dateTo !== null;
  if ((v.query === null || v.query.trim() === '') && !hasFilter && v.memoryIds.length === 0) issue('Recall requires a query or explicit selection.');
});
export type RecallRequestV3 = z.infer<typeof recallRequestV3Schema>;

/** Both watermark and requested boundary belong to the SAME project projection.
 * A changed epoch/generation is never ordered numerically or called no_match. */
export const recallFreshnessV3Schema = z.strictObject({
  state: z.enum(['current', 'index_pending', 'boundary_changed']),
  projection: projectProjectionV3Schema,
  minimumBoundary: minimumGraphBoundaryV3Schema.nullable(),
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const p = v.projection, b = v.minimumBoundary;
  if (b !== null && b.projectId !== p.projectId) issue('Freshness project scope mismatch.');
  // Nested field refinements can fail without stopping this refinement. Only
  // compare canonical counters; their schemas already reject malformed input.
  if (!isDecimalString(p.indexedGraphEvent) || !isDecimalString(p.committedGraphEvent) ||
    (b !== null && !isDecimalString(b.committedGraphEvent))) return;
  const changed = b !== null && (b.graphEpoch !== p.fence.graphEpoch || b.projectionGeneration !== p.projectionGeneration);
  const lag = compareDecimalStrings(p.indexedGraphEvent, p.committedGraphEvent) < 0 ||
    (b !== null && !changed && compareDecimalStrings(p.indexedGraphEvent, b.committedGraphEvent) < 0);
  if (v.state !== (changed ? 'boundary_changed' : lag ? 'index_pending' : 'current')) issue('Freshness state disagrees with project watermark.');
});
export type RecallFreshnessV3 = z.infer<typeof recallFreshnessV3Schema>;

export const recallCitationV3Schema = z.strictObject({
  sourceVersionId: uuidSchema,
  availability: z.enum(['available', 'reference_only', 'unavailable']),
  label: byteBoundedText(256),
});
export type RecallCitationV3 = z.infer<typeof recallCitationV3Schema>;
export const recallItemV3Schema = z.strictObject({
  memory: memoryVersionRefV3Schema,
  acceptance: memoryAcceptanceV3Schema,
  tier: z.enum(['governing', 'optional']),
  representation: z.enum(['exact', 'stored_excerpt', 'reference']),
  text: byteBoundedText(CONTEXT_MAX_BODY_BYTES).nullable(),
  citations: z.array(recallCitationV3Schema).max(8),
  reasons: z.array(z.enum(['exact_memory', 'exact_task', 'exact_ticket', 'exact_feature',
    'text_match', 'supports_requirement', 'prior_attempt', 'pin', 'handoff'])).min(1).max(8),
  applicability: z.enum(['confirmed', 'unknown']),
  uncertainty: byteBoundedText(256).nullable(),
}).superRefine((v, ctx) => {
  if (v.acceptance.state !== 'accepted')
    ctx.addIssue({ code: 'custom', message: 'Ordinary recall releases current accepted versions only.' });
  if (v.tier === 'governing' && (v.representation !== 'exact' || v.applicability !== 'confirmed'))
    ctx.addIssue({ code: 'custom', message: 'Governing knowledge must be exact and applicable.' });
  if ((v.representation === 'reference') !== (v.text === null))
    ctx.addIssue({ code: 'custom', message: 'Only a reference has no text.' });
});
export type RecallItemV3 = z.infer<typeof recallItemV3Schema>;
export const recallOmissionV3Schema = z.strictObject({
  tier: z.enum(['governing', 'optional']),
  reason: z.enum(['budget', 'candidate_limit', 'conflict', 'unavailable', 'unknown_applicability']),
  guidance: z.enum(['narrow_request', 'increase_budget', 'resolve_conflict', 'retry', 'inspect_sources']),
});
export type RecallOmissionV3 = z.infer<typeof recallOmissionV3Schema>;

/** Accounting covers the entire serialized success envelope, including all
 * labels, references, reasons, freshness and accounting fields. An estimated
 * count uses UTF-8 bytes as a conservative upper bound; unknown accounting
 * cannot certify a complete content-bearing result. Tokenizer claims still
 * require runtime verification; schema validation does not run a tokenizer.
 * The default 2,000-token UTF-8 fallback can constrain content below the 4 KiB
 * body ceiling; the 1,000-token follow-up ceiling may fit no content-bearing
 * result. Defaults are ceilings, not payload guarantees: return a content-free
 * incomplete/unavailable result that fits, or require a qualified tokenizer,
 * increased budget or narrower content. Both token and byte ceilings bind. */
export const recallAccountingV3Schema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('tokenizer'), tokenizer: byteBoundedText(128),
    tokens: z.number().int().nonnegative(), wholeEnvelopeBytes: z.number().int().nonnegative() }),
  z.strictObject({ method: z.literal('utf8_upper_bound'),
    tokens: z.number().int().nonnegative(), wholeEnvelopeBytes: z.number().int().nonnegative() }),
  z.strictObject({ method: z.literal('unknown'), tokens: z.null(),
    wholeEnvelopeBytes: z.number().int().nonnegative() }),
]);
export type RecallAccountingV3 = z.infer<typeof recallAccountingV3Schema>;
export const recallResultV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), requestId: uuidSchema,
  status: z.enum(RECALL_STATUSES_V3),
  budget: recallBudgetV3Schema,
  release: readReleaseV3Schema.nullable(),
  freshness: recallFreshnessV3Schema.nullable(),
  deliveryId: uuidSchema.nullable(), channelId: uuidSchema,
  body: z.string().refine((v) => utf8ByteLength(v) <= CONTEXT_MAX_BODY_BYTES, 'Body exceeds 8 KiB.'),
  items: z.array(recallItemV3Schema).max(CONTEXT_MAX_MANDATORY_ITEMS + CONTEXT_MAX_OPTIONAL_MEMORIES),
  omissions: z.array(recallOmissionV3Schema).max(32),
  conflicts: z.array(z.strictObject({ conflictId: uuidSchema,
    participants: z.array(memoryVersionRefV3Schema).min(2).max(16) })).max(16),
  reason: z.enum(['none', 'store_unavailable', 'release_denied', 'deadline', 'budget',
    'conflict', 'index_lag', 'boundary_changed', 'accounting_unknown', 'candidate_limit']),
  accounting: recallAccountingV3Schema,
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const envelopeBytes = utf8ByteLength(serializeSuccessEnvelopeV3(v));
  if (envelopeBytes > RECALL_LIMITS_V3.maxEnvelopeBytes ||
    envelopeBytes > v.budget.maxPacketBytes) issue('Whole packet/envelope byte budget exceeded.');
  if (utf8ByteLength(v.body) > v.budget.maxBodyBytes) issue('Body budget exceeded.');
  if (v.accounting.wholeEnvelopeBytes !== envelopeBytes) issue('Whole envelope byte accounting mismatch.');
  if (v.accounting.method === 'utf8_upper_bound' && v.accounting.tokens !== envelopeBytes) issue('UTF-8 estimate must bound the whole envelope.');
  if (v.accounting.tokens !== null && v.accounting.tokens > v.budget.maxTokens) issue('Whole packet token budget exceeded.');
  if (v.accounting.method === 'unknown' && (v.items.length > 0 || v.body.length > 0 ||
    !['unavailable', 'incomplete_context'].includes(v.status))) issue('Unknown token accounting cannot certify content delivery.');
  const noContent = v.items.length === 0 && v.body.length === 0 && v.conflicts.length === 0;
  if (v.status === 'unavailable') {
    if (!noContent || v.release !== null || v.deliveryId !== null || v.freshness !== null || v.reason === 'none') issue('Unavailable results cannot release content or claim a snapshot.');
  } else {
    if (v.release === null || v.freshness === null) issue('Available results require current release and freshness.');
    if (v.items.length > 0 && v.deliveryId === null) issue('Released memory requires a delivery identity.');
  }
  if (v.release !== null && v.freshness !== null &&
    JSON.stringify(v.release.projection) !== JSON.stringify(v.freshness.projection)) issue('Release and freshness snapshots differ.');
  if (['complete', 'no_match', 'partial', 'conflict'].includes(v.status) && v.freshness?.state !== 'current') issue('Search lag cannot certify current search results.');
  if (v.status === 'no_match' && (!noContent || v.omissions.length > 0 || v.reason !== 'none')) issue('No match cannot hide omitted or pending content.');
  if (v.status === 'complete' && (v.items.length === 0 || v.omissions.length > 0 || v.conflicts.length > 0 || v.reason !== 'none')) issue('Complete requires content without omissions/conflicts.');
  if (v.status === 'partial' && (v.omissions.length === 0 || v.items.length === 0 || v.reason === 'none')) issue('Partial requires delivered and omitted content.');
  if (v.status === 'conflict' && (v.conflicts.length === 0 || v.reason !== 'conflict')) issue('Conflict requires explicit participants.');
  if (v.conflicts.length > 0 && !['conflict', 'incomplete_context', 'index_pending'].includes(v.status)) issue('Unresolved conflict cannot be reported complete/partial.');
  const governingOmission = v.omissions.some((o) => o.tier === 'governing');
  if (governingOmission && v.status !== 'incomplete_context' && v.status !== 'conflict') issue('Omitted governing knowledge requires incomplete context.');
  if (v.status === 'incomplete_context' && v.reason === 'none') issue('Incomplete context requires an explicit failure reason.');
  if (v.freshness?.state === 'index_pending' && v.reason !== 'index_lag') issue('Pending freshness requires an index-lag explanation.');
  if ((v.freshness?.state === 'boundary_changed') !== (v.reason === 'boundary_changed')) issue('Changed boundaries require a matching resync explanation.');
  if (v.reason === 'index_lag' && v.freshness?.state !== 'index_pending') issue('Index-lag explanation requires pending freshness.');
  if (v.status === 'incomplete_context' && v.omissions.length === 0 && v.reason !== 'accounting_unknown' && v.reason !== 'boundary_changed' && v.reason !== 'deadline' && v.reason !== 'index_lag') issue('Incomplete context must explain what is missing.');
  if (v.status === 'index_pending' && (v.freshness?.state !== 'index_pending' || v.reason !== 'index_lag')) issue('Index pending must expose project lag.');
  if (v.status === 'index_pending' && v.items.some((i) => !i.reasons.includes('exact_memory') || i.representation !== 'exact')) issue('Pending search permits only directly authorized exact-memory reads.');
  if (v.freshness?.state === 'boundary_changed' && v.status !== 'incomplete_context') issue('Changed projection boundaries require resync.');
  if (v.items.reduce((count, item) => count + item.citations.length, 0) > CONTEXT_MAX_SOURCE_REFS) issue('Recall citation count exceeded.');
  const governing = v.items.filter((i) => i.tier === 'governing');
  if (governing.length > CONTEXT_MAX_MANDATORY_ITEMS || v.items.length - governing.length > CONTEXT_MAX_OPTIONAL_MEMORIES) issue('Recall tier count exceeded.');
  if (governing.some((i) => i.text === null || !v.body.includes(i.text))) issue('Rendered body must include exact governing content.');
  if (v.items.length === 0 && v.body.length > 0) issue('Unattributed body content is not permitted.');
  if (new Set(v.items.map((i) => i.memory.memoryId)).size !== v.items.length) issue('Recall memory identities must be unique.');
});
export type RecallResultV3 = z.infer<typeof recallResultV3Schema>;

/** Prepared/server-returned are server facts. Client ack is only received or
 * rendered for the bound principal/project/channel. No native-observed or
 * comprehension state is enabled by these contracts. */
export const deliveryRecordV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  deliveryId: uuidSchema, requestId: uuidSchema,
  tenantId: uuidSchema, principalId: uuidSchema, projectId: uuidSchema, channelId: uuidSchema,
  packetDigest: sha256HexSchema,
  versions: z.array(memoryVersionRefV3Schema).max(24),
  preparedAt: isoInstantSchema, serverReturnedAt: isoInstantSchema.nullable(),
  acknowledgment: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('unacknowledged') }),
    z.strictObject({ state: z.literal('received'), at: isoInstantSchema }),
    z.strictObject({ state: z.literal('rendered'), at: isoInstantSchema }),
  ]),
  expiresAt: isoInstantSchema,
}).refine((v) => Date.parse(v.expiresAt) > Date.parse(v.preparedAt) &&
  (v.serverReturnedAt === null || (Date.parse(v.serverReturnedAt) >= Date.parse(v.preparedAt) &&
    Date.parse(v.serverReturnedAt) < Date.parse(v.expiresAt))) &&
  (v.acknowledgment.state === 'unacknowledged' || (v.serverReturnedAt !== null &&
    Date.parse(v.acknowledgment.at) >= Date.parse(v.serverReturnedAt) &&
    Date.parse(v.acknowledgment.at) < Date.parse(v.expiresAt))),
  'Delivery stages must occur in order before expiry.');
export type DeliveryRecordV3 = z.infer<typeof deliveryRecordV3Schema>;
export const acknowledgeDeliveryV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), requestId: uuidSchema,
  deliveryId: uuidSchema, projectId: uuidSchema, channelId: uuidSchema,
  state: z.enum(['received', 'rendered']),
});
export type AcknowledgeDeliveryV3 = z.infer<typeof acknowledgeDeliveryV3Schema>;
export const deliveryAcknowledgmentBindingV3Schema = z.strictObject({
  record: deliveryRecordV3Schema, request: acknowledgeDeliveryV3Schema,
  authenticatedPrincipalId: uuidSchema, now: isoInstantSchema,
}).refine((v) => v.authenticatedPrincipalId === v.record.principalId &&
  v.request.deliveryId === v.record.deliveryId && v.request.projectId === v.record.projectId &&
  v.request.channelId === v.record.channelId && v.record.serverReturnedAt !== null &&
  Date.parse(v.now) >= Date.parse(v.record.serverReturnedAt) && Date.parse(v.now) < Date.parse(v.record.expiresAt) &&
  !(v.record.acknowledgment.state === 'rendered' && v.request.state === 'received'),
  'Acknowledgment must bind current principal/project/channel and a returned unexpired delivery.');
export type DeliveryAcknowledgmentBindingV3 = z.infer<typeof deliveryAcknowledgmentBindingV3Schema>;
