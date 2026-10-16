import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';

import { ThreadlineError } from '@threadline/shared';

import type { PostgresConfig } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';

/**
 * PostgreSQL adapter.
 *
 * Three properties matter more than convenience here:
 *
 * - no connection is opened at import time; the pool is built by a factory and
 *   the caller decides when to connect;
 * - every statement is parameterized, including the tenant fence, which is set
 *   with `set_config` rather than string interpolation;
 * - a failed query never surfaces a connection string. `describePgError`
 *   reduces driver output to a name and a caller-safe classification.
 */

/**
 * The transaction surface handed to repository code. It exposes rows directly
 * so a caller cannot forget `.rows` and end up indexing a driver result object.
 */
export interface TxClient {
  rows<TRow extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<TRow[]>;
}

export interface SqlDatabase {
  /** Runs one parameterized statement on a pooled connection. */
  query<TRow extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<TRow[]>;
  /**
   * Runs `work` inside one transaction with the tenant fence already applied.
   * `tenantId` is bound as a parameter; it is never formatted into SQL.
   */
  withTenantTransaction<TResult>(tenantId: string, work: (tx: TxClient) => Promise<TResult>): Promise<TResult>;
  /** Runs `work` inside one transaction without a tenant fence. */
  withTransaction<TResult>(work: (tx: TxClient) => Promise<TResult>): Promise<TResult>;
  /** Cheap liveness probe. Throws `storage_unavailable` when unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/**
 * Refuses to run as a role that bypasses row-level security.
 *
 * `ENABLE` + `FORCE ROW LEVEL SECURITY` is defeated by a superuser or by any
 * role holding `BYPASSRLS`. That makes the tenant fence decorative rather than
 * enforced, so startup fails loudly instead of admitting authority under a
 * connection that can read every tenant.
 */
export async function assertTenantFenceEnforceable(db: SqlDatabase): Promise<void> {
  const rows = await db.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  const role = rows[0];
  if (role === undefined) {
    throw new ThreadlineError(
      'storage_unavailable',
      'Could not determine the database role for the tenant-fence check.',
    );
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new ThreadlineError(
      'storage_unavailable',
      'The configured database role can bypass row-level security, so the tenant fence cannot be enforced.',
      {
        role: role.rolname,
        isSuperuser: role.rolsuper,
        hasBypassRls: role.rolbypassrls,
      },
    );
  }
}

export interface SqlDatabaseDeps {
  readonly config: PostgresConfig;
  readonly logger?: Logger;
}

export function createSqlDatabase(deps: SqlDatabaseDeps): SqlDatabase {
  const logger = deps.logger ?? silentLogger;
  let closed = false;

  const pool = new Pool(toPoolConfig(deps.config));
  // An idle client erroring must not become an unhandled 'error' event.
  pool.on('error', (error: Error) => {
    logger.log({
      level: 'warn',
      message: 'Idle PostgreSQL client reported an error.',
      fields: { errorName: error.name },
    });
  });

  const run = async <TRow extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<TRow[]> => {
    assertOpen(closed);
    try {
      const result = await pool.query<TRow>(text, values as unknown[]);
      return result.rows;
    } catch (error) {
      throw toStorageError(error, 'postgres_query');
    }
  };

  const withTransaction = async <TResult>(
    work: (tx: TxClient) => Promise<TResult>,
    tenantId?: string,
  ): Promise<TResult> => {
    assertOpen(closed);
    const client = await acquire(pool);
    let discard = false;
    try {
      await client.query('BEGIN');
      if (tenantId !== undefined) {
        // FORCE ROW LEVEL SECURITY applies to the owner too, so the fence must
        // be established inside every scoped transaction.
        await client.query('SELECT set_config($1, $2, true)', [
          'threadline.tenant_id',
          tenantId,
        ]);
      }
      const result = await work({
        rows: async <TRow extends QueryResultRow>(
          text: string,
          values: readonly unknown[] = [],
        ): Promise<TRow[]> => {
          const outcome = await client.query<TRow>(text, values as unknown[]);
          return outcome.rows;
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      discard = !(await rollbackQuietly(client, logger));
      throw error instanceof ThreadlineError
        ? error
        : toStorageError(error, 'postgres_transaction');
    } finally {
      client.release(discard);
    }
  };

  return {
    query: run,
    withTenantTransaction: (tenantId, work) => withTransaction(work, tenantId),
    withTransaction: (work) => withTransaction(work),

    async ping(): Promise<void> {
      assertOpen(closed);
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        throw toStorageError(error, 'postgres_ping');
      }
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await pool.end();
    },

    get closed() {
      return closed;
    },
  };
}

async function acquire(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    throw toStorageError(error, 'postgres_connect');
  }
}

async function rollbackQuietly(client: PoolClient, logger: Logger): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch (rollbackError) {
    // The connection is discarded by release() in any case; the original error
    // is the one worth reporting.
    logger.log({
      level: 'warn',
      message: 'ROLLBACK failed; the connection is being discarded.',
      fields: { errorName: describeError(rollbackError) },
    });
    return false;
  }
}

function assertOpen(closed: boolean): void {
  if (closed) {
    throw new ThreadlineError('storage_unavailable', 'The PostgreSQL pool is closed.');
  }
}

function toPoolConfig(config: PostgresConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl === 'require' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: config.connectTimeoutMs,
    max: config.maxConnections,
    // Small local pools should not sit on a statement timeout of their own; the
    // migration and readiness probes have their own bounded timeouts.
    allowExitOnIdle: false,
  };
}

/**
 * Reduces a driver error to a typed, credential-free failure. The original
 * message is deliberately dropped: pg includes the connection identity in some
 * messages, and this value can reach a log line.
 */
export function toStorageError(error: unknown, stage: string): ThreadlineError {
  const name = describeError(error);
  const code = readPgCode(error);
  if (code === '23505' || code === '23503' || code === '23514' || code === '23P01') {
    return new ThreadlineError('internal_error', 'The database rejected the statement.', {
      stage,
      sqlState: code,
    });
  }
  return new ThreadlineError('storage_unavailable', 'A required database operation failed.', {
    stage,
    errorName: name,
    // Without these, an undefined column, a permission failure and a dropped
    // connection are indistinguishable from one another at the call site.
    ...(code === undefined ? {} : { sqlState: code }),
  });
}

// Driver messages can contain SQL values or credentials; expose SQLSTATE only.
function readPgCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
/**
 * Serializes a human command admission against a worker release.
 *
 * Both paths take the same transaction-scoped advisory lock for the project, so
 * an accepted human change cannot land between a worker's authority recheck and
 * its dependent effect. This is deliberately narrow: it is a release barrier,
 * not the M07 requirement-change pipeline.
 *
 * The lock is transaction-scoped, so it is always released — including on
 * rollback — and can never strand a connection.
 */
/**
 * The one key both human admission and worker release must hold.
 *
 * Exported so the human-command path and the worker-release path cannot drift
 * onto different keys and silently stop serializing against each other.
 */
export function projectAdmissionLockKey(tenantId: string, projectId: string): string {
  return `threadline:project-admission:${tenantId}:${projectId}`;
}

/**
 * Serializes one task's checkpoint read/merge/revision allocation/publication.
 *
 * Taken as a transaction-scoped advisory lock keyed on the task, so two
 * concurrent patches cannot both read the same current revision and each stage
 * a replacement that overwrites the other. The lock is transaction-scoped, so a
 * failure releases it and no connection is stranded.
 */
export async function withTaskCheckpointLock<TResult>(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  taskId: string,
  work: (tx: TxClient) => Promise<TResult>,
): Promise<TResult> {
  return db.withTenantTransaction(tenantId, async (tx) => {
    await tx.rows("SET LOCAL lock_timeout = '2s'");
    await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `threadline:task-checkpoint:${tenantId}:${projectId}:${taskId}`,
    ]);
    return work(tx);
  });
}

export async function withProjectAdmissionLock<TResult>(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  work: (tx: TxClient) => Promise<TResult>,
): Promise<TResult> {
  return db.withTenantTransaction(tenantId, async (tx) => {
    await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      projectAdmissionLockKey(tenantId, projectId),
    ]);
    return work(tx);
  });
}
