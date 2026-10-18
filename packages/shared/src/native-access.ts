import { z } from 'zod';

import { enrollmentViewSchema, nativeSessionViewSchema } from './identity.js';
import { byteBoundedText, uuidSchema } from './validation.js';

export const ENROLLMENT_DEFAULT_LIFETIME_SECONDS = 86400;
export const ENROLLMENT_MAX_LIFETIME_SECONDS = 604800;
export const NATIVE_ACCESS_LIST_MAX = 100;

export const issueEnrollmentInputSchema = z.strictObject({
  bindingId: uuidSchema,
  label: byteBoundedText(256),
  idempotencyKey: byteBoundedText(200),
  lifetimeSeconds: z.number().int().min(1).max(ENROLLMENT_MAX_LIFETIME_SECONDS)
    .default(ENROLLMENT_DEFAULT_LIFETIME_SECONDS),
});
export const issueEnrollmentResultSchema = z.discriminatedUnion('secretDelivery', [
  z.strictObject({ secretDelivery: z.literal('initial'), enrollment: enrollmentViewSchema,
    bearer: z.string().regex(/^tl_[A-Za-z0-9_-]{43}$/) }),
  z.strictObject({ secretDelivery: z.literal('not_repeated'), enrollment: enrollmentViewSchema }),
]);
export type IssueEnrollmentResult = z.infer<typeof issueEnrollmentResultSchema>;
export const listEnrollmentsResultSchema = z.strictObject({
  enrollments: z.array(enrollmentViewSchema).max(NATIVE_ACCESS_LIST_MAX), hasMore: z.boolean(),
});
export type ListEnrollmentsResult = z.infer<typeof listEnrollmentsResultSchema>;
export const listNativeSessionsResultSchema = z.strictObject({
  sessions: z.array(nativeSessionViewSchema).max(NATIVE_ACCESS_LIST_MAX), hasMore: z.boolean(),
});
export type ListNativeSessionsResult = z.infer<typeof listNativeSessionsResultSchema>;
