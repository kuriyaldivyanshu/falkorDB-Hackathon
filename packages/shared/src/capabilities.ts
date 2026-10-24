import { z } from 'zod';

import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { byteBoundedText, decimalStringSchema } from './validation.js';

/**
 * Capability reporting.
 *
 * A capability entry states what this build actually supports, at what scope,
 * and — when it is not supported — why. A command that is not implemented is
 * reported as unavailable rather than retained as a hidden legacy path, and it
 * never returns fabricated success.
 */

export const CAPABILITY_SCHEMA_VERSION = 2;

export const OPERATION_IDS = [
  'service.status',
  'project.list',
  'project.add',
  'project.grant.list',
  'access.reader.issue',
  'access.reader.list',
  'access.reader.revoke',
  'access.enrollment.issue',
  'access.enrollment.list',
  'access.enrollment.inspect',
  'access.enrollment.revoke',
  'session.register',
  'session.list',
  'source.append',
  'source.inspect',
  'source.read',
  'history.page',
  'memory.query',
  'memory.propose',
  'memory.accept',
  'memory.correct',
  'memory.episode.record',
  'memory.procedure.validate',
  'task.create',
  'task.require',
  'claim.acquire',
  'claim.release',
  'claim.status',
  'handoff.offer',
  'handoff.accept',
  'handoff.revoke',
  'context.prepare',
  'context.occurrence',
  'operation.inspect',
  'job.import',
  'job.delete',
  'job.export',
] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export const OPERATION_EFFECTS = ['read', 'write', 'admin'] as const;
export type OperationEffect = (typeof OPERATION_EFFECTS)[number];

export const OPERATION_SCOPES = ['human', 'producer', 'both'] as const;
export type OperationScope = (typeof OPERATION_SCOPES)[number];

export const CAPABILITY_STATUSES = ['supported', 'unavailable', 'unqualified'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const operationCapabilitySchema = z.object({
  id: z.enum(OPERATION_IDS),
  summary: z.string().max(256),
  effect: z.enum(OPERATION_EFFECTS),
  scope: z.enum(OPERATION_SCOPES),
  status: z.enum(CAPABILITY_STATUSES),
  /** Why it is not supported, or what remains unqualified. */
  reason: z.string().max(512).nullable(),
});
export type OperationCapability = z.infer<typeof operationCapabilitySchema>;

export const adapterCapabilitySchema = z.object({
  harness: z.enum(['codex']),
  /** Version the adapter was qualified against, or null when unqualified. */
  qualifiedVersion: z.string().max(64).nullable(),
  observedVersion: z.string().max(64).nullable(),
  /** Supported native boundaries, as actually verified. */
  boundaries: z.array(byteBoundedText(128)).max(16),
  /** What capture actually covers, in the adapter's own words. */
  captureCoverage: z.string().max(256),
  /** Whether model-issued memory mutations are enabled for this build. */
  modelMutations: z.boolean(),
  detail: z.string().max(512),
});
export type AdapterCapability = z.infer<typeof adapterCapabilitySchema>;

export const capabilityReportSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  serviceVersion: z.string().max(64),
  operations: z.array(operationCapabilitySchema),
  adapter: adapterCapabilitySchema,
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

/** Contract availability is separate from implemented service capability. */
export const CONTRACT_OPERATIONS_V3 = ['capture.events', 'checkpoint.create', 'policy.update',
  'privacy.delete', 'privacy.inspect', 'operation.inspect'] as const;
export const contractCapabilityV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), contractVersion: z.literal(3),
  id: z.enum(CONTRACT_OPERATIONS_V3),
  status: z.literal('unavailable'),
  reason: z.literal('implementation_required'),
});
export type ContractCapabilityV3 = z.infer<typeof contractCapabilityV3Schema>;

/** Canonical release versions only: exactly three decimal components, without
 * prerelease/build suffixes. This intentionally does not accept general SemVer. */
export const releaseVersionV3Schema = byteBoundedText(64).refine(
  (value) => /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value),
  'Expected a canonical three-component release version.',
);
export type ReleaseVersionV3 = z.infer<typeof releaseVersionV3Schema>;

const releaseAtLeast = (actual: string, minimum: string): boolean => {
  // Refinements may run after a malformed field; never throw from safeParse.
  if (!releaseVersionV3Schema.safeParse(actual).success ||
      !releaseVersionV3Schema.safeParse(minimum).success) return false;
  const a = actual.split('.').map(BigInt);
  const b = minimum.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
};

/** Contract for a future service handshake, not a runtime capability or evidence
 * that any ledger was read. SQL ledger/contract and graph contract versions are
 * independent dimensions; never infer one from another or from the package.
 * Verification/state fields are assertions requiring runtime qualification.
 * Reader/writer minima name package release versions for the upgraded stores. */
export const compatibilityHandshakeV3Schema = z.strictObject({
  contractVersion: z.literal(3),
  wireProtocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  sqlLedgerLatest: decimalStringSchema.nullable(),
  sqlLedgerVerification: z.enum(['unverified', 'verified']),
  sqlContractVersion: decimalStringSchema,
  graphContractVersion: decimalStringSchema,
  serviceVersion: releaseVersionV3Schema,
  packageVersion: releaseVersionV3Schema,
  minimumReaderPackageVersion: releaseVersionV3Schema,
  minimumWriterPackageVersion: releaseVersionV3Schema,
  transitionState: z.enum(['legacy', 'upgrade_required', 'migrating', 'quarantined', 'ready', 'blocked']),
}).superRefine((v, ctx) => {
  if (v.sqlLedgerVerification === 'verified' && v.sqlLedgerLatest === null) {
    ctx.addIssue({ code: 'custom', message: 'Verified ledger state requires an observed latest version.' });
  }
  if (v.transitionState === 'ready' &&
      (v.sqlLedgerVerification !== 'verified' || v.sqlLedgerLatest === null ||
       !releaseAtLeast(v.packageVersion, v.minimumReaderPackageVersion) ||
       !releaseAtLeast(v.packageVersion, v.minimumWriterPackageVersion))) {
    ctx.addIssue({ code: 'custom', message: 'Ready assertions require a verified ledger and compatible reader/writer package.' });
  }
});
export type CompatibilityHandshakeV3 = z.infer<typeof compatibilityHandshakeV3Schema>;
