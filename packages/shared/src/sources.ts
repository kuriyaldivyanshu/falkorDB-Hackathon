import { z } from 'zod';

import {
  byteBoundedText,
  decimalStringSchema,
  sha256HexSchema,
  uuidSchema,
} from './validation.js';

/**
 * Source evidence contracts.
 *
 * A Source is an immutable catalog entry for permitted captured bytes. The
 * bytes live in an immutable local file; SQL owns the catalog, ordering,
 * completeness and availability. A digest proves integrity of retained bytes —
 * never native completeness, provider-wire truth or authorization.
 *
 * Two orderings are preserved separately:
 *
 * - **native order** is the harness's own ordering (turn/item index), which is
 *   the only ordering meaningful inside a native session;
 * - **project sequence** is this service's ingestion order, which orders a
 *   durable history cursor but must not be presented as native chronology.
 */

export const SOURCE_KINDS = [
  // Visible native conversation evidence, captured under an approved policy.
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_result',
  'permission_outcome',
  'lifecycle',
  'final_output',
  // Explicit absence: a record or interval whose evidence is missing.
  'capture_gap',
  // Human-authored durable material.
  'human_note',
  'selection_manifest',
  'memory_proposal',
  'procedure_outcome',
  'import_manifest',
  'context_manifest',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isContextManifestSourceKind(kind:unknown):kind is 'context_manifest' {return kind==='context_manifest';}

export const CAPTURE_COMPLETENESS = ['complete', 'partial', 'unknown', 'gap'] as const;
export type CaptureCompleteness = (typeof CAPTURE_COMPLETENESS)[number];

export const SOURCE_AVAILABILITY = ['available', 'missing', 'deleted'] as const;
export type SourceAvailability = (typeof SOURCE_AVAILABILITY)[number];

export const SOURCE_VISIBILITY = ['project', 'principal'] as const;
export type SourceVisibility = (typeof SOURCE_VISIBILITY)[number];

export const SOURCE_RETENTION = [
  /** Ordinary raw evidence; expires on the project's raw-history policy. */
  'raw_expiring',
  /** Retained because accepted memory or an authorized job cites it. */
  'retained',
] as const;
export type SourceRetention = (typeof SOURCE_RETENTION)[number];

/** One normalized record offered for durable capture. */
export const sourceAppendRecordSchema = z.object({
  /**
   * Stable delivery identity for this record. Reusing it with the same payload
   * is an idempotent retry; reusing it with different bytes refuses.
   */
  deliveryId: byteBoundedText(200),
  /**
   * Native occurrence identity: harness + installation + item/turn identity.
   * Not the delivery id, not the import job id, and not a content digest.
   */
  originKey: byteBoundedText(512),
  originRevision: byteBoundedText(128),
  kind: z.enum(SOURCE_KINDS),
  nativeSessionId: uuidSchema.nullable().optional(),
  nativeTurnRef: z.string().min(1).max(256).nullable().optional(),
  nativeItemRef: z.string().min(1).max(256).nullable().optional(),
  nativeToolRef: z.string().min(1).max(256).nullable().optional(),
  /** Harness-defined ordering inside the native session, when known. */
  nativeOrder: decimalStringSchema.nullable().optional(),
  parentOriginKey: byteBoundedText(512).nullable().optional(),
  observedAtMs: z.number().int().nonnegative(),
  /** Exact permitted bytes, base64. Never hidden reasoning or provider wire bytes. */
  bytesBase64: z.string().min(1),
  mediaType: byteBoundedText(128).optional(),
  completeness: z.enum(CAPTURE_COMPLETENESS),
  visibility: z.enum(SOURCE_VISIBILITY).optional(),
  retention: z.enum(SOURCE_RETENTION).optional(),
  /** Human-readable reason for a partial/gap record; never a body copy. */
  gapReason: byteBoundedText(256).nullable().optional(),
});

export type SourceAppendRecord = z.infer<typeof sourceAppendRecordSchema>;

export const sourceAppendInputSchema = z.object({
  projectId: uuidSchema,
  records: z.array(sourceAppendRecordSchema).min(1).max(20),
});
export type SourceAppendInput = z.infer<typeof sourceAppendInputSchema>;

export const sourceAppendOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    deliveryId: z.string(),
    sourceId: uuidSchema,
    projectSeq: decimalStringSchema,
  }),
  z.object({
    status: z.literal('duplicate'),
    deliveryId: z.string(),
    sourceId: uuidSchema,
    projectSeq: decimalStringSchema,
  }),
  z.object({
    status: z.literal('rejected'),
    deliveryId: z.string(),
    code: byteBoundedText(64),
    detail: byteBoundedText(256),
  }),
]);
export type SourceAppendOutcome = z.infer<typeof sourceAppendOutcomeSchema>;

export const sourceAppendResultSchema = z.object({
  outcomes: z.array(sourceAppendOutcomeSchema),
  /** Ingestion sequence reached by this batch, or null when nothing landed. */
  projectSeq: decimalStringSchema.nullable(),
});
export type SourceAppendResult = z.infer<typeof sourceAppendResultSchema>;

/** What a reader is shown about one Source. Physical locators stay internal. */
export const sourceViewSchema = z.object({
  sourceId: uuidSchema,
  projectId: uuidSchema,
  kind: z.enum(SOURCE_KINDS),
  digest: sha256HexSchema,
  byteSize: z.number().int().nonnegative(),
  mediaType: byteBoundedText(128),
  observedAtMs: z.number().int().nonnegative(),
  capturedAtMs: z.number().int().nonnegative(),
  completeness: z.enum(CAPTURE_COMPLETENESS),
  availability: z.enum(SOURCE_AVAILABILITY),
  retention: z.enum(SOURCE_RETENTION),
  visibility: z.enum(SOURCE_VISIBILITY),
  nativeSessionId: uuidSchema.nullable(),
  nativeTurnRef: z.string().nullable(),
  nativeItemRef: z.string().nullable(),
  nativeOrder: decimalStringSchema.nullable(),
  parentSourceId: uuidSchema.nullable(),
  /** Public origin identity so an operator can correlate with the harness. */
  originKey: z.string(),
  originRevision: z.string(),
  projectSeq: decimalStringSchema,
  /** Present only when the record represents missing evidence. */
  gapReason: z.string().nullable(),
});
export type SourceView = z.infer<typeof sourceViewSchema>;

export const sourceRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  base64: z.string(),
});
export type SourceRange = z.infer<typeof sourceRangeSchema>;

/**
 * A history cursor is opaque to clients.
 *
 * It carries the project binding, the ingestion position, the filter digest and
 * a format version. Changing filters starts a new cursor, and every page
 * re-authorizes current scope and source availability.
 */
export const sourceHistoryCursorSchema = z.object({
  v: z.literal(1),
  projectSeq: decimalStringSchema,
  filterDigest: sha256HexSchema,
});
export type SourceHistoryCursor = z.infer<typeof sourceHistoryCursorSchema>;

export const sourceHistoryQuerySchema = z.object({
  projectId: uuidSchema,
  kinds: z.array(z.enum(SOURCE_KINDS)).max(14).optional(),
  nativeSessionId: uuidSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SourceHistoryQuery = z.infer<typeof sourceHistoryQuerySchema>;

export const sourceHistoryPageSchema = z.object({
  entries: z.array(sourceViewSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  /** Records in the scanned page that were skipped because bytes are gone. */
  unavailableCount: z.number().int().nonnegative(),
});
export type SourceHistoryPage = z.infer<typeof sourceHistoryPageSchema>;

/** Declared capture limits, enforced before persistence. */
export const SOURCE_LIMITS = {
  maxSourceBytes: 4 * 1024 * 1024,
  maxHookRecordBytes: 256 * 1024,
  maxInputBytes: 1024 * 1024,
  maxBatchRecords: 20,
  maxBatchBytes: 1024 * 1024,
  maxHistoryPageRecords: 100,
  maxHistoryPageBytes: 2 * 1024 * 1024,
  maxRangeBytes: 32 * 1024,
} as const;

/** A source link records derivation without copying text. */
export const SOURCE_LINK_RELATIONS = ['excerpt_of', 'depends_on', 'context_uses'] as const;
export type SourceLinkRelation = (typeof SOURCE_LINK_RELATIONS)[number];

export const sourceLinkSchema = z.object({
  parentSourceId: uuidSchema,
  childSourceId: uuidSchema,
  relation: z.enum(SOURCE_LINK_RELATIONS),
  /** Original byte range for an excerpt; null when the whole parent is meant. */
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable(),
});
export type SourceLink = z.infer<typeof sourceLinkSchema>;

/** V3 sanitized representation only. Parsing cannot prove scanning, authority,
 * integrity or freedom from secrets. Backend scanning remains mandatory. */
export const safePayloadV3Schema = z.strictObject({
  text: byteBoundedText(65536),
  mediaType: z.literal('text/plain'),
});
export type SafePayloadV3 = z.infer<typeof safePayloadV3Schema>;

const sanitizerVersionsV3 = {
  policyRevision: decimalStringSchema,
  scannerVersion: byteBoundedText(64),
};
export const sanitizerResultV3Schema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('safe'), ...sanitizerVersionsV3,
    payload: safePayloadV3Schema }),
  z.strictObject({ status: z.literal('reduced'), ...sanitizerVersionsV3,
    payload: safePayloadV3Schema,
    reason: z.enum(['sensitive_fields_removed', 'bounded_excerpt']) }),
  z.strictObject({ status: z.literal('rejected'), ...sanitizerVersionsV3,
    reason: z.enum(['sensitive', 'unsupported', 'uncertain', 'scanner_failed', 'policy_denied']),
    rawRetained: z.literal(false) }),
]);
export type SanitizerResultV3 = z.infer<typeof sanitizerResultV3Schema>;

export const sourceRevisionV3Schema = z.strictObject({
  sourceId: uuidSchema,
  sourceRevision: decimalStringSchema,
});
export type SourceRevisionV3 = z.infer<typeof sourceRevisionV3Schema>;
