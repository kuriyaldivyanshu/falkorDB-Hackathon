import { z } from 'zod';

/**
 * Health and readiness reporting.
 *
 * Presence and readiness are separate facts, and readiness is reported per
 * component. An unconfigured or unavailable store is reported as unavailable;
 * no component is ever reported ready on the strength of a successful process
 * start or a cached earlier result.
 */

export const COMPONENT_NAMES = [
  'api',
  'postgres',
  'privilegedSql',
  'falkordb',
  'sources',
  'operations',
  'nativeAdapter',
] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export const SERVICE_STATES = ['created', 'starting', 'ready', 'degraded', 'stopped'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export const componentStatusSchema = z.object({
  name: z.enum(COMPONENT_NAMES),
  /** Configured or constructed at all. */
  present: z.boolean(),
  /** Usable for the operations it claims to support. */
  ready: z.boolean(),
  /** Honest detail: what is missing, or what was actually verified. */
  detail: z.string().max(512),
});
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

/**
 * Minimal unauthenticated liveness.
 *
 * Served without a credential, so it states only that the process is up and
 * which build answers. Component readiness, storage detail and cross-tenant
 * backlog counts are deliberately absent: those are operational detail and are
 * served from the authorized status route instead.
 */
export const livenessReportSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  backendVersion: z.string().max(64),
  state: z.enum(SERVICE_STATES),
  uptimeMs: z.number().int().nonnegative(),
});
export type LivenessReport = z.infer<typeof livenessReportSchema>;

export const backendGuaranteesSchema = z.object({
  /**
   * Accepted memory survives restarts in FalkorDB. Only true once the memory
   * write/read services exist and their commit path is running; connectivity
   * alone never sets it (N02B onward).
   */
  durableMemory: z.boolean(),
  /**
   * Source-backed graph admission commits are durable: SQL is applied, the
   * narrow cross-tenant functions are usable, FalkorDB is reachable and the
   * leased worker is running. Connectivity alone never sets it.
   */
  graphAdmission: z.boolean(),
  /** Authorized source history is readable from SQL plus immutable files. */
  sourceHistory: z.boolean(),
  /** Process-local status notifications exist; there is no durable replay. */
  replayable: z.literal(false),
  note: z.string().max(1024),
});
export type BackendGuarantees = z.infer<typeof backendGuaranteesSchema>;

export const healthReportSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  backendVersion: z.string().max(64),
  state: z.enum(SERVICE_STATES),
  uptimeMs: z.number().int().nonnegative(),
  components: z.array(componentStatusSchema),
  guarantees: backendGuaranteesSchema,
});
export type HealthReport = z.infer<typeof healthReportSchema>;
