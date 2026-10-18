import { z } from 'zod';

import { APPLICABILITY_KEYS, MEMORY_KINDS, taskViewSchema } from './memory.js';
import { SOURCE_KINDS } from './sources.js';
import { byteBoundedText, decimalStringSchema, sha256HexSchema, uuidSchema } from './validation.js';

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
  reason: z.enum(CONTEXT_ITEM_REASONS),
  sourceRefs: z.array(contextSourceRefSchema).max(CONTEXT_MAX_SOURCE_REFS),
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
export const contextManifestItemSchema = contextItemSchema.omit({ text: true }).strict();
export type ContextManifestItem = z.infer<typeof contextManifestItemSchema>;

export const CONTEXT_MANIFEST_SCHEMA_VERSION = 2;
export const CONTEXT_RENDERER_VERSION = 1;

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
