import { z } from 'zod';

import { byteBoundedText } from './validation.js';

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
