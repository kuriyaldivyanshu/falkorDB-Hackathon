import { z } from 'zod';

import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { byteBoundedText, decimalStringSchema, sha256HexSchema, uuidSchema } from './validation.js';

/**
 * Durable operation and job contracts.
 *
 * One ledger carries every durable mutation: source admission, memory changes,
 * coordination, privacy barriers and background jobs. An operation's identity
 * is its idempotency key plus a canonical request digest; the same key with a
 * different payload refuses. States describe durable work observed by this
 * service — never the outcome of native code.
 *
 * A lost response leaves an operation `ambiguous`. It is reconciled against its
 * graph receipt under the same identity; the caller never invents a second
 * operation to escape uncertainty, and native work is never replayed to repair
 * a missing memory receipt.
 */

/**
 * Dotted operation ids, stored verbatim in the SQL ledger's `kind` column and
 * named after the capability that admits them. One form only: `source.append`,
 * never `source_append`.
 */
export const OPERATION_KINDS = [
  'source.append',
  'memory.propose',
  'memory.accept',
  'memory.correct',
  'memory.episode.record',
  'claim.acquire',
  'claim.release',
  'handoff.offer',
  'handoff.accept',
  'handoff.revoke',
  'task.create',
  'task.require',
  'privacy.barrier',
  'job.import',
  'job.delete',
  'job.export',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_STATES = [
  'pending',
  'leased',
  'ambiguous',
  'committed',
  'rejected',
  'cancelled',
] as const;

/**
 * The one operation-state contract. Every result that reports an operation's
 * state references this schema rather than restating the state list, so a new
 * state cannot be recognised in one place and refused in another.
 */
export const operationStateSchema = z.enum(OPERATION_STATES);
export type OperationState = z.infer<typeof operationStateSchema>;

export const operationReceiptSchema = z.object({
  graphEpoch: uuidSchema,
  /** Graph event sequence as a canonical decimal string. */
  eventSeq: decimalStringSchema,
  outcome: z.string().max(64),
  committedAtMs: z.number().int().nonnegative(),
});
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;

export const operationViewSchema = z.object({
  operationId: uuidSchema,
  kind: z.enum(OPERATION_KINDS),
  state: operationStateSchema,
  requestDigest: sha256HexSchema,
  attempts: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
  settledAtMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().max(64).nullable(),
  receipt: operationReceiptSchema.nullable(),
});
export type OperationView = z.infer<typeof operationViewSchema>;

export const operationQuerySchema = z.object({
  projectId: uuidSchema,
  operationId: uuidSchema,
});
export type OperationQuery = z.infer<typeof operationQuerySchema>;

export const operationDrainResultSchema = z.object({
  claimed: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
});
export type OperationDrainResult = z.infer<typeof operationDrainResultSchema>;

export const operationQueueStatusSchema = z.object({
  pending: z.number().int().nonnegative(),
  leased: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  oldestPendingAtMs: z.number().int().nonnegative().nullable(),
});
export type OperationQueueStatus = z.infer<typeof operationQueueStatusSchema>;

export const JOB_KINDS = ['import', 'delete', 'export', 'retention'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const jobViewSchema = z.object({
  jobId: uuidSchema,
  projectId: uuidSchema,
  kind: z.enum(JOB_KINDS),
  state: z.enum(JOB_STATES),
  stage: z.string().max(64),
  cursor: z.string().max(512).nullable(),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
  manifestSourceId: uuidSchema,
  selectionDigest: sha256HexSchema,
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  errorCode: z.string().max(64).nullable(),
  errorDetail: byteBoundedText(256).nullable(),
});
export type JobView = z.infer<typeof jobViewSchema>;

export const jobQuerySchema = z.object({
  projectId: uuidSchema,
  jobId: uuidSchema,
});
export type JobQuery = z.infer<typeof jobQuerySchema>;

export const jobListQuerySchema = z.object({
  projectId: uuidSchema,
  state: z.enum(JOB_STATES).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

/** V3 identities have distinct purposes even though all are opaque UUIDs.
 * A processing job does not identify a source observation or mutation effect. */
export const operationIdentityV3Schema = z.strictObject({
  requestId: uuidSchema,
  operationId: uuidSchema,
  processingJobId: uuidSchema.nullable(),
  memoryMutationId: uuidSchema.nullable(),
});
export type OperationIdentityV3 = z.infer<typeof operationIdentityV3Schema>;

export const guardedMutationV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), requestId: uuidSchema, projectId: uuidSchema,
  memoryId: uuidSchema, expectedVersionId: uuidSchema,
  expectedPolicyRevision: decimalStringSchema, expectedPrivacyGeneration: decimalStringSchema,
});
export type GuardedMutationV3 = z.infer<typeof guardedMutationV3Schema>;

export const operationReceiptV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), identity: operationIdentityV3Schema,
  projectId: uuidSchema, graphEpoch: uuidSchema,
  policyRevision: decimalStringSchema, privacyGeneration: decimalStringSchema,
  canonicalRequestDigest: sha256HexSchema,
  outcome: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('pending'), intentDurable: z.literal(true) }),
    z.strictObject({ state: z.literal('reconciling'), intentDurable: z.literal(true) }),
    z.strictObject({ state: z.literal('committed'), graphReceiptId: uuidSchema,
      memoryVersionId: uuidSchema.nullable() }),
    z.strictObject({ state: z.literal('no_effect'), reason: z.enum(['ignored', 'not_indexable']) }),
    z.strictObject({ state: z.literal('refused'), code: z.enum(['unauthorized', 'policy_changed',
      'privacy_changed', 'version_conflict', 'idempotency_mismatch', 'sanitizer_rejected']) }),
  ]),
});
export type OperationReceiptV3 = z.infer<typeof operationReceiptV3Schema>;
