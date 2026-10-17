import { createRequire } from 'node:module';

import { ConstraintType, EntityType, Graph } from 'falkordb';
import { Single } from 'falkordb/dist/src/clients/single.js';
import { createClient, type RedisFunctions, type RedisScripts } from '@redis/client';

import { ThreadlineError } from '@threadline/shared';

import type { FalkorDbConfig } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { MEMORY_GRAPH_SCHEMA_VERSION } from '../version.js';

/**
 * FalkorDB adapter for project memory graphs.
 *
 * Responsibilities kept deliberately narrow: connect, select a graph by a key
 * the trusted backend resolved from SQL (never from a request body), run
 * parameterized Cypher, and prove that the declared constraints are actually in
 * force. A failed or pending constraint means the graph is not ready, and
 * readiness is never inferred from a successful process start.
 *
 * Connection ownership is established before opening the socket. FalkorDB
 * 6.8.0's async factory forwards errors to an inaccessible instance before it
 * returns, so a caller cannot protect that construction window. This local,
 * standalone adapter reuses the pinned library's command codec and Single/Graph
 * implementation, with node-redis's public connection lifecycle. No query or
 * receipt semantics are reimplemented here.
 *
 * The client reconnects in place, offline commands are refused and every command
 * has a deadline. Timing out an already submitted write is ambiguous: the worker
 * must still reconcile its original operation receipt before retrying it.
 */

export interface GraphStore {
  /** Returns the named graph. The caller must have resolved `graphKey` from SQL. */
  graph(graphKey: string): Graph;
  /** Creates and verifies the constraints and indexes the memory contract needs. */
  ensureSchema(graphKey: string): Promise<GraphSchemaReport>;
  /** Cheap liveness probe. Throws `storage_unavailable` when unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
  /** Transport readiness, not proof of a committed graph operation. */
  readonly connected: boolean;
}

export interface GraphStoreDeps {
  readonly config: FalkorDbConfig;
  readonly logger?: Logger;
}

export type ConstraintState = 'OPERATIONAL' | 'PENDING' | 'ABSENT';

export interface GraphSchemaReport {
  readonly ready: boolean;
  readonly state: Readonly<Record<string, ConstraintState>>;
  readonly waitedMs: number;
}

/**
 * Constraints the memory contract actually relies on:
 *
 * - one `Entity` id per project graph, so a ProjectRoot/SourceAnchor/Memory
 *   identity cannot silently duplicate;
 * - one `Event` per (graph epoch, sequence), so an event stream cannot fork;
 * - one `OperationReceipt` per (graph epoch, operation), so a replay cannot
 *   commit the same operation twice.
 */
const REQUIRED_CONSTRAINTS: readonly { label: string; properties: string[] }[] = [
  { label: 'Entity', properties: ['id'] },
  { label: 'Event', properties: ['graph_epoch', 'seq'] },
  { label: 'OperationReceipt', properties: ['graph_epoch', 'operation_id'] },
];

const REQUIRED_INDEXES: readonly { label: string; properties: string[] }[] = [
  { label: 'Entity', properties: ['id'] },
  { label: 'Event', properties: ['graph_epoch', 'seq'] },
  { label: 'OperationReceipt', properties: ['graph_epoch', 'operation_id'] },
];

const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_MS = 250;
/** Longest the client waits between reconnect attempts while the store is open. */
const RECONNECT_BACKOFF_MS = 1_000;

/** Isolated CJS interop for the pinned FalkorDB command codec. */
const require = createRequire(import.meta.url);
const commands: typeof import('falkordb/dist/src/commands/index.js').default =
  require('falkordb/dist/src/commands/index.js').default;
const COMMAND_TIMEOUT_MS = 5_000;
const COMMAND_QUEUE_LIMIT = 128;

export function createGraphStore(deps: GraphStoreDeps): GraphStore {
  const logger = deps.logger ?? silentLogger;
  let closed = false;
  /** The single in-flight attempt, if any. Never more than one. */
  let pending: Promise<void> | null = null;
  /** Consecutive socket errors since the last healthy signal. */
  let errorRun = 0;

  // Constructing opens no network connection. Own the emitter before connect().
  const connection = createClient<{ falkordb: typeof commands }, RedisFunctions, RedisScripts, 2>({
    socket: {
      host: deps.config.host,
      port: deps.config.port,
      connectTimeout: deps.config.connectTimeoutMs,
      reconnectStrategy: (retries: number) => closed ? false : Math.min(50 * (retries + 1), RECONNECT_BACKOFF_MS),
    },
    ...(deps.config.username.length > 0 ? { username: deps.config.username } : {}),
    ...(deps.config.password.length > 0 ? { password: deps.config.password } : {}),
    modules: { falkordb: commands },
    disableOfflineQueue: true,
    commandsQueueMaxLength: COMMAND_QUEUE_LIMIT,
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
  });
  // A node-redis queue timeout stops when a command is sent. Bound the full
  // reply lifetime as well, and destroy the socket on expiry so late replies
  // cannot shift the next request's response or leave submitted work dangling.
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new ThreadlineError('storage_unavailable', 'FalkorDB reply deadline exceeded; commit outcome may be unknown.'));
            if (connection.isOpen) connection.destroy();
          }, COMMAND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const client = new Single(connection);
  connection.on('error', (error: unknown) => {
    if (closed) return;
    errorRun += 1;
    logger.log({
      level: errorRun === 1 ? 'warn' : 'debug',
      message: 'FalkorDB connection error; the owned connection will reconnect.',
      fields: { errorName: describeError(error), errorRun },
    });
  });

  const noteHealthy = (): void => {
    if (errorRun > 0) {
      logger.log({
        level: 'info',
        message: 'FalkorDB reconnected after a connection error.',
        fields: { errorRun },
      });
    }
    errorRun = 0;
  };

  const connect = async (): Promise<void> => {
    if (closed) throw new ThreadlineError('storage_unavailable', 'The graph store is closed.');
    if (pending !== null) return pending;
    if (connection.isReady) return;
    // An established connection owns its reconnect loop. Do not create another.
    if (connection.isOpen) throw new ThreadlineError('storage_unavailable', 'FalkorDB is reconnecting.');
    const attempt = (async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          connection.connect(),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              if (connection.isOpen) connection.destroy();
              reject(new ThreadlineError('storage_unavailable', 'FalkorDB connection deadline exceeded.'));
            }, deps.config.connectTimeoutMs);
          }),
        ]);
        if (closed) throw new ThreadlineError('storage_unavailable', 'The graph store is closed.');
        const info = await connection.info('server');
        if (!info.includes('redis_mode:standalone')) {
          throw new ThreadlineError('storage_unavailable', 'This local memory store requires standalone FalkorDB.');
        }
      } catch (error) {
        if (connection.isOpen) connection.destroy();
        throw new ThreadlineError('storage_unavailable', 'Could not connect to FalkorDB.', {
          errorName: describeError(error),
        });
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
      }
    })();
    pending = attempt;
    try { await attempt; } finally { if (pending === attempt) pending = null; }
  };

  const store: GraphStore = {
    graph(graphKey: string): Graph {
      if (graphKey.trim().length === 0) {
        throw new ThreadlineError('internal_error', 'A graph key is required.');
      }
      if (closed) {
        throw new ThreadlineError('storage_unavailable', 'The graph store is closed.');
      }
      if (!connection.isReady) {
        throw new ThreadlineError('storage_unavailable', 'FalkorDB is disconnected or reconnecting.');
      }
      // Bind methods to the real Graph (which has private fields), and retain
      // its public types/codec while bounding every operation's complete reply.
      return new Proxy(new Graph(client, graphKey), {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function' || key === 'constructor') return value;
          return (...args: unknown[]) => bounded(() => Promise.resolve(Reflect.apply(value, target, args)));
        },
      });
    },

    async ensureSchema(graphKey: string): Promise<GraphSchemaReport> {
      const graph = store.graph(graphKey);
      for (const index of REQUIRED_INDEXES) {
        try {
          await graph.createTypedIndex('', 'NODE', index.label, index.properties);
        } catch (error) {
          // An existing index is reported as an error by the server. Treat only
          // the "already exists" case as success; everything else must surface.
          if (!isAlreadyExists(error)) {
            throw new ThreadlineError(
              'storage_unavailable',
              'Could not create a required graph index.',
              { label: index.label, errorName: describeError(error) },
            );
          }
        }
      }
      for (const constraint of REQUIRED_CONSTRAINTS) {
        try {
          await graph.constraintCreate(
            ConstraintType.UNIQUE,
            EntityType.NODE,
            constraint.label,
            ...constraint.properties,
          );
        } catch (error) {
          if (!isAlreadyExists(error)) {
            throw new ThreadlineError(
              'storage_unavailable',
              'Could not create a required graph constraint.',
              { label: constraint.label, errorName: describeError(error) },
            );
          }
        }
      }
      const report = await waitForConstraints(graph);
      if (report.ready) {
        noteHealthy();
      }
      logger.log({
        level: report.ready ? 'info' : 'warn',
        message: report.ready
          ? 'Graph constraints are OPERATIONAL.'
          : 'Graph constraints are not yet OPERATIONAL.',
        fields: { graphKey, waitedMs: report.waitedMs, graphSchemaVersion: MEMORY_GRAPH_SCHEMA_VERSION },
      });
      return report;
    },

    async ping(): Promise<void> {
      await connect();
      try {
        await bounded(() => client.list());
        noteHealthy();
      } catch (error) {
        throw new ThreadlineError('storage_unavailable', 'FalkorDB did not answer a probe.', {
          errorName: describeError(error),
        });
      }
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // Keep the listener attached while destroying the socket and settling any
      // in-flight connect. Never wait for a graceful command drain in an outage.
      if (connection.isOpen) connection.destroy();
      await pending?.catch(() => undefined);
    },

    get connected() {
      return !closed && connection.isReady;
    },

    get closed() {
      return closed;
    },
  };

  return store;
}

/** Connect eagerly so `graph()` is usable; callers still own the lifecycle. */
export async function startGraphStore(store: GraphStore): Promise<void> {
  await store.ping();
}

async function waitForConstraints(graph: Graph): Promise<GraphSchemaReport> {
  const startedAt = Date.now();
  let state: Readonly<Record<string, ConstraintState>> = {};

  while (Date.now() - startedAt < READINESS_TIMEOUT_MS) {
    state = await readConstraintState(graph);
    if (REQUIRED_CONSTRAINTS.every((constraint) => state[constraint.label] === 'OPERATIONAL')) {
      return { ready: true, state, waitedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS));
  }
  return { ready: false, state, waitedMs: Date.now() - startedAt };
}

async function readConstraintState(
  graph: Graph,
): Promise<Readonly<Record<string, ConstraintState>>> {
  const reply = await graph.roQuery<{
    type?: unknown;
    label?: unknown;
    properties?: unknown;
    entitytype?: unknown;
    status?: unknown;
  }>('CALL db.constraints()');
  const observed: Record<string, ConstraintState> = {};
  for (const required of REQUIRED_CONSTRAINTS) {
    observed[required.label] = 'ABSENT';
  }
  for (const row of reply.data ?? []) {
    if (row.type !== 'UNIQUE' || row.entitytype !== 'NODE' || typeof row.label !== 'string') {
      continue;
    }
    const properties = toStringArray(row.properties);
    const required = REQUIRED_CONSTRAINTS.find(
      (candidate) =>
        candidate.label === row.label &&
        properties !== null &&
        candidate.properties.length === properties.length &&
        candidate.properties.every((property, index) => properties[index] === property),
    );
    if (required === undefined) {
      continue;
    }
    const status: ConstraintState = row.status === 'OPERATIONAL' ? 'OPERATIONAL' : 'PENDING';
    if (observed[required.label] !== 'OPERATIONAL') {
      observed[required.label] = status;
    }
  }
  return observed;
}

function toStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : null;
}

function isAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already (exists|exist|indexed)|Equivalent index/i.test(message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
