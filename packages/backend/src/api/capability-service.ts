import {
  OPERATION_CATALOGUE,
  OPERATION_ROUTES,
  CAPABILITY_SCHEMA_VERSION,
  CAPABILITY_PROTOCOL_VERSION,
  type CapabilityReport,
  type OperationCapability,
  type OperationId,
  type RequiredLifecycle,
  type UnavailabilityDetail,
} from '@threadline/shared';

import type { SqlDatabase } from '../storage/pg.js';

/**
 * Capability metadata resolved for one authenticated caller.
 *
 * Every fact here is read inside the caller's tenant fence and inside their own
 * project scope. Nothing is read across tenants, and nothing secret is read at
 * all -- no credential table is touched.
 *
 * The report is deliberately a *report*, not an authorization decision. It is
 * safe to cache briefly for display; execution must always use fresh guards.
 */

export interface CapabilityServiceDeps {
  readonly db: SqlDatabase;
}

export interface CapabilityScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly projectId: string | null;
}

export interface CapabilityObservations {
  readonly authenticated: boolean;
  readonly isProjectMember: boolean;
  readonly hasAdmittedTask: boolean;
  readonly hasConfiguredProfile: boolean;
  readonly hasActiveRun: boolean;
  readonly unresolvedEffects: number;
}

/** The same facts, mutable while the report is being assembled from real rows. */
interface MutableObservations {
  authenticated: boolean;
  isProjectMember: boolean;
  hasAdmittedTask: boolean;
  hasConfiguredProfile: boolean;
  hasActiveRun: boolean;
  unresolvedEffects: number;
}

export interface CapabilityService {
  report(scope: CapabilityScope): Promise<CapabilityReport>;
}

export function createCapabilityService(deps: CapabilityServiceDeps): CapabilityService {
  return {
    async report(scope: CapabilityScope): Promise<CapabilityReport> {
      const observations: MutableObservations = {
        authenticated: scope.userId.length > 0,
        isProjectMember: false,
        hasAdmittedTask: false,
        hasConfiguredProfile: false,
        hasActiveRun: false,
        unresolvedEffects: 0,
      };

      if (scope.projectId !== null && observations.authenticated) {
        const rows = await deps.db.withTenantTransaction(scope.tenantId, (tx) =>
          tx.rows<{
            is_member: string;
            has_profile: string;
            has_active_run: string;
            unresolved_effects: string;
          }>(
            `SELECT
               EXISTS (SELECT 1 FROM threadline.project_memberships
                        WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3
                          AND status = 'active')::text AS is_member,
               EXISTS (SELECT 1 FROM threadline.provider_profiles
                        WHERE tenant_id = $1 AND project_id = $2 AND owner_user_id = $3)::text AS has_profile,
               EXISTS (SELECT 1 FROM threadline.runs
                        WHERE tenant_id = $1 AND project_id = $2 AND initiated_by = $3
                          AND finished_at IS NULL)::text AS has_active_run,
               ((SELECT count(*) FROM threadline.tool_executions t
                  WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.status IN ('running','unknown')) +
                (SELECT count(*) FROM threadline.model_requests m WHERE m.tenant_id=$1 AND m.project_id=$2 AND
                  (m.status IN ('prepared','dispatched','streaming','unknown') OR EXISTS(
                    SELECT 1 FROM threadline.usage_ledger u WHERE u.tenant_id=m.tenant_id AND u.project_id=m.project_id
                      AND u.source_key=m.usage_source_key AND u.precision='unknown'))))::text AS unresolved_effects`,
            [scope.tenantId, scope.projectId, scope.userId],
          ),
        );
        const row = rows[0];
        observations.isProjectMember = row?.is_member === 'true';
        observations.hasConfiguredProfile = row?.has_profile === 'true';
        observations.hasActiveRun = row?.has_active_run === 'true';
        observations.unresolvedEffects = Number(row?.unresolved_effects ?? '0');
        // An admitted task is a real goal in the graph-backed authority, which
        // SQL records as an admitted inbox row for this project.
        const admitted = await deps.db.withTenantTransaction(scope.tenantId, (tx) =>
          tx.rows<{ n: string }>(
            `SELECT count(*)::text AS n FROM threadline.command_inbox
              WHERE tenant_id = $1 AND project_id = $2 AND initiated_by = $3
                AND status = 'committed'`,
            [scope.tenantId, scope.projectId, scope.userId],
          ),
        );
        observations.hasAdmittedTask = Number(admitted[0]?.n ?? '0') > 0;
      }

      const operations: OperationCapability[] = OPERATION_CATALOGUE.map((entry) => {
        const path = OPERATION_ROUTES[entry.operationId];
        const implemented = path !== null;

        const unavailability = availability(entry.operationId, entry.requires, implemented, observations);

        return {
          operationId: entry.operationId,
          implemented,
          available: implemented && unavailability === null,
          scope: entry.scope,
          effect: entry.effect,
          ...(implemented ? { method: entry.method, path: path ?? undefined } : {}),
          ...(entry.requires.length > 0 ? { requires: entry.requires } : {}),
          ...(unavailability === null ? {} : { unavailability }),
          ...(entry.limits === undefined ? {} : { limits: entry.limits }),
          milestone: entry.milestone,
        };
      });

      return {
        schemaVersion: CAPABILITY_SCHEMA_VERSION,
        protocolVersion: CAPABILITY_PROTOCOL_VERSION,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        operations,
        observations,
      };
    },
  };
}

/**
 * Decides why an operation is unavailable, or that it is.
 *
 * Ordered from most specific to least, because the most specific reason is the
 * one that tells the caller what to actually do.
 */
function availability(
  operationId: OperationId,
  requires: readonly RequiredLifecycle[],
  implemented: boolean,
  observations: CapabilityObservations,
): UnavailabilityDetail | null {
  if (!implemented) {
    return {
      reason: 'not_implemented',
      resolvesWith: null,
      message: 'This operation is catalogued but has no transport binding in this build.',
    };
  }

  const needs = (state: RequiredLifecycle): boolean => requires.includes(state);

  if (needs('authenticated') && !observations.authenticated) {
    return {
      reason: 'unauthenticated',
      resolvesWith: 'authenticated',
      message: 'Sign in to the local owner before using this.',
    };
  }

  // A project-scoped operation is unavailable to a non-member, and the report
  // says so without revealing anything about that project.
  if ((needs('project_member') || needs('project_admitted')) && !observations.isProjectMember) {
    return {
      reason: 'not_a_project_member',
      resolvesWith: 'project_member',
      message: needs('project_admitted')
        ? 'This operation needs an accepted task in a project you belong to.'
        : 'Join this project before using this operation.',
    };
  }

  if (needs('project_admitted') && !observations.hasAdmittedTask) {
    return {
      reason: 'no_admitted_task',
      resolvesWith: 'project_admitted',
      message: 'Accept a task in this project first.',
    };
  }

  if (needs('profile_configured') && !observations.hasConfiguredProfile) {
    return {
      reason: 'no_configured_profile',
      resolvesWith: 'profile_configured',
      message: 'Select or configure a provider profile before preparing or starting a run.',
    };
  }

  if (['run.start','run.prepare','model.select','input.submit'].includes(operationId) && observations.hasActiveRun) {
    return {
      reason: 'active_run_conflict',
      resolvesWith: null,
      message: 'A run is already active for this project. Inspect or cancel it before starting another.',
    };
  }

  if (needs('run_active') && !observations.hasActiveRun) {
    return {
      reason: 'no_active_run',
      resolvesWith: 'run_active',
      message: 'No active run resolves this operation.',
    };
  }

  // Unresolved effects do not block inspection, but they do block anything that
  // would begin new dependent work.
  if (
    observations.unresolvedEffects > 0 &&
    (operationId === 'context.compact' || operationId === 'run.start')
  ) {
    return {
      reason: 'unresolved_effects',
      resolvesWith: null,
      message: `Reconcile ${observations.unresolvedEffects} unresolved effect(s) before this operation.`,
    };
  }

  return null;
}
