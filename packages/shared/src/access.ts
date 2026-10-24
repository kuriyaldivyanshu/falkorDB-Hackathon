import { z } from 'zod';

import { producerTargetV3Schema } from './identity.js';
import { policyFenceV3Schema } from './policy.js';
import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { byteBoundedText, compareDecimalStrings, decimalStringSchema, isDecimalString, isoInstantSchema, uuidSchema } from './validation.js';

export const READER_DEFAULT_LIFETIME_SECONDS = 24 * 60 * 60;
export const READER_MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const READER_LIST_MAX = 100;

export const issueReaderCredentialInputSchema = z.strictObject({
  label: byteBoundedText(256),
  idempotencyKey: byteBoundedText(200),
  lifetimeSeconds: z.number().int().min(1).max(READER_MAX_LIFETIME_SECONDS)
    .default(READER_DEFAULT_LIFETIME_SECONDS),
});
export const readerCredentialMetadataSchema = z.strictObject({
  credentialId: uuidSchema,
  projectId: uuidSchema,
  principalId: uuidSchema,
  label: byteBoundedText(256),
  kind: z.literal('reader'),
  role: z.literal('reader'),
  state: z.enum(['active', 'revoked', 'expired']),
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  idleExpiresAtMs: z.number().int().nonnegative(),
  revokedAtMs: z.number().int().nonnegative().nullable(),
});
export type ReaderCredentialMetadata = z.infer<typeof readerCredentialMetadataSchema>;
export const issueReaderCredentialResultSchema = z.discriminatedUnion('secretDelivery', [
  z.strictObject({ secretDelivery: z.literal('initial'), credential: readerCredentialMetadataSchema,
    bearer: z.string().regex(/^tl_[A-Za-z0-9_-]{43}$/) }),
  z.strictObject({ secretDelivery: z.literal('not_repeated'), credential: readerCredentialMetadataSchema }),
]);
export type IssueReaderCredentialResult = z.infer<typeof issueReaderCredentialResultSchema>;
export const listReaderCredentialsResultSchema = z.strictObject({
  credentials: z.array(readerCredentialMetadataSchema).max(READER_LIST_MAX),
  hasMore: z.boolean(),
});
export type ListReaderCredentialsResult = z.infer<typeof listReaderCredentialsResultSchema>;

/** Selection is a request, never proof of enrollment or workspace ownership.
 * Resolve the selected project's stored enrollment before any content work.
 * Separate private/shared projects may enroll the same workspace. Neither root
 * hints nor the repository default may substitute for an explicit selection. */
export const projectSelectionV3Schema = z.strictObject({
  projectId: uuidSchema,
  workspaceBindingId: uuidSchema,
  target: producerTargetV3Schema,
  selection: z.literal('explicit_enrollment'),
});
export type ProjectSelectionV3 = z.infer<typeof projectSelectionV3Schema>;

/** Server view only. No per-memory private lane is supported in a shared
 * project; selected sharing creates a destination version, not a scope change. */
export const resolvedProjectSelectionV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  selection: projectSelectionV3Schema,
  tenantId: uuidSchema,
  principalId: uuidSchema,
  projectVisibility: z.enum(['private', 'shared']),
  repositoryDefaultProjectId: uuidSchema.nullable(),
  acceptedMemoryScope: z.literal('project'),
});
export type ResolvedProjectSelectionV3 = z.infer<typeof resolvedProjectSelectionV3Schema>;

/** Project graph-event sequences are NOT capture stream journal frontiers.
 * The watermark covers contiguous indexed/no-index-effect committed events,
 * including acceptance, correction and deletion in this projection generation. */
export const projectProjectionV3Schema = z.strictObject({
  projectId: uuidSchema,
  fence: policyFenceV3Schema,
  projectionGeneration: decimalStringSchema,
  graphHead: decimalStringSchema,
  committedGraphEvent: decimalStringSchema,
  indexedGraphEvent: decimalStringSchema,
}).refine((v) => isDecimalString(v.indexedGraphEvent) && isDecimalString(v.committedGraphEvent) &&
  isDecimalString(v.graphHead) && compareDecimalStrings(v.indexedGraphEvent, v.committedGraphEvent) <= 0 &&
  compareDecimalStrings(v.committedGraphEvent, v.graphHead) <= 0,
  'Project events must satisfy indexed <= committed <= graph head.');
export type ProjectProjectionV3 = z.infer<typeof projectProjectionV3Schema>;

export const minimumGraphBoundaryV3Schema = z.strictObject({
  projectId: uuidSchema,
  graphEpoch: uuidSchema,
  projectionGeneration: decimalStringSchema,
  committedGraphEvent: decimalStringSchema,
  operationId: uuidSchema.nullable(),
});
export type MinimumGraphBoundaryV3 = z.infer<typeof minimumGraphBoundaryV3Schema>;

/** Server-resolved release snapshot. Validation establishes shape only: every
 * release (including metadata/counts/edges/history) still requires a current
 * committed permit, dependency closure and authority/denial rechecks. It is
 * never a reusable client bearer, nor evidence that sanitizer/locks ran. */
export const readReleaseV3Schema = z.strictObject({
  tenantId: uuidSchema,
  principalId: uuidSchema,
  projection: projectProjectionV3Schema,
  permitId: uuidSchema,
  checkedAt: isoInstantSchema,
});
export type ReadReleaseV3 = z.infer<typeof readReleaseV3Schema>;
