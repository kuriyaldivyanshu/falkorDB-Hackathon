import { CAPABILITY_ROUTE, ThreadlineError } from '@threadline/shared';
import type { CapabilityReport, OperationCapability, OperationId } from '@threadline/shared';

import { authHeaders } from './auth.js';

/**
 * Capability client (M05B10).
 *
 * Availability comes from the backend's own report for the authenticated
 * caller, never from catalogue presence. An operation can be published and still
 * be unavailable for this caller right now — no profile configured, no admitted
 * task, an unresolved effect — and the interface has to show that difference
 * rather than infer support from a lucky 404.
 *
 * The report is cached briefly and invalidated on reconnect, profile change,
 * task change and run change, because those are exactly the observations it is
 * derived from. Execution still rechecks authority server-side; this only decides
 * what the interface offers.
 */

const CACHE_MS = 5_000;

export interface CapabilityClient {
  report(options?: { readonly projectId?: string | null; readonly force?: boolean }): Promise<CapabilityReport>;
  /** Whether an operation can be invoked right now. Never infers from a 404. */
  available(operationId: OperationId): boolean;
  /** The full capability, when the report has been loaded. */
  entry(operationId: OperationId): OperationCapability | null;
  /** Drops the cache; call on reconnect, profile, task or run change. */
  invalidate(): void;
  /** True once a report has been loaded; false means availability is unknown. */
  readonly loaded: boolean;
}

export function createCapabilityClient(options: {
  baseUrl: string;
  token: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): CapabilityClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options.token);

  let cached: CapabilityReport | null = null;
  let cachedAt = 0;
  let cachedProject: string | null = null;
  let selectedProject: string | null = null;
  let requestGeneration = 0;
  let inFlight: { readonly projectId: string | null; readonly generation: number; readonly promise: Promise<CapabilityReport> } | null = null;
  let loaded = false;

  const index = (report: CapabilityReport): Map<string, OperationCapability> =>
    new Map(report.operations.map((operation) => [operation.operationId, operation]));

  const client: CapabilityClient = {
    get loaded() { return loaded; },

    invalidate() {
      requestGeneration += 1;
      cached = null;
      cachedAt = 0;
      cachedProject = null;
      selectedProject = null;
      inFlight = null;
      loaded = false;
    },

    async report(request = {}) {
      const projectId = request.projectId !== undefined ? request.projectId : selectedProject;
      const fresh = cached !== null && projectId === cachedProject && Date.now() - cachedAt < CACHE_MS;
      if (fresh && !request.force) return cached as CapabilityReport;
      if (inFlight?.projectId === projectId) return inFlight.promise;

      const generation = ++requestGeneration;
      selectedProject = projectId;
      // Do not expose the previous project's permissions while this report is
      // loading. An older response may finish, but generation checks keep it
      // from replacing this request's cache.
      cached = null;
      cachedAt = 0;
      cachedProject = projectId;
      loaded = false;

      const promise = (async () => {
        try {
          const query = projectId === null ? '' : `?projectId=${encodeURIComponent(projectId)}`;
          const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
          let response: Response;
          try {
            response = await doFetch(`${base}${CAPABILITY_ROUTE}${query}`, { headers, signal: timeout });
          } catch {
            throw new ThreadlineError('storage_unavailable', 'Capability information is unavailable.');
          }
          const text = await response.text();
          let value: unknown;
          try {
            value = text.length === 0 ? null : (JSON.parse(text) as unknown);
          } catch {
            throw new ThreadlineError('storage_unavailable', 'The capability response was not JSON.');
          }
          if (!response.ok || value === null || typeof value !== 'object') {
            const body = (value ?? {}) as Record<string, unknown>;
            throw new ThreadlineError(
              (typeof body.code === 'string' ? body.code : 'storage_unavailable') as ThreadlineError['code'],
              typeof body.message === 'string' ? body.message : `Capability read failed (${response.status})`,
            );
          }
          const report = value as CapabilityReport;
          if (requestGeneration === generation) {
            cached = report;
            cachedAt = Date.now();
            cachedProject = projectId;
            loaded = true;
          }
          return report;
        } catch (error) {
          if (requestGeneration === generation) loaded = false;
          throw error;
        } finally {
          if (inFlight?.generation === generation) inFlight = null;
        }
      })();
      inFlight = { projectId, generation, promise };
      return promise;
    },

    available(operationId) {
      if (!loaded || cached === null) return false;
      return index(cached).get(operationId)?.available === true;
    },

    entry(operationId) {
      return !loaded || cached === null ? null : index(cached).get(operationId) ?? null;
    },
  };

  return client;
}

/** A short reason for why an operation is unavailable, or null when it is. */
export function unavailabilityReason(capability: OperationCapability | null): string | null {
  if (capability === null) return 'capability information has not been loaded';
  if (capability.available) return null;
  if (!capability.implemented) return 'not implemented in this build';
  const detail = capability.unavailability;
  if (detail === undefined) return 'unavailable';
  // The message is the caller-facing explanation; the reason code is the stable label.
  return detail.message.length > 0 ? `${detail.reason}: ${detail.message}` : detail.reason;
}
