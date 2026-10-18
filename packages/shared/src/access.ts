import { z } from 'zod';

import { byteBoundedText, uuidSchema } from './validation.js';

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
