import {
  BackendStateError,
  PROTOCOL_VERSION,
  ThreadlineError,
  newCommandId,
  newEventId,
  newEchoId,
  type BackendState,
  type CommandId,

  type ComponentStatus,
  type EchoId,
  type EventId,
  type HealthReport,
} from '@threadline/shared';

import { createHttpServer, type BackendAddress, type HttpServerHandle } from './api/server.js';
import type { BackendConfig } from './config.js';
import { createCommandDispatcher, type CommandDispatcher } from './domain/dispatcher.js';
import { createDevelopmentRegistry } from './domain/development.js';
import { createApplicationServices, type ApplicationServices } from './domain/services.js';
import { createEventPublisher, type EventPublisher } from './events/publisher.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { createGraphStore, startGraphStore, type GraphStore } from './storage/graph.js';
import { bootstrapLocalOwner, type LocalBootstrap } from './storage/identity.js';
import { ensureCoreSchema, type SchemaStatus } from './storage/migrate.js';
import { sha256Hex } from './storage/digest.js';
import { assertTenantFenceEnforceable, createSqlDatabase, type SqlDatabase } from './storage/pg.js';
import { ENSURE_ACTOR_CYPHER } from './storage/graph-queries.js';
import { THREADLINE_BACKEND_VERSION } from './version.js';

export { THREADLINE_BACKEND_VERSION } from './version.js';
export { CONFIG_ENV_KEYS, DEFAULT_LIMITS, describeConfig, parseBackendConfig } from './config.js';
export type { BackendConfig, BackendLimits, BackendConfigSummary, ConfigSource } from './config.js';
export { ROUTES } from './api/routes.js';
export type { BackendAddress } from './api/server.js';
export { createEventPublisher } from './events/publisher.js';
export type { EventListener, EventPublisher, EventSubscription } from './events/publisher.js';
export { createCommandDispatcher } from './domain/dispatcher.js';
export type { CommandContext, CommandDispatcher, CommandRegistry } from './domain/dispatcher.js';
export { createDevelopmentRegistry } from './domain/development.js';
export { parseCommandRequest } from './domain/validate.js';
export { readBearerToken } from './domain/services.js';
export type { ApplicationServices, StorageReadiness } from './domain/services.js';
export { admitGoal, readCurrentAuthority, reconcilePendingAdmissions } from './domain/admission.js';
export type { ProjectScope } from './domain/admission.js';
export { assertTenantFenceEnforceable, createSqlDatabase } from './storage/pg.js';
export type { SqlDatabase, TxClient } from './storage/pg.js';
export { createGraphStore, startGraphStore } from './storage/graph.js';
export type { GraphStore, GraphSchemaReport } from './storage/graph.js';
export {
  ensureCoreSchema,
  readSchemaStatus,
  coreBootstrapChecksum,
} from './storage/migrate.js';
export { CORE_BOOTSTRAP_VERSION } from './storage/sql.js';
export type { SchemaStatus } from './storage/migrate.js';
export {
  bootstrapLocalOwner,
  authenticateSession,
  revokeSession,
  requireProjectMembership,
  loadProjectScopeByTenant,
  deriveGraphKey,
  SESSION_TOKEN_FILENAME,
} from './storage/identity.js';
export type { AuthenticatedPrincipal, LocalBootstrap } from './storage/identity.js';
export {
  findInbox,
  listPendingAdmissions,
  recordAdmissionIntent,
  settleCommitted,
} from './storage/inbox.js';
export type { InboxRow } from './storage/inbox.js';
export { canonicalDigest, canonicalize, sha256Hex } from './storage/digest.js';

const M00_GUARANTEE_NOTE =
  'M00 development scaffold: state is process-local, nothing is persisted, events are not replayable and no task can be admitted.';

/** Components this milestone still does not contain, reported rather than implied. */
const NOT_IMPLEMENTED: readonly ComponentStatus[] = [
  {
    name: 'provider',
    present: false,
    ready: false,
    detail: 'No model provider is configured or contacted at this milestone; provider turns arrive in M02.',
  },
  {
    name: 'checker',
    present: false,
    ready: false,
    detail: 'No protected checker exists at this milestone; completion cannot be accepted before M08.',
  },
];

export interface BackendDeps {
  readonly config: BackendConfig;
  readonly clock?: () => Date;
  /** Injected by tests; production wires the real stores during start(). */
  readonly database?: SqlDatabase;
  readonly graphStore?: GraphStore;
  readonly allocateCommandId?: () => CommandId;
  readonly allocateEventId?: () => EventId;
  readonly allocateEchoId?: () => EchoId;
  readonly logger?: Logger;
}

export interface Backend {
  readonly version: string;
  readonly state: BackendState;
  readonly address: BackendAddress | null;
  readonly events: EventPublisher;
  start(): Promise<BackendAddress>;
  stop(): Promise<void>;
  health(): HealthReport;
  /**
   * Executes one command. The optional `authorization` is the request's raw
   * header; it travels with the command context rather than through shared
   * state, so concurrent requests cannot observe each other's credential.
   */
  dispatch: CommandDispatcher;
  /** Durable services. Throws `storage_unavailable` when storage is unconfigured. */
  readonly services: ApplicationServices;
  /** Local bootstrap identities, available once storage has started. */
  readonly localBootstrap: LocalBootstrap | null;
}

/**
 * Composition entry point.
 *
 * Construction has no side effects: no socket is bound, no directory is
 * created and no environment is read here. Callers pass validated
 * configuration and drive the lifecycle explicitly.
 */
export function createBackend(deps: BackendDeps): Backend {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());
  const allocateEventId = deps.allocateEventId ?? newEventId;

  const publisher = createEventPublisher({
    maxListeners: deps.config.limits.maxEventListeners,
    clock,
    generateEventId: allocateEventId,
    logger,
  });

  let state: BackendState = 'created';
  let stateSince = clock();
  let startedAt: number | null = null;
  let http: HttpServerHandle | null = null;
  let startInFlight: Promise<BackendAddress> | null = null;
  let stopInFlight: Promise<void> | null = null;
  let database: SqlDatabase | null = deps.database ?? null;
  let migrationDatabase: SqlDatabase | null = null;
  let graphStore: GraphStore | null = deps.graphStore ?? null;
  let schemaStatus: SchemaStatus = { state: 'unconfigured' };
  let localBootstrap: LocalBootstrap | null = null;

  const setState = (next: BackendState, detail: string): void => {
    state = next;
    stateSince = clock();
    if (publisher.closed) {
      return;
    }
    try {
      publisher.publish('backend.status', {
        state: next,
        since: stateSince.toISOString(),
        detail,
      });
    } catch (error) {
      // A status transition must never fail the transition itself.
      logger.log({
        level: 'warn',
        message: 'Could not publish backend status event.',
        fields: { errorName: error instanceof Error ? error.name : typeof error, state: next },
      });
    }
  };

  const isAccepting = (): boolean => state === 'ready';

  /**
   * `state` is reassigned by setState. Reading it through a call keeps the
   * compiler from carrying the `created` narrowing from the guard below into
   * the asynchronous body of start(), where the value has already changed.
   */
  const currentState = (): BackendState => state;

  const requireServices = (): ApplicationServices => {
    if (services === null) {
      throw new ThreadlineError(
        'storage_unavailable',
        'Durable services are not available until storage has started.',
      );
    }
    return services;
  };

  const registry = createDevelopmentRegistry({
    publishAccepted: (payload) => {
      publisher.publish('development.echo.accepted', payload);
    },
    newEchoId: deps.allocateEchoId ?? newEchoId,
    acceptGoal: async (input, context) => {
      const principal = await requireServices().authenticate(context.authorization);
      return requireServices().admitGoal(principal, input);
    },
  });

  const dispatch: CommandDispatcher = createCommandDispatcher({
    registry,
    limits: deps.config.limits,
    isAccepting,
    clock,
    allocateCommandId: deps.allocateCommandId ?? newCommandId,
    logger,
  });

  let services: ApplicationServices | null = null;

  const openStorage = async (): Promise<void> => {
    if (deps.config.storage.mode !== 'required') {
      logger.log({
        level: 'info',
        message: 'Storage is unconfigured; durable admission is disabled.',
      });
      return;
    }
    database ??= createSqlDatabase({ config: deps.config.storage.postgres, logger });
    if (migrationDatabase === null && deps.config.storage.postgres.migrationUser.length > 0) {
      migrationDatabase = createSqlDatabase({
        config: { ...deps.config.storage.postgres, user: deps.config.storage.postgres.migrationUser, password: deps.config.storage.postgres.migrationPassword },
        logger,
      });
    }
    graphStore ??= createGraphStore({ config: deps.config.storage.falkordb, logger });
    await startGraphStore(graphStore);

    const report = await ensureCoreSchema({
      db: database,
      migrationDb: migrationDatabase ?? database,
      applicationRole: deps.config.storage.postgres.applicationRole,
      logger,
    });
    schemaStatus = report.status;

    await assertTenantFenceEnforceable(database);

    const bootstrap = await bootstrapLocalOwner({
      db: database,
      local: deps.config.storage.local,
      dataDirectory: deps.config.dataDirectory,
      clock,
      logger,
    });
    localBootstrap = bootstrap;

    await ensureProjectRoot(graphStore, bootstrap, clock, logger);
    services = createApplicationServices({
      config: deps.config,
      db: database,
      graphs: graphStore,
      clock,
      logger,
      schema: schemaStatus,
    });
    await services.refreshReadiness();

    const reconciled = await services.reconcile(bootstrap.tenantId, bootstrap.projectId);
    if (reconciled.unresolved > 0 || reconciled.quarantined > 0)
      throw new ThreadlineError('authority_unavailable','Pending admissions need reconciliation before startup can complete.');
    logger.log({
      level: 'info',
      message: 'Storage ready.',
      fields: { graphKey: bootstrap.graphKey, ...reconciled },
    });
  };

  const closeStorage = async (): Promise<void> => {
    services = null;
    const stores = [graphStore, database, migrationDatabase];
    graphStore = null;
    database = null;
    migrationDatabase = null;
    const closed = await Promise.allSettled(stores.map(store => store?.close()));
    if (closed.some(result => result.status === 'rejected')) {
      throw new ThreadlineError('storage_unavailable', 'One or more storage connections could not close cleanly.');
    }
  };

  const health = (): HealthReport => {
    const listening = http?.listening ?? false;
    const components: readonly ComponentStatus[] = [
      {
        name: 'api',
        present: true,
        ready: listening,
        detail: listening
          ? 'Local HTTP transport is bound and serving health, commands and events.'
          : 'Local HTTP transport exists in this process but is not bound to a port.',
      },
      {
        name: 'eventPublisher',
        present: true,
        ready: !publisher.closed,
        detail: publisher.closed
          ? 'Event publisher is closed; no further events will be delivered.'
          : 'Process-local events with bounded listeners; no replay and no persistence.',
      },
      ...storeComponents(),
      ...NOT_IMPLEMENTED,
    ];
    const uptimeMs = startedAt === null ? 0 : Math.max(0, clock().getTime() - startedAt);
    const storageReady = services?.readiness().sqlReady === true && services.readiness().graphReady;
    return {
      protocolVersion: PROTOCOL_VERSION,
      backendVersion: THREADLINE_BACKEND_VERSION,
      state,
      uptimeMs,
      components,
      guarantees: {
        durable: storageReady,
        replayable: false,
        multiSession: false,
        note: storageReady
          ? 'M01: goal, requirement, criterion and source records are durable in PostgreSQL and FalkorDB. Task execution, model turns and protected completion are not implemented yet.'
          : deps.config.storage.mode === 'required' ? 'M01 stores are not ready; durable admission is unavailable. Previously committed data remains in its stores.' : M00_GUARANTEE_NOTE,
      },
    };
  };

  /** Real per-store component status. Presence and readiness are separate facts. */
  const storeComponents = (): readonly ComponentStatus[] => {
    const configured = deps.config.storage.mode === 'required';
    if (!configured) {
      return [
        {
          name: 'postgres',
          present: false,
          ready: false,
          detail: 'Storage is unconfigured; set THREADLINE_STORAGE_MODE=required to enable durable admission.',
        },
        {
          name: 'falkordb',
          present: false,
          ready: false,
          detail: 'Storage is unconfigured; set THREADLINE_STORAGE_MODE=required to enable durable admission.',
        },
      ];
    }
    const readiness = services?.readiness();
    const schema = schemaStatus.state;
    return [
      {
        name: 'postgres',
        present: true,
        ready: readiness?.sqlReady === true,
        detail:
          schema === 'applied'
            ? `Core schema version ${String(schemaStatus.state === 'applied' ? schemaStatus.version : 0)} applied; tenant fence enforced by row-level security.`
            : 'Core schema is not applied yet.',
      },
      {
        name: 'falkordb',
        present: true,
        ready: readiness?.graphReady === true,
        detail:
          schema === 'applied'
            ? `Graph authority on the project epoch with unique Entity/Event/RequestReceipt constraints enforced.`
            : 'Graph authority is not ready yet.',
      },
    ];
  };

  const backend: Backend = {
    version: THREADLINE_BACKEND_VERSION,

    get state() {
      return state;
    },

    get address() {
      return http?.address ?? null;
    },

    events: publisher,

    get services(): ApplicationServices {
      return requireServices();
    },

    get localBootstrap(): LocalBootstrap | null {
      return localBootstrap;
    },

    start(): Promise<BackendAddress> {
      if (state !== 'created') {
        throw new BackendStateError('start the backend', 'created', state);
      }
      setState('starting', 'Opening durable stores.');
      const starting_ = (async (): Promise<void> => {
        try {
          await openStorage();
        } catch (error) {
          setState('stopped', 'A required data store could not be opened; refusing to serve.');
          const server = http;
          http = null;
          startedAt = null;
          await Promise.allSettled([server?.close(), closeStorage()]);
          publisher.close();
          throw error;
        }
        if (currentState() === 'starting') setState('starting', 'Opening the local HTTP transport.');
      })();
      void starting_;
      const server = createHttpServer({
        config: deps.config,
        dispatch,
        publisher,
        health,
        services: () => services,
        localBootstrap: () => localBootstrap,
        logger,
      });
      http = server;
      const starting = (async (): Promise<BackendAddress> => {
        try {
          await starting_;
          if (currentState() !== 'starting') throw new BackendStateError('finish starting the backend', 'starting', currentState());
          const address = await server.listen();
          if (currentState() !== 'starting') {
            throw new BackendStateError('finish starting the backend', 'starting', currentState());
          }
          startedAt = clock().getTime();
          setState('ready', 'Local HTTP transport is accepting commands.');
          return address;
        } catch (error) {
          if (currentState() === 'starting') {
            http = null;
            startedAt = null;
            setState('stopped', 'The transport could not bind; the backend stopped instead of pretending to run.');
            await server.close();
            await closeStorage();
            publisher.close();
          }
          throw error;
        } finally {
          startInFlight = null;
        }
      })();
      startInFlight = starting;
      return starting;
    },

    stop(): Promise<void> {
      if (state === 'stopped') {
        return Promise.resolve();
      }
      if (state === 'stopping') {
        return stopInFlight ?? Promise.resolve();
      }
      setState('stopping', 'Refusing new commands and closing open streams.');
      const stopping = (async (): Promise<void> => {
        if (startInFlight !== null) {
          await startInFlight.catch(() => {});
        }
        const server = http;
        http = null;
        if (server !== null) {
          await server.close();
        }
        await closeStorage();
        setState('stopped', 'Transport, stores and event listeners released.');
        publisher.close();
      })().finally(() => {
        stopInFlight = null;
      });
      stopInFlight = stopping;
      return stopping;
    },

    health,

    dispatch,
  };

  return backend;
}

/**
 * Creates the graph control record for a freshly bootstrapped project and waits
 * until its unique constraints are actually enforced.
 *
 * `MERGE` makes this safe to repeat: a restart re-reads the existing epoch
 * instead of creating a second root. The epoch is taken from SQL, so the graph
 * can never drift from the relational authority record.
 */
/**
 * Deterministic graph id for one principal's ActorRef.
 *
 * Kept in step with the SQL `users.id` so provenance joins across stores
 * without a lookup table.
 */
function deriveActorGraphId(tenantId: string, userId: string): string {
  const hex = sha256Hex(`actor:${tenantId}:${userId}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

async function ensureProjectRoot(
  graphs: GraphStore,
  bootstrap: LocalBootstrap,
  clock: () => Date,
  logger: Logger,
): Promise<void> {
  const graph = graphs.graph(bootstrap.graphKey);
  await graph.query(
    `MERGE (root:Entity:ProjectRoot {id:$project_id})
     ON CREATE SET root.schema_version = 1,
                     root.created_at_ms = $now_ms,
                     root.producer_id = $producer_id,
                     root.visibility = 'project',
                     root.tenant_id = $tenant_id,
                     root.project_id = $project_id,
                     root.graph_epoch = $graph_epoch,
                     root.generation = 0,
                     root.next_event_seq = 0,
                     root.requirement_revision = 0,
                     root.status = 'ready'`,
    {
      params: {
        project_id: bootstrap.projectId,
        now_ms: clock().getTime(),
        producer_id: bootstrap.userId,
        tenant_id: bootstrap.tenantId,
        graph_epoch: bootstrap.graphEpoch,
      },
    },
  );

  await graph.query(ENSURE_ACTOR_CYPHER, {
    params: {
      actor_id: deriveActorGraphId(bootstrap.tenantId, bootstrap.userId),
      now_ms: clock().getTime(),
      producer_id: bootstrap.userId,
      sql_id: bootstrap.userId,
      display_label: 'Local Owner',
    },
  });

  const observed = await graph.roQuery<{ graph_epoch?: unknown }>(
    'MATCH (root:Entity:ProjectRoot {id:$project_id}) RETURN root.graph_epoch AS graph_epoch',
    { params: { project_id: bootstrap.projectId } },
  );
  const epoch = observed.data?.[0]?.graph_epoch;
  if (epoch !== bootstrap.graphEpoch) {
    throw new ThreadlineError(
      'authority_conflict',
      'The graph project root is on a different epoch than the relational record.',
      { projectId: bootstrap.projectId },
    );
  }

  const report = await graphs.ensureSchema(bootstrap.graphKey);
  if (!report.ready) {
    throw new ThreadlineError(
      'storage_unavailable',
      'Graph constraints did not reach OPERATIONAL; refusing to admit authority.',
      { waitedMs: report.waitedMs },
    );
  }
  logger.log({
    level: 'info',
    message: 'Graph project root ready with enforced constraints.',
    fields: { graphEpoch: bootstrap.graphEpoch },
  });
}
