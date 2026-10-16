import { createCaptureWorker } from '../capture/worker.js';
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
import { createCaptureStore, type CaptureStore } from '../storage/capture.js';
import { createGraphAdmitter, type GraphAdmitter } from '../storage/graph-admission.js';
import { createGraphDeliverer, reconcileQuarantined } from '../storage/graph-delivery.js';
import { createProjectionService, type ProjectionService } from '../storage/projection.js';
import { createCheckpointService } from '../checkpoint/service.js';
import { ModelRequestJournal } from '../storage/model-requests.js';
import { createSourceService } from '../storage/sources.js';
import type { CheckpointService, ReplayService, SourceService } from '@threadline/shared';
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

/**
 * SQL-to-graph delivery, admission and projection, as one composed surface.
 */
/**
 * Reads tool executions that are still running or unknown.
 *
 * A running or unknown effect is carried into every checkpoint unchanged. It is
 * never cleared by a proposal and never resolved by assuming success.
 */
async function activeEffects(
  db: SqlDatabase,
  scope: { tenantId: string; projectId: string; taskId: string; agentSessionId?: string | null },
): Promise<{ execution_id: string; status: 'running' | 'unknown'; source_id: string }[]> {
  const rows = await db.withTenantTransaction(scope.tenantId, (tx) =>
    tx.rows<{ id: string; status: string; capture_event_id: string }>(
      `SELECT e.id,e.status,e.input_artifact_id AS capture_event_id
         FROM threadline.tool_executions e JOIN threadline.agent_sessions s
           ON s.tenant_id=e.tenant_id AND s.id=e.agent_session_id
        WHERE e.tenant_id=$1 AND e.project_id=$2 AND s.task_graph_id=$3
          AND e.status IN ('running','unknown') ORDER BY e.started_at ASC`,
      [scope.tenantId, scope.projectId, scope.taskId],
    ),
  );
  return rows.map((row) => ({
    execution_id: row.id,
    status: row.status === 'running' ? ('running' as const) : ('unknown' as const),
    source_id: row.capture_event_id,
  }));
}

export interface GraphProjectionSurface {
  readonly admitter: GraphAdmitter;
  readonly projection: ProjectionService;
  /** Builds the outbox deliverer that admits captures. */
  readonly deliverer: ReturnType<typeof createGraphDeliverer>;
  /** Reconciles a quarantined delivery against its receipt. */
  reconcile: typeof reconcileQuarantined;
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
  /**
   * The real Source service, or `null` before storage is ready.
   *
   * Agent B's routes and the `memory.retrieve` tool consume this. It is the same
   * object the tests exercise against real stores, not a test double, so the
   * permission and availability rules that run are the ones that were proven.
   */
  sources(): SourceService | null;
  /**
   * The checkpoint service, or `null` before storage is ready.
   *
   * One authority for both the model tools and any HTTP route, so there is a
   * single implementation of the merge, revision and publication rules rather
   * than a route-shaped variant of them.
   */
  checkpoints(): CheckpointService | null;
  /**
   * The typed `ReplayService`, or `null` before storage is ready.
   *
   * Explicitly declared so consumers call a real member rather than probing the
   * services object structurally.
   */
  replay(): ReplayService | null;
  /**
   * The durable capture boundary Agent B's runtime adapter captures model
   * evidence through. Typed and explicit, never an ad-hoc write.
   */
  captureStore(): CaptureStore;
  /** SQL-to-graph admission plus the projection that feeds replay. */
  graph(): GraphProjectionSurface | null;
  /** Builds the execution surface once stores are ready. Idempotent. */
  bootstrapExecution(): void;
  startCapture(tenantId: string): void;
  flushCapture(): Promise<void>;
  stopCapture(): Promise<void>;
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
  let capture: CaptureStore | null = null;
  let sources: SourceService | null = null;
  let checkpointService: CheckpointService | null = null;
  let replayService: ReplayService | null = null;
  let graphSurface: GraphProjectionSurface | null = null;
  let execution: ExecutionSurface | null = null;
  let worker: ReturnType<typeof createCaptureWorker> | null = null;

  const initialiseExecution = (): void => {
    artifacts = createArtifactWriter({
      db: deps.db,
      root: deps.config.storage.artifactsDirectory,
      clock: deps.clock,
      logger,
    });
    registry = createExecutionRegistry({ db: deps.db, clock: deps.clock, logger });
    capture = createCaptureStore({ db: deps.db, artifacts, clock: deps.clock, logger });
    sources = createSourceService({
      db: deps.db,
      artifacts,
      logger: (entry) =>
        logger.log({
          level: 'warn',
          message: entry.message,
          ...(entry.fields === undefined
            ? {}
            : { fields: Object.fromEntries(Object.entries(entry.fields).map(([k, v]) => [k, String(v)])) }),
        }),
    });
    const admitter = createGraphAdmitter(deps.graphs);
    const projection = createProjectionService(deps.db, deps.graphs);
    replayService = projection.service;
    graphSurface = {
      admitter,
      projection,
      deliverer: createGraphDeliverer({
        db: deps.db,
        admitter,
        graphKeyFor: async (tenantId, projectId) => {
          const rows = await deps.db.withTenantTransaction(tenantId, (tx) =>
            tx.rows<{ graph_key: string }>(
              `SELECT graph_key FROM threadline.projects WHERE tenant_id = $1 AND id = $2`,
              [tenantId, projectId],
            ),
          );
          const key = rows[0]?.graph_key;
          if (key === undefined) {
            throw new ThreadlineError('not_found', 'No project exists for that id.');
          }
          return key;
        },
        logger,
      }),
      reconcile: reconcileQuarantined,
    };
    checkpointService = createCheckpointService({
      db: deps.db,
      artifacts,
      graphs: deps.graphs,
      clock: deps.clock,
      // Trusted authority is resolved here, once, so neither a model nor a route
      // can supply a task, run, session, revision or Source identity.
      authorityFor: async (scope) => {
        const rows = await deps.db.withTenantTransaction(scope.tenantId, tx => tx.rows<{
          graph_key: string; graph_epoch:string; task_graph_id: string; run_id: string; session_id: string;
        }>(`SELECT pj.graph_key,pj.graph_epoch,s.task_graph_id,s.run_id,s.id AS session_id
            FROM threadline.agent_sessions s
            JOIN threadline.projects pj ON pj.tenant_id=s.tenant_id AND pj.id=s.project_id
            JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id AND r.project_id=s.project_id
            JOIN threadline.project_memberships pm ON pm.tenant_id=s.tenant_id AND pm.project_id=s.project_id
              AND pm.user_id=$4 AND pm.status='active'
            JOIN threadline.tenant_memberships tm ON tm.tenant_id=s.tenant_id AND tm.user_id=$4 AND tm.status='active'
            JOIN threadline.users u ON u.id=$4 AND u.status='active'
            WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.task_graph_id=$3 AND r.initiated_by=$4
              AND ($5::uuid IS NULL OR s.run_id=$5) AND ($6::uuid IS NULL OR s.id=$6)
              AND s.run_id=(SELECT recent.run_id FROM threadline.agent_sessions recent
                WHERE recent.tenant_id=s.tenant_id AND recent.project_id=s.project_id AND recent.task_graph_id=s.task_graph_id
                ORDER BY recent.created_at DESC,recent.id LIMIT 1)
            ORDER BY s.created_at DESC LIMIT 1`,
          [scope.tenantId,scope.projectId,scope.taskId,scope.userId,scope.runId ?? null,scope.agentSessionId ?? null]));
        const row=rows[0];
        if (!row) return {ok:false,reason:'No authorized run binding exists.'};
        const task = await deps.graphs.graph(row.graph_key).roQuery<{
          requirement_revision:number; current_revision:number; graph_epoch:string; fence:number;
        }>(`MATCH (p:ProjectRoot {id:$project_id}), (t:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState)
            MATCH (p)-[:HAS_RUN]->(r:Run {id:$run_id}), (a:AgentSession {sql_id:$session_id,run_id:$run_id})
            WHERE p.graph_epoch=$graph_epoch AND s.revision=t.current_revision AND s.status=t.current_status
              AND (t.current_status<>'running' OR t.owner_session_id=a.id)
            RETURN t.requirement_revision AS requirement_revision,t.current_revision AS current_revision,
              p.graph_epoch AS graph_epoch,coalesce(t.fence,0) AS fence`,
          {params:{project_id:scope.projectId,task_id:row.task_graph_id,graph_epoch:row.graph_epoch,run_id:row.run_id,session_id:row.session_id}});
        const authority=task.data?.[0];
        if (task.data?.length!==1 || !authority?.graph_epoch)
          throw new ThreadlineError('authority_unavailable','The task has no unique current graph authority.');
        return {ok:true,authority:{taskId:row.task_graph_id,runId:row.run_id,
          graphEpoch:authority.graph_epoch,requirementRevision:String(authority.requirement_revision),
          taskRevision:String(authority.current_revision),fence:authority.fence,
          candidateDigest:null,environmentDigest:null,producerSessionId:row.session_id,
          producerKind:'service' as const,visibility:'project' as const},
          unresolvedEffects:await activeEffects(deps.db,{...scope,agentSessionId:row.session_id}),
          episodeSourceIds:[],pendingQuestionId:null};
      },
      logger,
    });
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
      capture,
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

    startCapture(tenantId) {
      if (!graphSurface) throw new ThreadlineError('storage_unavailable', 'Capture graph is unavailable.');
      worker ??= createCaptureWorker({ db: deps.db, tenantId, graph: graphSurface, clock: deps.clock, logger,
        afterDrain: async () => {
          const scopes=await deps.db.withTenantTransaction(tenantId,tx=>tx.rows<{
            project_id:string;task_graph_id:string;initiated_by:string;run_id:string;session_id:string;
          }>(`SELECT DISTINCT ON (s.project_id,s.task_graph_id) s.project_id,s.task_graph_id,r.initiated_by,s.run_id,s.id AS session_id
              FROM threadline.agent_sessions s JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
              WHERE s.tenant_id=$1 ORDER BY s.project_id,s.task_graph_id,s.created_at DESC LIMIT 100`,[tenantId]));
          for(const scope of scopes) {
            try { await checkpointService?.evaluateTrigger({tenantId,projectId:scope.project_id,taskId:scope.task_graph_id,
              userId:scope.initiated_by,runId:scope.run_id,agentSessionId:scope.session_id},'uncheckpointed_fallback'); }
            catch { logger.log({level:'warn',message:'Checkpoint reconciliation remains pending.'}); }
          }
        } });
      worker.start();
    },
    async flushCapture() { if (!worker) throw new ThreadlineError('storage_unavailable', 'Capture worker is unavailable.'); await worker.runOnce(); },
    async stopCapture() { await worker?.stop(); },

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

    sources(): SourceService | null {
      return sources;
    },

    checkpoints(): CheckpointService | null {
      return checkpointService;
    },

    replay(): ReplayService | null {
      return replayService;
    },

    captureStore(): CaptureStore {
      if (capture === null) {
        throw new ThreadlineError('storage_unavailable', 'Capture storage is unavailable.');
      }
      return capture;
    },

    graph(): GraphProjectionSurface | null {
      return graphSurface;
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