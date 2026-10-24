import { z } from 'zod';
import { decimalStringSchema, isDecimalString, sha256HexSchema, uuidSchema } from './validation.js';
import { nativeHintsV3Schema, producerAuthorityV3Schema, producerTargetV3Schema } from './identity.js';
import { expectedPolicyV3Schema, policyFenceV3Schema } from './policy.js';
import { sanitizerResultV3Schema, sourceRevisionV3Schema } from './sources.js';

const greater = (a: string, b: string): boolean =>
  isDecimalString(a) && isDecimalString(b) && BigInt(a) > BigInt(b);
export const journalRangeV3Schema = z.strictObject({
  from: decimalStringSchema, through: decimalStringSchema,
}).refine((r) => !greater(r.from, r.through) && r.from !== '0', 'Invalid inclusive journal range.');
export type JournalRangeV3 = z.infer<typeof journalRangeV3Schema>;

export const JOURNAL_STAGES_V3 = ['captured', 'processed', 'committed', 'indexed'] as const;
const pendingRanges = z.array(journalRangeV3Schema).max(64);
/** Frontiers are contiguous durable outcomes, including explicit no-effects.
 * Pending ranges partition each stage's remaining admitted tail; gaps describe
 * absent native evidence and do not prevent a durable gap outcome advancing. */
export const journalProgressV3Schema = z.strictObject({
  protocolVersion: z.literal(3),
  authority: producerAuthorityV3Schema,
  fence: policyFenceV3Schema,
  processingGeneration: decimalStringSchema,
  projectionGeneration: decimalStringSchema,
  captured: decimalStringSchema,
  processed: decimalStringSchema,
  committed: decimalStringSchema,
  indexed: decimalStringSchema,
  nativeCoverage: z.enum(['unknown', 'partial']),
  gaps: z.array(z.strictObject({
    range: journalRangeV3Schema,
    reason: z.enum(['unobserved', 'unsupported_ingress', 'sanitizer_rejected', 'lost_before_admission']),
  })).max(64),
  pending: z.strictObject({ processed: pendingRanges, committed: pendingRanges, indexed: pendingRanges }),
  pendingCounts: z.strictObject({ processed: decimalStringSchema, committed: decimalStringSchema, indexed: decimalStringSchema }),
}).superRefine((v, ctx) => {
  const fail = (message: string): void => { ctx.addIssue({ code: 'custom', message }); };
  for (let i = 1; i < JOURNAL_STAGES_V3.length; i++) {
    const current = JOURNAL_STAGES_V3[i]!;
    const previous = JOURNAL_STAGES_V3[i - 1]!;
    if (greater(v[current], v[previous])) fail('Frontiers must follow journal stage order.');
  }
  let lastGap = '0';
  for (const gap of v.gaps) {
    if (greater(gap.range.through, v.captured) || !greater(gap.range.from, lastGap))
      fail('Gaps must be ordered, disjoint and inside the captured journal.');
    lastGap = gap.range.through;
  }
  if (v.gaps.length > 0 && v.nativeCoverage !== 'partial') fail('Known gaps require partial coverage.');
  for (const stage of ['processed', 'committed', 'indexed'] as const) {
    if (![v[stage], v.captured].every(isDecimalString)) continue;
    if (isDecimalString(v.pendingCounts[stage]) &&
        BigInt(v.pendingCounts[stage]) !== BigInt(v.captured) - BigInt(v[stage]))
      fail('Pending count must equal the admitted tail length.');
    let next = BigInt(v[stage]) + 1n;
    for (const range of v.pending[stage]) {
      if (![range.from, range.through].every(isDecimalString)) continue;
      if (BigInt(range.from) !== next || greater(range.through, v.captured))
        fail('Pending ranges must partition the tail after their frontier.');
      next = BigInt(range.through) + 1n;
    }
    if (next !== BigInt(v.captured) + 1n) fail('Pending ranges must cover the full admitted tail.');
  }
});
export type JournalProgressV3 = z.infer<typeof journalProgressV3Schema>;

/** Same-generation snapshots cannot regress or switch scope. A new generation
 * is a new history, never an edit to an immutable checkpoint receipt. */
export const journalProgressTransitionV3Schema = z.strictObject({
  previous: journalProgressV3Schema, next: journalProgressV3Schema,
}).superRefine(({ previous: a, next: b }, ctx) => {
  if (JSON.stringify(a.authority) !== JSON.stringify(b.authority) ||
      JSON.stringify(a.fence) !== JSON.stringify(b.fence) ||
      a.processingGeneration !== b.processingGeneration || a.projectionGeneration !== b.projectionGeneration ||
      JOURNAL_STAGES_V3.some((stage) => greater(a[stage], b[stage]))) {
    ctx.addIssue({ code: 'custom', message: 'Progress must retain scope/generations and cannot regress.' });
  }
  if (a.nativeCoverage === 'partial' && b.nativeCoverage !== 'partial') {
    ctx.addIssue({ code: 'custom', message: 'Partial native coverage cannot regress to unknown.' });
  }
  // Both lists are bounded, sorted and disjoint. Cover each old interval with
  // adjacent same-reason new intervals. Compare endpoints, never enumerate
  // journal positions (a single range can span the entire signed-int64 space).
  for (const oldGap of a.gaps) {
    if (![oldGap.range.from, oldGap.range.through].every(isDecimalString)) continue;
    let cursor = BigInt(oldGap.range.from);
    const end = BigInt(oldGap.range.through);
    for (const newGap of b.gaps) {
      if (![newGap.range.from, newGap.range.through].every(isDecimalString)) continue;
      const from = BigInt(newGap.range.from);
      const through = BigInt(newGap.range.through);
      if (through < cursor) continue;
      if (from > cursor || newGap.reason !== oldGap.reason) break;
      cursor = through + 1n;
      if (cursor > end) break;
    }
    if (cursor <= end) {
      ctx.addIssue({ code: 'custom', message: 'Durable gap coverage and reasons must be retained.' });
    }
  }
});
export type JournalProgressTransitionV3 = z.infer<typeof journalProgressTransitionV3Schema>;

/** Only this demonstrated root callback profile is representable. These are
 * metadata signals, never native content/occurrence or hook-origin proof. */
export const callbackProfileV3Schema = z.strictObject({
  harness: z.literal('codex'), platform: z.literal('darwin'), architecture: z.literal('arm64'),
  harnessVersion: z.literal('0.163.0'), model: z.literal('gpt-6.1-sol'), reasoningEffort: z.literal('low'),
  context: z.literal('root'),
  boundary: z.enum(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact']),
});
export type CallbackProfileV3 = z.infer<typeof callbackProfileV3Schema>;
const requestFields = {
  protocolVersion: z.literal(3), requestId: uuidSchema,
  target: producerTargetV3Schema, guard: expectedPolicyV3Schema,
  nativeHints: nativeHintsV3Schema.optional(),
};
export const captureRequestV3Schema = z.discriminatedUnion('ingressKind', [
  z.strictObject({ ...requestFields, ingressKind: z.literal('manual_record'),
    sourceRequestId: uuidSchema,
    visibility: z.enum(['principal', 'project']),
    kind: z.enum(['human_note', 'memory_proposal', 'procedure_outcome']),
    sanitized: sanitizerResultV3Schema,
  }).refine((v) => v.sanitized.policyRevision === v.guard.expectedPolicyRevision,
    'Sanitization must match the requested policy.'),
  z.strictObject({ ...requestFields, ingressKind: z.literal('callback_checkpoint'),
    profile: callbackProfileV3Schema,
    throughJournalSeq: decimalStringSchema,
  }),
]);
export type CaptureRequestV3 = z.infer<typeof captureRequestV3Schema>;

export const CAPTURE_REFUSALS_V3 = ['unsupported_ingress', 'unsupported_profile', 'unauthorized',
  'policy_changed', 'privacy_changed', 'idempotency_mismatch', 'sanitizer_rejected',
  'boundary_not_captured', 'storage_unavailable'] as const;
export const captureResultV3Schema = z.discriminatedUnion('status', [
  z.strictObject({ protocolVersion: z.literal(3), status: z.literal('admitted'),
    requestId: uuidSchema, receiptId: uuidSchema, canonicalRequestDigest: sha256HexSchema,
    source: sourceRevisionV3Schema, journalSeq: decimalStringSchema,
    progress: journalProgressV3Schema, durable: z.literal(true),
  }).refine((v) => v.journalSeq !== '0' && !greater(v.journalSeq, v.progress.captured),
    'Admitted position must be inside durable capture.'),
  z.strictObject({ protocolVersion: z.literal(3), status: z.enum(['ignored', 'gap']),
    requestId: uuidSchema, receiptId: uuidSchema, canonicalRequestDigest: sha256HexSchema,
    journalSeq: decimalStringSchema, progress: journalProgressV3Schema, durable: z.literal(true),
    reason: z.enum(['no_value', 'sanitizer_rejected', 'unsupported_ingress']),
    rawRetained: z.literal(false),
  }).refine((v) => v.journalSeq !== '0' && !greater(v.journalSeq, v.progress.captured) &&
    (v.status !== 'gap' || v.progress.gaps.some((g) =>
      !greater(g.range.from, v.journalSeq) && !greater(v.journalSeq, g.range.through))),
    'Durable outcome must be captured and gap outcomes must preserve their gap.'),
  z.strictObject({ protocolVersion: z.literal(3), status: z.literal('refused'),
    requestId: uuidSchema, code: z.enum(CAPTURE_REFUSALS_V3), rawRetained: z.literal(false),
  }),
]);
export type CaptureResultV3 = z.infer<typeof captureResultV3Schema>;

export const checkpointRequestV3Schema = z.strictObject({
  ...requestFields,
  throughJournalSeq: decimalStringSchema,
  processingGeneration: decimalStringSchema,
  projectionGeneration: decimalStringSchema,
});
export type CheckpointRequestV3 = z.infer<typeof checkpointRequestV3Schema>;
/** Immutable receipt, reused only after current authorization and equal scoped
 * canonical request comparison. Durable capture says nothing about native
 * completeness, and pending processing/indexing remains explicit. The progress
 * snapshot is capped at throughJournalSeq, even when the live stream has
 * admitted newer events. Those newer events belong to another checkpoint.
 * An unavailable requested boundary returns refusal, never durable success. */
export const checkpointResultV3Schema = z.discriminatedUnion('status', [
  z.strictObject({ protocolVersion: z.literal(3), status: z.literal('persisted'),
    requestId: uuidSchema, receiptId: uuidSchema, canonicalRequestDigest: sha256HexSchema,
    throughJournalSeq: decimalStringSchema,
    capturedDurable: z.literal(true), progress: journalProgressV3Schema,
  }).refine((v) => v.throughJournalSeq === v.progress.captured,
    'Checkpoint snapshot must end at the acknowledged durable boundary.'),
  z.strictObject({ protocolVersion: z.literal(3), status: z.literal('refused'),
    requestId: uuidSchema, code: z.enum(CAPTURE_REFUSALS_V3), capturedDurable: z.literal(false),
  }),
]);
export type CheckpointResultV3 = z.infer<typeof checkpointResultV3Schema>;
