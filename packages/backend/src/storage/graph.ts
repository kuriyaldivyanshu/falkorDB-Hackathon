import { ConstraintType, EntityType, FalkorDB, type Graph } from 'falkordb';

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

export function createGraphStore(deps: GraphStoreDeps): GraphStore {
  const logger = deps.logger ?? silentLogger;
  let closed = false;
  let client: FalkorDB | null = null;

  const connect = async (): Promise<FalkorDB> => {
    if (closed) {
      throw new ThreadlineError('storage_unavailable', 'The graph store is closed.');
    }
    if (client !== null) {
      return client;
    }
    try {
      const live = await FalkorDB.connect({
        host: deps.config.host,
        port: deps.config.port,
        ...(deps.config.username.length > 0 ? { username: deps.config.username } : {}),
        ...(deps.config.password.length > 0 ? { password: deps.config.password } : {}),
        socket: { connectTimeout: deps.config.connectTimeoutMs },
      });
      // The Redis client behind FalkorDB emits `error` when its socket dies.
      // Without a listener that aborts the whole process, so the event is
      // contained here: log it, drop the dead client, and let the next call
      // reconnect instead of reusing a closed connection.
      live.on('error', (error: unknown) => {
        if (client === live) {
          client = null;
        }
        logger.log({
          level: 'warn',
          message: 'FalkorDB connection reported an error; the store will reconnect on the next call.',
          fields: { errorName: error instanceof Error ? error.name : typeof error },
        });
      });
      client = live;
      return live;
    } catch (error) {
      client = null;
      throw new ThreadlineError('storage_unavailable', 'Could not connect to FalkorDB.', {
        host: deps.config.host,
        port: deps.config.port,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  };

  const store: GraphStore = {
    graph(graphKey: string): Graph {
      if (graphKey.trim().length === 0) {
        throw new ThreadlineError('internal_error', 'A graph key is required.');
      }
      const live = client;
      if (live === null) {
        throw new ThreadlineError(
          'storage_unavailable',
          'The graph store is not connected; call start before using it.',
        );
      }
      return live.selectGraph(graphKey);
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
      const live = await connect();
      try {
        await live.list();
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
      const live = client;
      client = null;
      if (live !== null) {
        await live.close();
      }
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
