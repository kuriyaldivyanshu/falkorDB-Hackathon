import { z } from 'zod';
import { decimalStringSchema, isDecimalString, sha256HexSchema, uuidSchema } from './validation.js';
import { expectedPolicyV3Schema, policyFenceV3Schema } from './policy.js';

export const deletionSelectionV3Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sources'), sourceIds: z.array(uuidSchema).min(1).max(100) }),
  z.strictObject({ kind: z.literal('memories'), memoryIds: z.array(uuidSchema).min(1).max(100) }),
  z.strictObject({ kind: z.literal('project') }),
]).superRefine((v, ctx) => {
  const ids = v.kind === 'sources' ? v.sourceIds : v.kind === 'memories' ? v.memoryIds : [];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate deletion targets.' });
});
export type DeletionSelectionV3 = z.infer<typeof deletionSelectionV3Schema>;

/** Eligibility is computed under current owner authorization and dependency
 * locks, never granted by the submitted selection. No target labels/bodies. */
export const deletionEligibilityV3Schema = z.discriminatedUnion('eligible', [
  z.strictObject({ eligible: z.literal(true), selectionDigest: sha256HexSchema,
    fence: policyFenceV3Schema, dependencyClosure: z.literal('checked') }),
  z.strictObject({ eligible: z.literal(false),
    code: z.enum(['unauthorized', 'policy_changed', 'dependency_unavailable', 'selection_too_broad']) }),
]);
export type DeletionEligibilityV3 = z.infer<typeof deletionEligibilityV3Schema>;
export const deletionRequestV3Schema = z.strictObject({
  protocolVersion: z.literal(3), requestId: uuidSchema, projectId: uuidSchema,
  guard: expectedPolicyV3Schema, selection: deletionSelectionV3Schema,
});
export type DeletionRequestV3 = z.infer<typeof deletionRequestV3Schema>;

/** SQL denial, recovery-ledger durability and managed purge are independent.
 * This receipt contains only safe replay metadata; it never certifies erasure
 * of backups or external deliveries. Reauthorize even duplicate receipt reads. */
export const deletionReceiptV3Schema = z.strictObject({
  protocolVersion: z.literal(3), receiptId: uuidSchema, deletionId: uuidSchema,
  operationId: uuidSchema, requestId: uuidSchema, projectId: uuidSchema,
  canonicalRequestDigest: sha256HexSchema, selectionDigest: sha256HexSchema,
  fence: policyFenceV3Schema,
  previousPrivacyGeneration: decimalStringSchema,
  denial: z.literal('committed'),
  graphFence: z.enum(['pending', 'durable']),
  priorEffects: z.enum(['pending', 'reconciled']),
  ledger: z.enum(['pending', 'durable']),
  purge: z.enum(['pending', 'running', 'complete', 'blocked']),
  restoreProtection: z.enum(['pending', 'durable_ledger_requires_trusted_head']),
  managedErasure: z.enum(['pending', 'complete']),
  backupErasure: z.literal('not_claimed'),
  externalErasure: z.literal('not_claimed'),
  remainingBatches: decimalStringSchema,
  code: z.enum(['none', 'storage_unavailable', 'dependency_unavailable', 'reconciliation_pending']),
}).superRefine((v, ctx) => {
  const fail = (message: string): void => { ctx.addIssue({ code: 'custom', message }); };
  if (isDecimalString(v.previousPrivacyGeneration) &&
      isDecimalString(v.fence.privacyGeneration) &&
      BigInt(v.fence.privacyGeneration) <= BigInt(v.previousPrivacyGeneration))
    fail('Deletion must advance the privacy generation.');
  if ((v.restoreProtection !== 'pending') !== (v.ledger === 'durable'))
    fail('Restore protection requires a durable recovery ledger.');
  if (v.priorEffects === 'reconciled' && v.graphFence !== 'durable')
    fail('Prior effects cannot be settled before the graph fence.');
  if (v.purge !== 'pending' && v.purge !== 'blocked' &&
      (v.graphFence !== 'durable' || v.priorEffects !== 'reconciled'))
    fail('Purge requires a durable graph fence and reconciled prior effects.');
  if ((v.managedErasure === 'complete') !== (v.purge === 'complete'))
    fail('Managed erasure requires completed purge.');
  if (v.purge === 'complete' && (v.remainingBatches !== '0' || v.code !== 'none'))
    fail('Completed purge cannot have pending batches or failures.');
});
export type DeletionReceiptV3 = z.infer<typeof deletionReceiptV3Schema>;
export const deletionResultV3Schema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('denial_committed'), receipt: deletionReceiptV3Schema }),
  z.strictObject({ status: z.literal('refused'), protocolVersion: z.literal(3), requestId: uuidSchema,
    code: z.enum(['unauthorized', 'policy_changed', 'privacy_changed', 'idempotency_mismatch',
      'dependency_unavailable', 'selection_too_broad', 'storage_unavailable']) }),
]);
export type DeletionResultV3 = z.infer<typeof deletionResultV3Schema>;
