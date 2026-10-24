import { z } from 'zod';

import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { decimalStringSchema, uuidSchema } from './validation.js';

export const policyFenceV3Schema = z.strictObject({
  policyRevision: decimalStringSchema,
  privacyGeneration: decimalStringSchema,
  graphEpoch: uuidSchema,
});
export type PolicyFenceV3 = z.infer<typeof policyFenceV3Schema>;

export const expectedPolicyV3Schema = z.strictObject({
  expectedPolicyRevision: decimalStringSchema,
  expectedPrivacyGeneration: decimalStringSchema,
});
export type ExpectedPolicyV3 = z.infer<typeof expectedPolicyV3Schema>;

/** Owner ceilings cannot be weakened by project/producer preferences. Neither
 * schemas nor policy claims prove ownership, permission or sanitizer execution. */
export const ownerPolicyV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  projectId: uuidSchema,
  ownerPrincipalId: uuidSchema,
  fence: policyFenceV3Schema,
  ceilings: z.strictObject({
    manualRecord: z.boolean(),
    checkpointCallbacks: z.boolean(),
    maxPayloadBytes: z.number().int().min(1).max(65536),
    maxBatchRecords: z.number().int().min(1).max(20),
    retentionDays: z.number().int().min(1).max(3650),
  }),
  automaticRecall: z.literal(false),
  externalInference: z.literal(false),
  nativeOccurrenceCapture: z.literal(false),
});
export type OwnerPolicyV3 = z.infer<typeof ownerPolicyV3Schema>;

export const updateOwnerPolicyV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  projectId: uuidSchema,
  requestId: uuidSchema,
  guard: expectedPolicyV3Schema,
  ceilings: ownerPolicyV3Schema.shape.ceilings,
});
export type UpdateOwnerPolicyV3 = z.infer<typeof updateOwnerPolicyV3Schema>;
