import { ThreadlineError } from '@threadline/shared';

import type { PostgresConfig } from '../config.js';
import { THREADLINE_SQL_SCHEMA } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { sha256Hex } from './digest.js';
import { createSqlDatabase, toStorageError, type SqlDatabase } from './pg.js';
import { LATEST_SQL_SCHEMA_VERSION, MEMORY_SQL_MIGRATIONS } from './schema.js';

/**
 * Migration runner for schema `threadline_memory`.
 *
 * A new schema with its own ledger: this never touches the retired
 * owned-execution schema, never mutates an existing migration version and never
 * converts stored data. Applied versions are checksum-verified, so a migration
 * that changes after being applied is reported as an incompatible build rather
 * than silently re-run.
 *
 * The runner also provisions the restricted application role because the new
 * schema is useless without one: forced row-level security is only meaningful
 * for a role that cannot bypass it.
 */

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';
export const MIGRATION_LOCK_KEY = 'threadline:memory:migrations';

export interface SchemaStatus {
  readonly state: 'applied' | 'absent' | 'incompatible' | 'unconfigured';
  readonly version: number;
  readonly expectedVersion: number;
  readonly applicationRole: string;
  /** The application role exists and cannot bypass row-level security. */
  readonly roleVerified: boolean;
  readonly detail: string;
}

export interface EnsureSchemaDeps {
  readonly db: SqlDatabase;
  readonly migrationDb: SqlDatabase;
  readonly postgres: PostgresConfig;
  readonly logger?: Logger;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export async function ensureMemorySchema(deps: EnsureSchemaDeps): Promise<SchemaStatus> {
  const logger = deps.logger ?? silentLogger;
  const applicationRole = deps.postgres.applicationRole.trim().length > 0
    ? deps.postgres.applicationRole
    : deps.postgres.user;
  if (!IDENTIFIER.test(applicationRole)) {
    throw new ThreadlineError(
      'invalid_request',
      'The application role must be a plain lower-case PostgreSQL identifier.',
      { roleLength: applicationRole.length },
    );
  }

  const migrationRoles = await deps.migrationDb.query<{rolsuper:boolean;rolbypassrls:boolean}>(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if (!migrationRoles[0] || (!migrationRoles[0].rolsuper && !migrationRoles[0].rolbypassrls)) {
    throw new ThreadlineError('storage_unavailable','The migration role must be a superuser or have BYPASSRLS before cross-tenant reconciliation.');
  }
  await ensureApplicationRole(deps.migrationDb, deps.postgres, applicationRole, logger);

  await deps.migrationDb.withConnection(async (connection) => {
    // The session lock is held on one reserved connection and released in the
    // `finally`, so a crashed run cannot leave the ledger locked.
    await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_KEY]);
    try {
      // The migration user's own name matches the retired schema, so the
      // default search path would create these unqualified objects inside it.
      // Pin the path explicitly; the connection is discarded on release.
      await connection.query(`SET search_path TO ${THREADLINE_SQL_SCHEMA}, pg_temp`);
      await connection.query(`CREATE SCHEMA IF NOT EXISTS ${THREADLINE_SQL_SCHEMA}`);
      await connection.query(
        `CREATE TABLE IF NOT EXISTS ${THREADLINE_SQL_SCHEMA}.${SCHEMA_MIGRATIONS_TABLE} (
           version integer PRIMARY KEY,
           name text NOT NULL,
           checksum text NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );

      const applied = await connection.query<{ version: number; checksum: string }>(
        `SELECT version, checksum FROM ${THREADLINE_SQL_SCHEMA}.${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
      );
      const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));

      for (const migration of MEMORY_SQL_MIGRATIONS) {
        const checksum = migrationChecksum(migration.statements);
        const existing = appliedByVersion.get(migration.version);
        if (existing !== undefined) {
          if (existing.trim() !== checksum) {
            throw new ThreadlineError(
              'schema_incompatible',
              `Applied migration ${String(migration.version)} does not match this build's checksum.`,
              { version: migration.version },
            );
          }
          continue;
        }
        await connection.query('BEGIN');
        try {
          for (const statement of migration.statements) {
            await connection.query(statement);
          }
          await connection.query(
            `INSERT INTO ${THREADLINE_SQL_SCHEMA}.${SCHEMA_MIGRATIONS_TABLE} (version, name, checksum)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, checksum],
          );
          await connection.query('COMMIT');
          logger.log({
            level: 'info',
            message: 'Applied SQL migration.',
            fields: { version: migration.version, name: migration.name },
          });
        } catch (error) {
          await connection.query('ROLLBACK').catch(() => undefined);
          throw error instanceof ThreadlineError ? error : toStorageError(error, 'migration_apply');
        }
      }

      await grantToApplicationRole(connection, applicationRole);
    } finally {
      await connection
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  });

  const status = await readSchemaStatus({ db: deps.db, postgres: deps.postgres });
  if (status.state !== 'applied') {
    throw new ThreadlineError('storage_unavailable', 'The memory schema did not reach the applied state.', {
      state: status.state,
      version: status.version,
    });
  }
  return status;
}

export interface ReadSchemaDeps {
  readonly db: SqlDatabase;
  readonly postgres: PostgresConfig;
}

/**
 * Reads the ledger without applying anything.
 *
 * Readiness depends on this answer, so it is derived from the store rather than
 * from a successful start attempt.
 */
export async function readSchemaStatus(deps: ReadSchemaDeps): Promise<SchemaStatus> {
  const applicationRole = deps.postgres.applicationRole.trim().length > 0
    ? deps.postgres.applicationRole
    : deps.postgres.user;
  const roleVerified = await readRoleIsRestricted(deps.db, applicationRole);
  let version: number;
  try {
    const rows = await deps.db.query<{ version: number }>(
      `SELECT version FROM ${THREADLINE_SQL_SCHEMA}.${SCHEMA_MIGRATIONS_TABLE} ORDER BY version DESC LIMIT 1`,
    );
    version = rows[0]?.version ?? 0;
  } catch (error) {
    if (error instanceof ThreadlineError && error.code === 'storage_unavailable') {
      return {
        state: 'absent',
        version: 0,
        expectedVersion: LATEST_SQL_SCHEMA_VERSION,
        applicationRole,
        roleVerified,
        detail: 'The threadline_memory schema is not present in this database.',
      };
    }
    throw error;
  }

  if (version === LATEST_SQL_SCHEMA_VERSION) {
    return {
      state: 'applied',
      version,
      expectedVersion: LATEST_SQL_SCHEMA_VERSION,
      applicationRole,
      roleVerified,
      detail: `Schema version ${String(version)} applied with forced row-level security.`,
    };
  }
  return {
    state: version > LATEST_SQL_SCHEMA_VERSION ? 'incompatible' : 'absent',
    version,
    expectedVersion: LATEST_SQL_SCHEMA_VERSION,
    applicationRole,
    roleVerified,
    detail:
      version > LATEST_SQL_SCHEMA_VERSION
        ? `The database is on schema version ${String(version)}, newer than this build expects.`
        : `The database is on schema version ${String(version)}; this build expects ${String(LATEST_SQL_SCHEMA_VERSION)}.`,
  };
}

/**
 * The functions that must cross the tenant fence without a tenant context.
 *
 * Each is `SECURITY DEFINER`, so it runs with its owner's privileges. Forced
 * row-level security applies to a table's owner as well, so a definer function
 * only sees rows when its owner is a superuser or holds `BYPASSRLS`. That is a
 * real privilege requirement, not an implementation detail: without it the
 * functions match no rows and authentication, claiming and backlog all fail
 * silently. These are the only names that may hold that privilege.
 */
export const PRIVILEGED_FUNCTIONS = ['token_lookup', 'claim_operations', 'operation_backlog', 'pending_evidence_publications'] as const;

export interface PrivilegedFunctionOwner {
  readonly functionName: string;
  readonly owner: string;
  /** The owner can see rows through forced row-level security. */
  readonly ownerBypassesRls: boolean;
}

export interface PrivilegedFunctionReport {
  readonly ready: boolean;
  /** True when every function exists and its owner can bypass the fence. */
  readonly owners: readonly PrivilegedFunctionOwner[];
  /** Function names that are missing from the schema entirely. */
  readonly missing: readonly string[];
  readonly detail: string;
}

/**
 * Reads which role owns each cross-tenant function and whether that role can
 * bypass forced row-level security.
 *
 * Answers a report rather than throwing, so a caller can both refuse to claim
 * durability and state exactly what is wrong.
 */
export async function readPrivilegedFunctionOwners(db: SqlDatabase): Promise<PrivilegedFunctionReport> {
  let rows: readonly {
    proname: string;
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }[];
  try {
    rows = await db.query<{ proname: string; rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT p.proname, r.rolname, r.rolsuper, r.rolbypassrls
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
      [THREADLINE_SQL_SCHEMA, [...PRIVILEGED_FUNCTIONS]],
    );
  } catch (error) {
    return {
      ready: false,
      owners: [],
      missing: [...PRIVILEGED_FUNCTIONS],
      detail:
        'The cross-tenant function ownership could not be read, so the privileged SQL path is unverified.',
    };
  }

  const owners: PrivilegedFunctionOwner[] = rows.map((row) => ({
    functionName: row.proname,
    owner: row.rolname,
    ownerBypassesRls: row.rolsuper || row.rolbypassrls,
  }));
  const present = new Set(owners.map((owner) => owner.functionName));
  const missing = PRIVILEGED_FUNCTIONS.filter((name) => !present.has(name));
  const blocked = owners.filter((owner) => !owner.ownerBypassesRls);

  if (missing.length > 0) {
    return {
      ready: false,
      owners,
      missing,
      detail: `The cross-tenant functions ${missing.join(', ')} are not present in schema ${THREADLINE_SQL_SCHEMA}; apply the schema with "threadline init".`,
    };
  }
  if (blocked.length > 0) {
    const named = blocked
      .map((owner) => `${owner.functionName} (owner ${owner.owner})`)
      .join(', ');
    return {
      ready: false,
      owners,
      missing,
      detail:
        `Forced row-level security applies to the function owner, so a ${'SECURITY DEFINER'} function whose owner ` +
        `cannot bypass it matches no rows: ${named}. Run "threadline init" with a migration role that is a ` +
        `superuser or holds BYPASSRLS; the application role must still be unable to bypass the fence.`,
    };
  }
  return {
    ready: true,
    owners,
    missing,
    detail:
      'Credential resolution, the leased claim and the backlog count run through the narrow cross-tenant functions, ' +
      `which are owned by ${[...new Set(owners.map((owner) => owner.owner))].join(', ')}.`,
  };
}

/**
 * Refuses a privilege configuration that cannot work.
 *
 * Setup calls this so an unsupported role layout is rejected with the offending
 * function and owner named, rather than surfacing later as an empty claim.
 */
export async function assertPrivilegedFunctionOwners(db: SqlDatabase): Promise<PrivilegedFunctionReport> {
  const report = await readPrivilegedFunctionOwners(db);
  if (!report.ready) {
    throw new ThreadlineError('storage_unavailable', report.detail, {
      missing: report.missing.join(', '),
      blocked: report.owners
        .filter((owner) => !owner.ownerBypassesRls)
        .map((owner) => `${owner.functionName}:${owner.owner}`)
        .join(', '),
    });
  }
  return report;
}

function migrationChecksum(statements: readonly string[]): string {
  return sha256Hex(statements.join('\n--\n'));
}

/**
 * Creates the application role when it is missing and verifies it cannot bypass
 * the tenant fence. An existing role's password is never rewritten.
 */
async function ensureApplicationRole(
  migrationDb: SqlDatabase,
  postgres: PostgresConfig,
  applicationRole: string,
  logger: Logger,
): Promise<void> {
  const existing = await migrationDb.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [applicationRole],
  );
  const role = existing[0];
  if (role === undefined) {
    if (postgres.password.length === 0) {
      throw new ThreadlineError(
        'invalid_request',
        'Creating the application role requires its password to be configured.',
      );
    }
    const statement = await migrationDb.query<{ statement: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS statement",
      [applicationRole, postgres.password],
    );
    const ddl = statement[0]?.statement;
    if (ddl === undefined) {
      throw new ThreadlineError('storage_unavailable', 'Could not build the application role statement.');
    }
    await migrationDb.query(ddl);
    logger.log({ level: 'info', message: 'Created the restricted application role.', fields: { applicationRole } });
    return;
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new ThreadlineError(
      'storage_unavailable',
      'The configured application role can bypass row-level security, so the tenant fence cannot be enforced.',
      { applicationRole },
    );
  }
}

async function readRoleIsRestricted(db: SqlDatabase, role: string): Promise<boolean> {
  try {
    const rows = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [role],
    );
    const row = rows[0];
    return row !== undefined && !row.rolsuper && !row.rolbypassrls;
  } catch {
    return false;
  }
}

/**
 * Grants exactly what the application role needs, on this schema only.
 *
 * The role has no privileges on the retired schema: it is created fresh for
 * this schema, and nothing here grants `USAGE` on any other namespace.
 */
async function grantToApplicationRole(connection: SqlDatabase, applicationRole: string): Promise<void> {
  await connection.query(`REVOKE ALL ON SCHEMA ${THREADLINE_SQL_SCHEMA} FROM PUBLIC`);
  await connection.query(`GRANT USAGE ON SCHEMA ${THREADLINE_SQL_SCHEMA} TO "${applicationRole}"`);
  await connection.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${THREADLINE_SQL_SCHEMA} TO "${applicationRole}"`,
  );
  await connection.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${THREADLINE_SQL_SCHEMA} TO "${applicationRole}"`,
  );
  await connection.query(
    `GRANT EXECUTE ON FUNCTION ${THREADLINE_SQL_SCHEMA}.token_lookup(text) TO "${applicationRole}"`,
  );
  await connection.query(
    `GRANT EXECUTE ON FUNCTION ${THREADLINE_SQL_SCHEMA}.claim_operations(integer, text, text, integer, text[]) TO "${applicationRole}"`,
  );
  await connection.query(
    `GRANT EXECUTE ON FUNCTION ${THREADLINE_SQL_SCHEMA}.operation_backlog() TO "${applicationRole}"`,
  );
  await connection.query(
    `GRANT EXECUTE ON FUNCTION ${THREADLINE_SQL_SCHEMA}.pending_evidence_publications() TO "${applicationRole}"`,
  );
  await connection.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${THREADLINE_SQL_SCHEMA}
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${applicationRole}"`,
  );
}

/** Creates the pooled application and migration databases for a run. */
export function createMemoryDatabases(
  postgres: PostgresConfig,
  logger: Logger,
): { readonly db: SqlDatabase; readonly migrationDb: SqlDatabase } {
  const db = createSqlDatabase({ config: postgres, logger });
  const migrationDb =
    postgres.migrationUser.length > 0
      ? createSqlDatabase({
          config: {
            ...postgres,
            user: postgres.migrationUser,
            password: postgres.migrationPassword,
          },
          logger,
        })
      : db;
  return { db, migrationDb };
}
