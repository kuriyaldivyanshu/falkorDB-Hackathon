import { z } from 'zod';

import { byteBoundedText, decimalStringSchema, uuidSchema } from './validation.js';

/**
 * Identity, project association and native enrollment contracts.
 *
 * Scope is always derived from an authenticated credential plus a stored
 * binding. A project id, workspace path or native session id supplied by a
 * caller is a requested target, never proof of authorization.
 */

export const PRINCIPAL_KINDS = ['human', 'service'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const PROJECT_ROLES = ['owner', 'member', 'reader'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const GRANT_STATES = ['active', 'revoked'] as const;
export type GrantState = (typeof GRANT_STATES)[number];

export const WORKSPACE_ROOT_KINDS = ['repository', 'worktree', 'directory'] as const;
export type WorkspaceRootKind = (typeof WORKSPACE_ROOT_KINDS)[number];

export const NATIVE_HARNESSES = ['codex'] as const;
export type NativeHarness = (typeof NATIVE_HARNESSES)[number];

/**
 * How precisely a native session was identified.
 *
 * `strong` is reserved for a qualified harness identity (unavailable).
 * `provisional` identifies a server-registered instance without proving a native
 * conversation, fork or subagent.
 */
export const IDENTITY_PRECISIONS = ['strong', 'provisional'] as const;
export type IdentityPrecision = (typeof IDENTITY_PRECISIONS)[number];

/** How much of a session's visible work is believed to be captured. */
export const CAPTURE_COVERAGES = ['unknown', 'partial', 'supported'] as const;
export type CaptureCoverage = (typeof CAPTURE_COVERAGES)[number];

export const CLIENT_TOKEN_KINDS = ['human_admin', 'producer', 'reader'] as const;
export type ClientTokenKind = (typeof CLIENT_TOKEN_KINDS)[number];

export const projectViewSchema = z.object({
  projectId: uuidSchema,
  tenantId: uuidSchema,
  label: byteBoundedText(256),
  role: z.enum(PROJECT_ROLES),
  /** Opaque graph routing value resolved by the service, never supplied by a caller. */
  graphEpoch: uuidSchema,
  policyState: z.enum(['ready', 'changing', 'blocked']),
  privacyRevision: decimalStringSchema,
});
export type ProjectView = z.infer<typeof projectViewSchema>;

export const principalViewSchema = z.object({
  principalId: uuidSchema,
  tenantId: uuidSchema,
  kind: z.enum(PRINCIPAL_KINDS),
  displayLabel: byteBoundedText(256),
  active: z.boolean(),
});
export type PrincipalView = z.infer<typeof principalViewSchema>;

export const projectGrantViewSchema = z.object({
  projectId: uuidSchema,
  principalId: uuidSchema,
  role: z.enum(PROJECT_ROLES),
  state: z.enum(GRANT_STATES),
  grantRevision: decimalStringSchema,
});
export type ProjectGrantView = z.infer<typeof projectGrantViewSchema>;

/**
 * An explicit association between a project and a filesystem root.
 *
 * `canonicalRoot` is resolved and fingerprinted by the service. The path is an
 * input hint at association time only; a path alone never authorizes access.
 */
export const workspaceBindingViewSchema = z.object({
  bindingId: uuidSchema,
  projectId: uuidSchema,
  rootKind: z.enum(WORKSPACE_ROOT_KINDS),
  canonicalRoot: byteBoundedText(4096),
  rootFingerprint: byteBoundedText(256),
  state: z.enum(['active', 'revoked']),
  approvingPrincipalId: uuidSchema,
  createdAtMs: z.number().int().nonnegative(),
});
export type WorkspaceBindingView = z.infer<typeof workspaceBindingViewSchema>;

export const nativeSessionViewSchema = z.object({
  nativeSessionId: uuidSchema,
  projectId: uuidSchema,
  bindingId: uuidSchema,
  enrollmentId: uuidSchema,
  bindingGeneration: z.literal(1),
  harness: z.enum(NATIVE_HARNESSES),
  harnessVersion: byteBoundedText(64),
  /** Native thread/root id when the harness reports one; never required. */
  nativeThreadRef: z.string().min(1).max(256).nullable(),
  parentThreadRef: z.string().min(1).max(256).nullable(),
  identityPrecision: z.literal('provisional'),
  captureCoverage: z.literal('unknown'),
  state: z.enum(['active', 'closed']),
  createdAtMs: z.number().int().nonnegative(),
  lastSeenAtMs: z.number().int().nonnegative(),
});
export type NativeSessionView = z.infer<typeof nativeSessionViewSchema>;

/**
 * A project-scoped enrollment of a native adapter.
 *
 * Enrollment identifies scope, not a conversation: the registered instance is
 * pinned separately to one native session per binding generation.
 */
export const enrollmentViewSchema = z.strictObject({
  enrollmentId: uuidSchema,
  projectId: uuidSchema,
  principalId: uuidSchema,
  bindingId: uuidSchema,
  credentialId: uuidSchema,
  label: byteBoundedText(256),
  bindingGeneration: z.literal(1),
  harness: z.enum(NATIVE_HARNESSES),
  state: z.enum(['active', 'revoked', 'expired']),
  nativeSessionId: uuidSchema.nullable(),
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  idleExpiresAtMs: z.number().int().nonnegative(),
  revokedAtMs: z.number().int().nonnegative().nullable(),
});
export type EnrollmentView = z.infer<typeof enrollmentViewSchema>;

/** Input for `threadline project add`. The service resolves and fingerprints the root. */
export const projectAddInputSchema = z.object({
  root: byteBoundedText(4096),
  label: byteBoundedText(256).optional(),
  /** Explicit join of an existing project instead of creating a new one. */
  joinProjectId: uuidSchema.optional(),
  idempotencyKey: byteBoundedText(200),
});
export type ProjectAddInput = z.infer<typeof projectAddInputSchema>;

export const projectJoinResultSchema = z.object({
  project: projectViewSchema,
  binding: workspaceBindingViewSchema,
  /** False when the association already existed and was reused unchanged. */
  created: z.boolean(),
});
export type ProjectJoinResult = z.infer<typeof projectJoinResultSchema>;

export const nativeSessionRegisterInputSchema = z.strictObject({
  expectedBindingGeneration: z.number().int().min(1).max(2147483647),
  idempotencyKey: byteBoundedText(200),
  adapterInstanceNonce: byteBoundedText(256),
  harnessVersion: byteBoundedText(64),
  nativeThreadRef: byteBoundedText(256).nullable().default(null),
  parentThreadRef: byteBoundedText(256).nullable().default(null),
  identityPrecision: z.literal('provisional').default('provisional'),
  captureCoverage: z.literal('unknown').default('unknown'),
});
export type NativeSessionRegisterInput = z.infer<typeof nativeSessionRegisterInputSchema>;

/**
 * The scope an authenticated call resolves to, after authorization.
 *
 * Project fields are `null` for tenant-level calls (project association, grant
 * listing outside a project). A caller never supplies these values: they come
 * from the stored credential and grant, so a requested project id cannot
 * promote itself.
 */
export interface AuthorizedScope {
  readonly tenantId: string;
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly projectId: string | null;
  readonly role: ProjectRole | null;
  readonly tokenKind: ClientTokenKind;
  readonly graphKey: string | null;
  readonly graphEpoch: string | null;
  readonly privacyRevision: string | null;
  readonly nativeSessionId: string | null;
}
