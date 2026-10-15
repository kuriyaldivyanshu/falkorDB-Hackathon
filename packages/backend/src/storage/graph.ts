import { ConstraintType, EntityType, FalkorDB, type Graph } from 'falkordb';

import { ThreadlineError } from '@threadline/shared';

import type { FalkorDbConfig } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';

/**
 * FalkorDB adapter.
 *
 * Responsibilities kept deliberately narrow: connect, select a graph by a key
 * that the trusted backend resolved (never by caller input), run parameterized
 * Cypher, and prove that the declared constraints are actually in force.
 *
 * No connection is opened at import time, and a graph key is never accepted
 * from a request body.
 */

export interface GraphStore {
  /** Returns the named graph. The caller must have resolved `graphKey` from SQL. */
  graph(graphKey: string): Graph;
  /** Creates the indexes and constraints the authority contract depends on. */
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
 * Constraints M01 actually relies on. The reference catalog also declares
 * Observation/Message/TaskState uniqueness; those labels gain nodes in later
 * milestones, so only the M01 subset is required here. A missing constraint is
 * never assumed: `ensureSchema` reports the real state instead.
 */
const REQUIRED_CONSTRAINTS: readonly { label: string; properties: string[] }[] = [
  { label: 'Entity', properties: ['id'] },
  { label: 'Event', properties: ['graph_epoch', 'seq'] },
  { label: 'RequestReceipt', properties: ['graph_epoch', 'request_id'] },
  { label: 'TaskState', properties: ['task_id', 'revision'] },
];

const REQUIRED_INDEXES: readonly { label: string; properties: string[] }[] = [
  { label: 'Entity', properties: ['id'] },
  { label: 'RequestReceipt', properties: ['graph_epoch', 'request_id'] },
  { label: 'Event', properties: ['graph_epoch', 'seq'] },
  { label: 'TaskState', properties: ['task_id', 'revision'] },
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
      client = await FalkorDB.connect({
        host: deps.config.host,
        port: deps.config.port,
        ...(deps.config.username.length > 0 ? { username: deps.config.username } : {}),
        ...(deps.config.password.length > 0 ? { password: deps.config.password } : {}),
        socket: { connectTimeout: deps.config.connectTimeoutMs },
      });
      return client;
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
          'The graph store is not connected; call start() before using it.',
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
          // An existing index is reported as an error by the server. Treat the
          // "already exists" case as success; everything else must surface.
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
        fields: { graphKey, waitedMs: report.waitedMs },
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
    if (REQUIRED_CONSTRAINTS.every((c) => state[c.label] === 'OPERATIONAL')) {
      return { ready: true, state, waitedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS));
  }
  return { ready: false, state, waitedMs: Date.now() - startedAt };
}

async function readConstraintState(
  graph: Graph,
): Promise<Readonly<Record<string, ConstraintState>>> {
  // Observed on FalkorDB 6.0.2: rows are
  // { type, label, properties: string[], entitytype, status }.
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
    // A single pending constraint must never mask one that is already
    // operational, but an observed non-operational row does mean not ready.
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