import { z } from 'zod';

import { applicabilitySchema, observedUnderSchema } from './memory.js';
import { operationStateSchema } from './operations.js';
import { byteBoundedText, uuidSchema } from './validation.js';

/**
 * Coordination contracts.
 *
 * A coordination claim is a time-bounded right to advance specified shared task
 * memory. It fences Threadline memory updates only: it does not grant, prevent
 * or supervise native filesystem execution, and its expiry never proves that a
 * native command stopped.
 *
 * A handoff is an offer of current task state to another session. Its content is
 * a `handoff` MemoryVersion; this module carries the state transitions.
 */

export const CLAIM_STATES = ['active', 'released', 'expired'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const claimViewSchema = z.object({
  claimId: uuidSchema,
  projectId: uuidSchema,
  taskId: uuidSchema,
  ownerSessionId: uuidSchema.nullable(),
  /** Opaque equality token; a stale token cannot advance claimed memory. */
  claimToken: z.string().min(1).max(64),
  state: z.enum(CLAIM_STATES),
  /** Task revision the claim was granted against. */
  expectedTaskRevision: z.string().min(1).max(64),
  acquiredAtMs: z.number().int().nonnegative(),
  leaseExpiresAtMs: z.number().int().nonnegative(),
});
export type ClaimView = z.infer<typeof claimViewSchema>;

export const CLAIM_DEFAULT_LEASE_MS = 15 * 60 * 1000;

export const acquireClaimInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema,
  ownerSessionId: uuidSchema.nullable().optional(),
  expectedTaskRevision: z.string().min(1).max(64),
  leaseMs: z.number().int().min(30_000).max(60 * 60 * 1000).default(CLAIM_DEFAULT_LEASE_MS),
  idempotencyKey: byteBoundedText(200),
});
export type AcquireClaimInput = z.infer<typeof acquireClaimInputSchema>;

export const releaseClaimInputSchema = z.object({
  projectId: uuidSchema,
  claimId: uuidSchema,
  claimToken: z.string().min(1).max(64),
  idempotencyKey: byteBoundedText(200),
});
export type ReleaseClaimInput = z.infer<typeof releaseClaimInputSchema>;

export const claimOperationResultSchema = z.object({
  operationId: uuidSchema,
  state: operationStateSchema,
  claim: claimViewSchema.nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});
export type ClaimOperationResult = z.infer<typeof claimOperationResultSchema>;

/**
 * Offers a handoff to another session.
 *
 * The offered content is the `handoff` memory payload; this input adds the task
 * binding, the evidence closure and the applicability conditions.
 */
export const offerHandoffInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema,
  memoryId: uuidSchema.nullable().optional(),
  objective: byteBoundedText(2048),
  openWork: byteBoundedText(2048),
  unresolved: z.array(byteBoundedText(512)).max(16),
  fromSessionId: uuidSchema.nullable(),
  toSessionId: uuidSchema.nullable(),
  taskRevision: z.string().max(128).nullable(),
  /** The claim the offering session holds, when the offer is claim-backed. */
  claimToken: z.string().min(1).max(64).nullable().optional(),
  sourceIds: z.array(uuidSchema).max(64),
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  idempotencyKey: byteBoundedText(200),
});
export type OfferHandoffInput = z.infer<typeof offerHandoffInputSchema>;

export const acceptHandoffInputSchema = z.object({
  projectId: uuidSchema,
  memoryId: uuidSchema,
  versionId: uuidSchema,
  expectedCurrentVersionId: uuidSchema.nullable(),
  acceptingSessionId: uuidSchema.nullable().optional(),
  idempotencyKey: byteBoundedText(200),
});
export type AcceptHandoffInput = z.infer<typeof acceptHandoffInputSchema>;

export const revokeHandoffInputSchema = z.object({
  projectId: uuidSchema,
  memoryId: uuidSchema,
  versionId: uuidSchema,
  expectedCurrentVersionId: uuidSchema,
  reason: byteBoundedText(512),
  idempotencyKey: byteBoundedText(200),
});
export type RevokeHandoffInput = z.infer<typeof revokeHandoffInputSchema>;

export const handoffOperationResultSchema = z.object({
  operationId: uuidSchema,
  state: operationStateSchema,
  memoryId: uuidSchema.nullable(),
  versionId: uuidSchema.nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});
export type HandoffOperationResult = z.infer<typeof handoffOperationResultSchema>;

export const claimStatusQuerySchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema,
});
export type ClaimStatusQuery = z.infer<typeof claimStatusQuerySchema>;

export const claimStatusSchema = z.object({
  taskId: uuidSchema,
  taskRevision: z.string(),
  claim: claimViewSchema.nullable(),
  /** True when the current claim's lease has passed. */
  expired: z.boolean(),
  checkedAtMs: z.number().int().nonnegative(),
});
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
