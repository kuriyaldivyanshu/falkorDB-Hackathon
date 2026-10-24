import {
  ThreadlineError,
  type CapabilityReport,
  type ComponentStatus,
  type HealthReport,
  type LivenessReport,
  type ServiceState,
} from '@threadline/shared';

import { buildCapabilityReport } from './capabilities.js';
import { createApiServer, type ApiServerHandle, type ServiceAddress } from './api/server.js';
import { storageConfigured, type ServiceConfig } from './config.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { createReleaseService, type ReleaseService } from './service/release.js';
import { createAccessService, type AccessService } from './service/access.js';
import { createAuthService, type AuthService } from './service/auth.js';
import { createNativeAccessService, type NativeAccessService } from './service/nativeAccess.js';
import {
  createMemoryService as createSemanticMemoryService,
  type MemoryService as SemanticMemoryService,
} from './service/memory.js';
import {
  createOperationsWorker,
  createOperationService,
  type OperationService,
  type OperationsWorker,
  type OperationWorkerStatus,
} from './service/operations.js';
import { createProjectService, type ProjectService } from './service/projects.js';
import { createSourceService, type SourceService } from './service/sources.js';
import { createContextService, type ContextService } from './service/context.js';
import { createTaskService, type TaskService } from './service/tasks.js';
import { createSourceFileStore, type SourceFileStore } from './storage/files.js';
import { createGraphStore, startGraphStore, type GraphStore } from './storage/graph.js';
import { readSchemaStatus, readPrivilegedFunctionOwners, type PrivilegedFunctionReport, type SchemaStatus } from './storage/migrate.js';
import { assertTenantFenceEnforceable, createSqlDatabase, type SqlDatabase } from './storage/pg.js';
import { THREADLINE_BACKEND_VERSION } from './version.js';

/**
 * Memory-only composition root.
 *
 * There is no provider transport, no owned inference, no run lifecycle and no
 * seeded fixture in this process. What exists is a local HTTP service over one
 * storage contract: SQL for identity, sources, operations and jobs; immutable
 * files for source bytes; FalkorDB for accepted memory.
 *
 * Honesty rules applied here:
 *
 * - construction has no side effects and opens nothing;
 * - an unconfigured or unreachable store is reported `degraded`, never faked;
 * - a durable operation without a ready store throws `storage_unavailable`
 *   rather than falling back to process memory.
 */

export { THREADLINE_BACKEND_VERSION } from './version.js';
export { MEMORY_GRAPH_SCHEMA_VERSION, MEMORY_SQL_SCHEMA_VERSION } from './version.js';
export {
  CONFIG_ENV_KEYS,
  DEFAULT_LIMITS,
  DEFAULT_SERVICE_HOST,
  DEFAULT_SERVICE_PORT,
  describeConfig,
  loadServiceConfig,
  storageConfigured,
  THREADLINE_SQL_SCHEMA,
} from './config.js';
export type {
  ConfigSource,
  FalkorDbConfig,
  LoadedConfig,
  PostgresConfig,
  ServiceConfig,
  ServiceConfigSummary,
  ServiceLimits,
} from './config.js';
export { DEFAULT_HOME_DIRECTORY_NAME, HOME_ENV_KEY, installationPaths, resolveHomeDirectory } from './environment.js';
export type { EnvironmentMap, InstallationPaths } from './environment.js';
export { createJsonLogger, silentLogger } from './log.js';
export type { Logger, LogRecord } from './log.js';
export { assertTenantFenceEnforceable, createSqlDatabase, withProjectWriteLock } from './storage/pg.js';
export type { SqlDatabase, TxClient } from './storage/pg.js';
export { ensureMemorySchema, readSchemaStatus } from './storage/migrate.js';
export type { SchemaStatus } from './storage/migrate.js';
export { LATEST_SQL_SCHEMA_VERSION, MEMORY_SQL_MIGRATIONS } from './storage/schema.js';
export { createGraphStore, startGraphStore } from './storage/graph.js';
export type { GraphSchemaReport, GraphStore } from './storage/graph.js';
export { createSourceFileStore } from './storage/files.js';
export type { SourceFileStore } from './storage/files.js';
export { canonicalDigest, canonicalize, sha256Hex } from './storage/digest.js';
export { createAuthService, generateClientToken, hashClientToken, readBearerToken } from './service/auth.js';
export type { AuthenticatedCall, AuthService } from './service/auth.js';
export {
  bootstrapLocalOwner,
  readCredentialFile,
  writeCredentialFile,
} from './service/bootstrap.js';
export type { BootstrapResult, LocalCredentialFile } from './service/bootstrap.js';
export { createProjectService } from './service/projects.js';
export type { ProjectService } from './service/projects.js';
export { createSourceService } from './service/sources.js';
export type { SourceService } from './service/sources.js';
export {
  createOperationsWorker,
  createOperationService,
  SUPPORTED_OPERATION_KINDS,
} from './service/operations.js';
export type {
  OperationService,
  OperationsWorker,
  OperationWorkerStatus,
} from './service/operations.js';
export { buildCapabilityReport, SUPPORTED_OPERATION_IDS, unsupportedOperation } from './capabilities.js';
export { initializeInstallation } from './init.js';
export type { InitReport } from './init.js';

export interface StorageStatus {
  /** Whether a database is configured at all. */
  readonly configured: boolean;
  /** Whether the stores answered; readiness is derived from the store itself. */
  readonly reachable: boolean;
  readonly schema: SchemaStatus | null;
  readonly sqlReady: boolean;
  /** The cross-tenant credential/claim functions are usable. */
  readonly privilegedSqlReady: boolean;
  readonly graphReady: boolean;
  readonly filesReady: boolean;
  /** The leased operation worker's live state; null when no worker exists. */
  readonly worker: OperationWorkerStatus | null;
  readonly detail: string;
}

export interface ServiceStatus {
  readonly health: HealthReport;
  readonly storage: StorageStatus;
}

export interface MemoryServiceDeps {
  readonly config: ServiceConfig;
  readonly clock?: () => Date;
  readonly logger?: Logger;
  /** Injected by focused checks; production wires the real stores in start(). */
  readonly database?: SqlDatabase;
  readonly migrationDb?: SqlDatabase;
  readonly graphStore?: GraphStore;
  readonly files?: SourceFileStore;
}

export interface MemoryService {
  readonly version: string;
  readonly state: ServiceState;
  readonly address: ServiceAddress | null;
  start(): Promise<ServiceAddress>;
  stop(): Promise<void>;
  /** Minimal unauthenticated liveness; carries no component or tenant detail. */
  liveness(): LivenessReport;
  health(): HealthReport;
  status(): ServiceStatus;
  capabilities(): CapabilityReport;
  /** Durable services. Throws `storage_unavailable` until the stores are ready. */
  readonly release: ReleaseService;
  readonly auth: AuthService;
  readonly access: AccessService;
  readonly nativeAccess: NativeAccessService;
  readonly projects: ProjectService;
  readonly sources: SourceService;
  readonly operations: OperationService;
  readonly memories: SemanticMemoryService;
  readonly tasks: TaskService;
  readonly context: ContextService;
}

export function createMemoryService(deps: MemoryServiceDeps): MemoryService {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  let state: ServiceState = 'created';
  let startedAtMs: number | null = null;
  let server: ApiServerHandle | null = null;
  let database: SqlDatabase | null = deps.database ?? null;
  let migrationDb: SqlDatabase | null = deps.migrationDb ?? null;
  let graphStore: GraphStore | null = deps.graphStore ?? null;
  let files: SourceFileStore | null = deps.files ?? null;
  let schema: SchemaStatus | null = null;
  let reachable = false;
  let filesReady = false;
  let graphReady = false;
  /**
   * Whether the narrow cross-tenant functions are actually usable. A reachable
   * database does not imply this: forced row-level security applies to the
   * function owner too, so an owner that cannot bypass the fence makes
   * authentication, claiming and the backlog count return nothing at all.
   */
  let privilegedSql: PrivilegedFunctionReport = {
    ready: false,
    owners: [],
    missing: [],
    detail: 'The privileged SQL path has not been checked yet.',
  };
  let release: ReleaseService | null = null;
  let auth: AuthService | null = null;
  let projects: ProjectService | null = null;
  let access: AccessService | null = null;
  let nativeAccess: NativeAccessService | null = null;
  let sources: SourceService | null = null;
  let operations: OperationService | null = null;
  let memories: SemanticMemoryService | null = null;
  let tasks: TaskService | null = null;
  let context: ContextService | null = null;
  let worker: OperationsWorker | null = null;

  const sqlReady = (): boolean => reachable && schema?.state === 'applied' && database !== null;

  /**
   * Durable work needs both halves: a fenced store that ordinary access can use,
   * and a privileged path that can resolve a credential and claim across
   * tenants. Reporting only the first is what made a dead claim path look
   * healthy.
   */
  const durableReady = (): boolean => sqlReady() && privilegedSql.ready;

  /**
   * Graph readiness must come from a live probe.
   *
   * The worker holds a live probe, so its answer wins. With no worker there is
   * no prober at all, and the one-time startup probe is a historical
   * observation rather than a current one — reporting it as ready is exactly the
   * stale claim that let an outage read as healthy. Without a live prober the
   * honest answer is "unavailable".
   */
  const resolveGraphServing = (workerStatus: OperationWorkerStatus | null): boolean =>
    workerStatus !== null ? workerStatus.graphReachable : false;

  const requireDurable = <T>(service: T | null): T => {
    if (service === null || !durableReady()) {
      throw new ThreadlineError(
        'storage_unavailable',
        schema?.state === 'absent'
          ? 'The threadline_memory schema is not applied; run "threadline init" with store credentials.'
          : sqlReady() && !privilegedSql.ready
            ? `The privileged SQL path is unusable, so no durable operation can be admitted. ${privilegedSql.detail}`
            : 'The durable stores are not ready; no memory operation was attempted.',
      );
    }
    return service;
  };

  const openStorage = async (): Promise<void> => {
    if (!storageConfigured(deps.config)) {
      logger.log({
        level: 'warn',
        message: 'No durable store is configured; the service starts degraded and records nothing.',
      });
      return;
    }
    try {
      database ??= createSqlDatabase({ config: deps.config.postgres, logger });
      if (migrationDb === null && deps.config.postgres.migrationUser.length > 0) {
        migrationDb = createSqlDatabase({
          config: {
            ...deps.config.postgres,
            user: deps.config.postgres.migrationUser,
            password: deps.config.postgres.migrationPassword,
          },
          logger,
        });
      }
      await database.ping();
      reachable = true;
      schema = await readSchemaStatus({
        db: database,
        postgres: deps.config.postgres,
      });
      if (schema.state === 'applied') {
        // The fence is only real for a restricted role; verify rather than trust.
        await assertTenantFenceEnforceable(database);
      } else {
        logger.log({
          level: 'warn',
          message: 'The memory schema is not applied; durable operations are unavailable.',
          fields: { schemaState: schema.state, schemaVersion: schema.version },
        });
      }
    } catch (error) {
      reachable = false;
      database = null;
      logger.log({
        level: 'error',
        message: 'PostgreSQL is configured but not reachable; the service starts degraded.',
        fields: { errorName: error instanceof Error ? error.name : typeof error },
      });
      return;
    }

    // A reachable database is not the same as a usable privileged path. Resolve
    // it explicitly so readiness never reports healthy admission while
    // authentication and claiming would match no rows.
    if (sqlReady()) {
      privilegedSql = await readPrivilegedFunctionOwners(database);
      if (!privilegedSql.ready) {
        logger.log({
          level: 'error',
          message: 'The cross-tenant SQL functions are unusable; authentication and claiming cannot succeed.',
          fields: { detail: privilegedSql.detail.slice(0, 400) },
        });
      }
    } else {
      privilegedSql = {
        ready: false,
        owners: [],
        missing: [],
        detail: 'The privileged SQL path is unverified because the memory schema is not applied.',
      };
    }

    try {
      graphStore ??= createGraphStore({ config: deps.config.falkordb, logger });
      await startGraphStore(graphStore);
      graphReady = true;
    } catch (error) {
      graphReady = false;
      logger.log({
        level: 'error',
        message: 'FalkorDB is configured but not reachable; memory admission is unavailable.',
        fields: { errorName: error instanceof Error ? error.name : typeof error },
      });
    }

    files ??= createSourceFileStore({ root: deps.config.paths.sourceRoot, logger });
    filesReady = await files.probe();

    release = createReleaseService({db: database, files, ...(graphStore === null ? {} : {graphStore})});
    auth = createAuthService({ db: database, clock, logger });
    access = createAccessService({ db: database });
    nativeAccess = createNativeAccessService({ db: database });
    projects = createProjectService({ db: database, clock, logger });
    sources = createSourceService({ db: database, files, release, clock, logger });
    operations = createOperationService({ db: database });
    if (graphStore !== null && sqlReady()) {
      memories = createSemanticMemoryService({ db: database, files, graphStore, release, clock, logger });
      tasks = createTaskService({ db: database, graphStore, release, clock, logger });
      context = createContextService({ db: database, graphStore, sources, tasks, release, clock });
      worker = createOperationsWorker({
        db: database,
        graphStore,
        files,
        limits: deps.config.limits,
        clock,
        logger,
      });
    }
    logger.log({
      level: 'info',
      message: 'Storage state resolved.',
      fields: {
        reachable,
        schemaState: schema?.state ?? 'unconfigured',
        graphReady,
        filesReady,
      },
    });
  };

  const closeStorage = async (): Promise<void> => {
    const closers: Promise<void>[] = [];
    if (worker !== null) {
      await worker.stop().catch(() => undefined);
      worker = null;
    }
    if (graphStore !== null) {
      closers.push(graphStore.close());
    }
    if (database !== null) {
      closers.push(database.close());
    }
    if (migrationDb !== null && migrationDb !== database) {
      closers.push(migrationDb.close());
    }
    graphStore = null;
    database = null;
    migrationDb = null;
    auth = null;
    projects = null;
    sources = null;
    operations = null;
    memories = null;
    tasks = null;
    context = null;
    const settled = await Promise.allSettled(closers);
    if (settled.some((result) => result.status === 'rejected')) {
      logger.log({ level: 'warn', message: 'One or more storage connections did not close cleanly.' });
    }
  };

  const storageStatus = (): StorageStatus => {
    const configured = storageConfigured(deps.config);
    const workerStatus = worker?.status() ?? null;
    const graphServing = resolveGraphServing(workerStatus);
    const state = !configured
      ? 'unconfigured'
      : reachable
        ? `schema ${schema?.state ?? 'unknown'}`
        : 'unreachable';
    const detail = !configured
      ? 'No PostgreSQL database, user and password are configured for this installation.'
      : reachable
        ? (schema?.detail ?? 'The store answered; schema state is unknown.')
        : 'The configured PostgreSQL database did not answer its probe.';
    return {
      configured,
      reachable,
      schema,
      sqlReady: sqlReady(),
      privilegedSqlReady: privilegedSql.ready,
      graphReady: graphServing,
      filesReady,
      worker: workerStatus,
      detail: `${detail} ${privilegedSql.detail} Graph: ${graphServing ? 'reachable' : 'unavailable'}. Source files: ${filesReady ? 'writable' : 'unavailable'} (state: ${state}).`,
    };
  };

  const health = (): HealthReport => {
    const listening = server?.listening ?? false;
    const workerStatus = worker?.status() ?? null;
    const graphServing = resolveGraphServing(workerStatus);
    const components: readonly ComponentStatus[] = [
      {
        name: 'api',
        present: true,
        ready: listening,
        detail: listening
          ? 'The loopback HTTP transport is bound and serving this build\'s routes.'
          : 'The transport exists in this process but is not bound to a port.',
      },
      {
        name: 'postgres',
        present: storageConfigured(deps.config),
        ready: sqlReady(),
        detail: !storageConfigured(deps.config)
          ? 'Storage is unconfigured; identity, sources and operations are unavailable.'
          : sqlReady()
            ? `Schema threadline_memory version ${String(schema?.version ?? 0)} is applied with forced row-level security.`
            : storageStatus().detail,
      },
      {
        name: 'privilegedSql',
        present: storageConfigured(deps.config),
        ready: privilegedSql.ready,
        detail: privilegedSql.detail,
      },
      {
        name: 'falkordb',
        present: storageConfigured(deps.config),
        ready: graphServing,
        detail: graphServing
          ? 'FalkorDB answered its most recent probe; project graphs are initialized and verified on first admission.'
          : 'FalkorDB is not reachable; graph admission is unavailable and pending operations wait unsettled.',
      },
      {
        name: 'sources',
        present: files !== null,
        ready: filesReady && durableReady(),
        detail: filesReady && durableReady()
          ? 'Immutable source bytes and their SQL catalog are available.'
          : 'Source capture requires the catalog schema, a usable privileged SQL path and a writable source root.',
      },
      {
        name: 'operations',
        present: worker !== null,
        ready: workerStatus?.running ?? false,
        detail: workerStatus?.detail ?? 'No leased commit worker exists without a configured durable store.',
      },
      {
        name: 'nativeAdapter',
        present: false,
        ready: false,
        detail:
          'No Codex profile, hook or MCP server is installed by this build; native capture remains unqualified.',
      },
    ];

    return {
      protocolVersion: 2,
      backendVersion: THREADLINE_BACKEND_VERSION,
      state,
      uptimeMs: startedAtMs === null ? 0 : Math.max(0, clock().getTime() - startedAtMs),
      components: [...components],
      guarantees: {
        // Semantic memory, tasks, episodes and procedural candidates use the
        // leased worker. Durability requires SQL, the graph and the worker to
        // be ready. Procedure validation, agent claims,
        // handoffs and native capture remain unavailable in capabilities.
        durableMemory: durableReady() && graphServing && (workerStatus?.running ?? false),
        graphAdmission: durableReady() && graphServing && (workerStatus?.running ?? false),
        sourceHistory: durableReady() && filesReady,
        replayable: false,
        note: durableReady()
          ? 'Source history is durable in SQL plus immutable files. Semantic memory proposals, explicit human acceptance, corrections and task requirements are admitted in SQL and committed to the project graph through the leased worker with graph receipts; accepted-memory reads resolve the current version from that graph. Episode admission and procedural candidates with human review are admitted and committed the same way; a human-accepted procedure stays a candidate. Bounded context preparation records metadata-only manifests and prepared occurrences; emission is reported, never native observation. Validated reuse, claims, handoffs and native capture remain unavailable.'
          : 'No durable store is ready: health and capabilities are served, and every durable operation refuses.',
      },
    };
  };

  const service: MemoryService = {
    version: THREADLINE_BACKEND_VERSION,

    get state() {
      return state;
    },

    get address() {
      return server?.address ?? null;
    },

    get release() { return requireDurable(release); },
    get auth(): AuthService {
      if (auth === null || !durableReady()) {
        throw new ThreadlineError(
          'storage_unavailable',
          sqlReady() && !privilegedSql.ready
            ? `Authentication is unavailable because the privileged SQL path is unusable. ${privilegedSql.detail}`
            : 'Authentication is unavailable until storage is configured.',
        );
      }
      return auth;
    },

    get access(): AccessService {
      return requireDurable(access);
    },
    get nativeAccess(): NativeAccessService {
      return requireDurable(nativeAccess);
    },

    get projects(): ProjectService {
      return requireDurable(projects);
    },

    get sources(): SourceService {
      return requireDurable(sources);
    },

    get operations(): OperationService {
      return requireDurable(operations);
    },

    get memories(): SemanticMemoryService {
      return requireDurable(memories);
    },

    get context(): ContextService {
      return requireDurable(context);
    },

    get tasks(): TaskService {
      return requireDurable(tasks);
    },

    liveness: () => ({
      protocolVersion: 2,
      backendVersion: THREADLINE_BACKEND_VERSION,
      state,
      uptimeMs: startedAtMs === null ? 0 : Math.max(0, clock().getTime() - startedAtMs),
    }),
    health,
    status: () => ({ health: health(), storage: storageStatus() }),
    capabilities: () => buildCapabilityReport(),

    async start(): Promise<ServiceAddress> {
      if (state !== 'created') {
        throw new ThreadlineError('invalid_request', 'The service has already been started.');
      }
      state = 'starting';
      await openStorage();
      logger.log({
        level: 'info',
        message: 'Starting the memory service.',
        fields: {
          home: deps.config.paths.home,
          host: deps.config.host,
          port: deps.config.port,
          database: deps.config.postgres.database,
          ownerLabel: deps.config.ownerLabel,
        },
      });
      server = createApiServer({
        config: deps.config,
        service,
        logger,
      });
      let address: ServiceAddress;
      try {
        address = await server.listen();
      } catch (error) {
        await server.close().catch(() => undefined);
        server = null;
        await closeStorage();
        state = 'stopped';
        throw error;
      }
      startedAtMs = clock().getTime();
      worker?.start();
      state = durableReady() ? 'ready' : 'degraded';
      logger.log({
        level: 'info',
        message: 'Memory service is listening.',
        fields: { url: address.url, state },
      });
      return address;
    },

    async stop(): Promise<void> {
      if (state === 'stopped') {
        return;
      }
      // Shutdown is not a distinct lifecycle state: the service stops accepting
      // and moves straight to `stopped`. Inventing a `stopping` state here would
      // be a value the health contract does not define and cannot report.
      const live = server;
      server = null;
      if (live !== null) {
        await live.close();
      }
      if (worker !== null) {
        await worker.stop().catch(() => undefined);
      }
      await closeStorage();
      startedAtMs = null;
      state = 'stopped';
      logger.log({ level: 'info', message: 'Memory service stopped.' });
    },
  };
  return service;
}
