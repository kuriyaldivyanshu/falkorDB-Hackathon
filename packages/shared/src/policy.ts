import { z } from 'zod';

import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { byteBoundedText, decimalStringSchema, uuidSchema, sha256HexSchema } from './validation.js';

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

/** Approval binds the exact parsed owner/project candidate, never file text. */
export const activatePolicyV3Schema = updateOwnerPolicyV3Schema.extend({
  candidateDigest: sha256HexSchema,
  bindingId: uuidSchema.optional(),
});
export type ActivatePolicyV3 = z.infer<typeof activatePolicyV3Schema>;
/** Safe resolved settings for an approval decision, without local file paths or
 * raw TOML. Numeric ceilings are validated by the existing policy parser. */
export const effectivePolicyPreviewV3Schema = z.strictObject({
  ceilings: ownerPolicyV3Schema.shape.ceilings,
  recall: z.strictObject({
    allowAgentRequests: z.boolean(), allowExplicitUserRequests: z.boolean(),
    maxCandidates: z.number().int().positive(), optionalWaitMs: z.number().int().nonnegative(),
    recallMaxTokens: z.number().int().positive(), followupMaxTokens: z.number().int().positive(),
    activeTargetTokens: z.number().int().positive(),
  }),
  excludePaths: z.array(byteBoundedText(256)).max(64),
  automaticRecall: z.literal(false), externalInference: z.literal(false), nativeOccurrenceCapture: z.literal(false),
});
export const policyDiagnosticV3Schema = z.strictObject({
  file: z.enum(['owner','project','binding']), key: byteBoundedText(128),
  reason: z.enum(['invalid_policy','binding_required','reconciliation_required']),
  message: byteBoundedText(1024),
});
export const policyStatusV3Schema = z.strictObject({
  projectId: uuidSchema,
  current: ownerPolicyV3Schema,
  state: z.enum(['baseline','active','reconciliation_required','binding_required']),
  candidateDigest: sha256HexSchema.nullable(),
  candidateCeilings: ownerPolicyV3Schema.shape.ceilings.nullable(),
  bindingId: uuidSchema.nullable(),
  currentSettings: effectivePolicyPreviewV3Schema,
  candidateSettings: effectivePolicyPreviewV3Schema.nullable(),
  diagnostics: z.array(policyDiagnosticV3Schema).max(8),
});
export type PolicyStatusV3 = z.infer<typeof policyStatusV3Schema>;
