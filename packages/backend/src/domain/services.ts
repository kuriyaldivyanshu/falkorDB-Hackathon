import { ThreadlineError } from '@threadline/shared';

import type { BackendConfig } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';

// Re-exported so sibling domain modules name one authority for these shapes.
export type { AuthenticatedPrincipal } from '../storage/identity.js';
export type { ProjectScope } from './admission.js';
import {
  admitGoal,
  readAdmissionByRequestId,
  readCurrentAuthority,
  reconcilePendingAdmissions,
  type ProjectScope,
} from './admission.js';
import {
  createExecutionService,
  DEVELOPMENT_LIMITS,
  type ExecutionDeps,
  type StartRunDeps,
  type StartRunRequest,
} from './execution.js';
import { createArtifactWriter, type ArtifactWriter } from '../storage/artifacts.js';
import { createExecutionRegistry, type ExecutionRegistry } from '../storage/execution.js';
import { ModelRequestJournal } from '../storage/model-requests.js';
import type { ClaimState, RunContext, TurnGuard } from '../runtime/contracts.js';
import type { CancelRunOutcome, RunInspectView, RunStartOutcome } from '@threadline/shared';
import type { GraphStore } from '../storage/graph.js';
import type { SchemaStatus } from '../storage/migrate.js';
import type { ProjectMembershipView } from '@threadline/shared';
import type { ActivitySink } from '../runtime/contracts.js';
import type { SqlDatabase } from '../storage/pg.js';
import {
  authenticateSession,
  loadProjectScopeByTenant,
  type AuthenticatedPrincipal,
} from '../storage/identity.js';
import { listProjectsForUser, revokeSession as revokeSessionRow } from '../storage/identity.js';

/**
 * The authenticated surface the API layer uses.
 *
 * Handlers never touch `pg` or FalkorDB directly. They receive the
 * authenticated principal plus these narrow operations, which keeps
 * authorization decisions in one place instead of per route.
 */

export interface StorageReadiness {
  readonly configured: boolean;
  readonly sqlReady: boolean;
  readonly graphReady: boolean;
  readonly schema: SchemaStatus;
  readonly lastError: string | null;
}

/**
 * The execution surface exposed to HTTP handlers and, through ports, to the
 * loop. Everything here can refuse; nothing here bypasses a check.
 */
export interface ExecutionSurface {
  readonly limits: {
    readonly maxAttempts: number;
    readonly maxToolCalls: number;
    readonly maxTotalTokens: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly deadlineMs: number;
    readonly claimLeaseMs: number;
    readonly claimHeartbeatMs: number;
  };
  readonly registry: ExecutionRegistry;
  readonly journal: ModelRequestJournal;
  readonly artifacts: ArtifactWriter;
  start(
    deps: StartRunDeps,
    principal: AuthenticatedPrincipal,
    request: StartRunRequest,
    correlationId: string,
  ): Promise<RunStartOutcome>;
  heartbeat(principal: AuthenticatedPrincipal, runId: string): Promise<{ leaseExpiresAt: string; fence: number }>;
  cancel(principal: AuthenticatedPrincipal, runId: string, reason: string): Promise<CancelRunOutcome>;
  inspect(principal: AuthenticatedPrincipal, runId: string): Promise<RunInspectView>;
  /** Open run ids for a project, newest first. Read-only. */
  listActiveRuns(tenantId: string, projectId: string): Promise<readonly string[]>;
  turnGuard(scope: RunContext, claim: ClaimState): TurnGuard;
}

export interface ApplicationServices {
  /** Live readiness, recomputed on each read. */
  readiness(): StorageReadiness;
  /** Resolves a bearer token to a live principal, or throws `unauthorized`. */
  authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedPrincipal>;
  /** Authorised read of current goal/constraint/task authority. */
  authority(
    principal: AuthenticatedPrincipal,
    projectId: string,
  ): Promise<Awaited<ReturnType<typeof readCurrentAuthority>>>;
  /** Authorised, idempotent goal admission. */
  admitGoal(
    principal: AuthenticatedPrincipal,
    input: Parameters<typeof admitGoal>[2],
  ): Promise<Awaited<ReturnType<typeof admitGoal>>>;
  /** Reads the committed outcome recorded for one request id. */
  admissionByRequestId(
    principal: AuthenticatedPrincipal,
    projectId: string,
    requestId: string,
  ): Promise<Awaited<ReturnType<typeof admitGoal>>>;
  /** Active project memberships for the principal. */
  projectsFor(principal: AuthenticatedPrincipal): Promise<ProjectMembershipView[]>;
  /** Revokes a session; a revoked session can never renew a task lease. */
  revokeSession(principal: AuthenticatedPrincipal, sessionId: string): Promise<boolean>;
  /**
   * Execution authority: run admission, claims, budget and the loop's ports.
   * Created only when storage is ready; absent storage means no run can start.
   */
  execution(): ExecutionSurface | null;
  /** Builds the execution surface once stores are ready. Idempotent. */
  bootstrapExecution(): void;
  /** Startup reconciliation of inbox rows whose graph outcome is unknown. */
  reconcile(tenantId: string, projectId: string): Promise<{ resolved: number; unresolved: number; quarantined: number }>;
  projectScope(tenantId: string, projectId: string): Promise<ProjectScope>;
  refreshReadiness(): Promise<StorageReadiness>;
}

export interface ServiceDeps {
  readonly config: BackendConfig;
  readonly db: SqlDatabase;
  readonly graphs: GraphStore;
  readonly clock: () => Date;
  readonly logger?: Logger;
  readonly schema: SchemaStatus;
  readonly activity?: ActivitySink;
}

export function createApplicationServices(deps: ServiceDeps): ApplicationServices {
  const logger: Logger = deps.logger ?? silentLogger;
  const state: { sqlReady: boolean; graphReady: boolean; lastError: string | null } = {
    sqlReady: false,
    graphReady: false,
    lastError: null,
  };

  const readiness = (): StorageReadiness => ({
    configured: deps.config.storage.mode === 'required',
    sqlReady: state.sqlReady,
    graphReady: state.graphReady,
    schema: deps.schema,
    lastError: state.lastError,
  });

  const requireReady = async (): Promise<void> => {
    await refreshReadiness();
    if (deps.config.storage.mode !== 'required') {
      throw new ThreadlineError(
        'storage_unavailable',
        'Durable operations need THREADLINE_STORAGE_MODE=required and reachable stores.',
      );
    }
    if (!state.sqlReady || !state.graphReady) {
      throw new ThreadlineError('storage_unavailable', 'A required data store is not ready.', {
        sqlReady: state.sqlReady,
        graphReady: state.graphReady,
      });
    }
  };

  const serviceDeps = { db: deps.db, graphs: deps.graphs, clock: deps.clock, logger };

  // Built once the stores are ready; a run cannot exist before that.
  let artifacts: ArtifactWriter | null = null;
  let registry: ExecutionRegistry | null = null;
  let journal: ModelRequestJournal | null = null;
  let execution: ExecutionSurface | null = null;

  const initialiseExecution = (): void => {
    artifacts = createArtifactWriter({
      db: deps.db,
      root: deps.config.storage.artifactsDirectory,
      clock: deps.clock,
      logger,
    });
    registry = createExecutionRegistry({ db: deps.db, clock: deps.clock, logger });
    journal = new ModelRequestJournal({
      db: deps.db,
      artifacts,
      clock: deps.clock,
      logger,
    });
    const executionDeps: ExecutionDeps = {
      db: deps.db,
      graphs: deps.graphs,
      registry,
      journal,
      artifacts,
      limits: DEVELOPMENT_LIMITS,
      clock: deps.clock,
      logger,
      activity: deps.activity,
    };
    const service = createExecutionService(executionDeps);
    execution = {
      limits: DEVELOPMENT_LIMITS,
      registry,
      journal,
      artifacts,
      async start(startDeps, principal, request, correlationId): Promise<RunStartOutcome> {
        return service.start(startDeps, principal, request, correlationId);
      },
      async heartbeat(principal, runId): Promise<{ leaseExpiresAt: string; fence: number }> {
        return service.heartbeat(principal, runId);
      },
      async cancel(principal, runId, reason): Promise<CancelRunOutcome> {
        return service.cancel(principal, runId, reason);
      },
      async inspect(principal, runId): Promise<RunInspectView> {
        return service.inspect(principal, runId);
      },
      async listActiveRuns(tenantId, projectId) {
        return service.listActiveRuns(tenantId, projectId);
      },
      turnGuard(scope: RunContext, claim: ClaimState): TurnGuard {
        return service.turnGuard(scope, claim);
      },
    };
  };


  const refreshReadiness = async (): Promise<StorageReadiness> => {
      state.lastError = null;
      try {
        await deps.db.ping();
        state.sqlReady = true;
      } catch (error) {
        state.sqlReady = false;
        state.lastError = describe(error);
      }
      try {
        await deps.graphs.ping();
        state.graphReady = true;
      } catch (error) {
        state.graphReady = false;
        state.lastError = describe(error);
      }
      return readiness();
    };

  const service: ApplicationServices = {
    readiness,

    bootstrapExecution(): void {
      if (execution === null) {
        initialiseExecution();
      }
    },

    async authenticate(header: string | undefined): Promise<AuthenticatedPrincipal> {
      const token = readBearerToken(header);
      return authenticateSession(deps.db, token, deps.clock(), deps.config.storage.local.idleExpiryMs);
    },

    async authority(principal, projectId) {
      await requireReady();
      return readCurrentAuthority(serviceDeps, principal, projectId);
    },

    async admitGoal(principal, input) {
      await requireReady();
      return admitGoal(serviceDeps, principal, input);
    },

    async reconcile(tenantId, projectId) {
      await requireReady();
      const outcome = await reconcilePendingAdmissions(
        serviceDeps,
        tenantId,
        projectId,
        deps.clock(),
      );
      logger.log({
        level: 'info',
        message: 'Reconciled pending admissions.',
        fields: { ...outcome },
      });
      return outcome;
    },

    async admissionByRequestId(principal, projectId, requestId) {
      await requireReady();
      return readAdmissionByRequestId(serviceDeps, principal, projectId, requestId);
    },

    async projectsFor(principal) {
      await requireReady();
      return listProjectsForUser(deps.db, principal);
    },

    async revokeSession(principal, sessionId) {
      await requireReady();
      return revokeSessionRow(deps.db, principal.tenantId, sessionId, deps.clock());
    },

    execution(): ExecutionSurface | null {
      execution ??= null;
      return execution;
    },

    async projectScope(tenantId, projectId) {
      return loadProjectScopeByTenant(deps.db,tenantId,projectId);
    },

    refreshReadiness,
  };

  return service;
}

/**
 * Extracts a bearer token. A token in a query string, a cookie or any other
 * channel is refused: it is only ever read from the Authorization header.
 */
export function readBearerToken(header: string | undefined): string {
  if (header === undefined) {
    throw new ThreadlineError('unauthorized', 'An Authorization header is required.');
  }
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length < 32) {
    throw new ThreadlineError(
      'unauthorized',
      'Expected an Authorization header of the form "Bearer <local session token>".',
    );
  }
  return token;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}