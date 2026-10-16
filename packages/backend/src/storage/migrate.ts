import { ThreadlineError } from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { sha256Hex } from './digest.js';
import { CORE_BOOTSTRAP_SQL, CORE_BOOTSTRAP_VERSION, SCHEMA_MIGRATIONS_SQL } from './sql.js';
import type { SqlDatabase } from './pg.js';

/**
 * Versioned schema bootstrap.
 *
 * Three states are distinguished and never conflated:
 *
 * - `applied`: a row exists for this store/version and the checksum matches.
 * - `unapplied`: no row exists. The migration body runs inside one transaction
 *   that also writes the bookkeeping row, so a failure leaves no partial schema
 *   and no false record.
 * - `incompatible`: a row exists with a different checksum. This build refuses
 *   to continue rather than guess which schema is present.
 *
 * An ordinary restart takes the `applied` path and never re-runs DDL.
 */

export const MIGRATION_STORE_POSTGRES = 'postgres';

export type SchemaStatus =
  | { readonly state: 'unconfigured' }
  | { readonly state: 'unapplied'; readonly version: number }
  | { readonly state: 'applied'; readonly version: number; readonly appliedAt: string }
  | { readonly state: 'incompatible'; readonly expected: string; readonly recorded: string };

export interface MigrationDeps {
  /** Used only to read `schema_migrations`. */
  readonly db: SqlDatabase;
  /** Schema owner connection used for DDL and grants. */
  readonly migrationDb: SqlDatabase;
  /** Optional non-owner role to grant table privileges to after applying. */
  readonly applicationRole?: string;
  readonly logger?: Logger;
}

export interface MigrationReport {
  readonly status: SchemaStatus;
  readonly durationMs: number;
}

export function coreBootstrapChecksum(): string {
  return sha256Hex(CORE_BOOTSTRAP_SQL);
}

/**
 * Reads migration bookkeeping. Safe to run as the application identity once
 * the schema exists; `schema_migrations` has no row-level security.
 */
export async function readSchemaStatus(db: Pick<SqlDatabase, 'query'>): Promise<SchemaStatus> {
  const rows = await db.query<{ version: number; checksum: string; applied_at: Date }>(
    `SELECT version, checksum, applied_at
       FROM threadline.schema_migrations
      WHERE store = $1 AND version = $2`,
    [MIGRATION_STORE_POSTGRES, CORE_BOOTSTRAP_VERSION],
  );
  const row = rows[0];
  if (row === undefined) {
    return { state: 'unapplied', version: CORE_BOOTSTRAP_VERSION };
  }
  const expected = coreBootstrapChecksum();
  const recorded = row.checksum.trim();
  if (recorded !== expected) {
    return { state: 'incompatible', expected, recorded };
  }
  return {
    state: 'applied',
    version: row.version,
    appliedAt: row.applied_at.toISOString(),
  };
}

/**
 * Applies the core bootstrap when it is genuinely unapplied.
 *
 * `ensureBookkeeping` runs outside the migration transaction so that a failed
 * bootstrap still leaves `schema_migrations` present and queryable.
 */
export async function ensureCoreSchema(deps: MigrationDeps): Promise<MigrationReport> {
  const logger = deps.logger ?? silentLogger;
  const startedAt = Date.now();

  // DDL runs on the owner connection. The application identity is deliberately
  // not given CREATE on the schema, so it cannot apply migrations at all.
  await deps.migrationDb.withTransaction(async (client) => {
    await client.rows('SELECT pg_advisory_xact_lock(73010402)');
    await client.rows('SET LOCAL search_path = threadline, pg_catalog');
    await client.rows(SCHEMA_MIGRATIONS_SQL);
  });

  const current = await readSchemaStatus(deps.migrationDb);
  if (current.state === 'applied') {
    logger.log({
      level: 'info',
      message: 'Core schema already applied; startup will not re-run DDL.',
      fields: { version: current.version },
    });
    await hardenSessions(deps);
    await migrateModelAttemptFacts(deps);
    await grantApplicationPrivileges(deps);
    return { status: current, durationMs: Date.now() - startedAt };
  }
  if (current.state === 'incompatible') {
    throw new ThreadlineError(
      'schema_incompatible',
      'The recorded core schema checksum does not match this build.',
      {
        expectedVersion: CORE_BOOTSTRAP_VERSION,
        expectedChecksum: current.expected,
        recordedChecksum: current.recorded,
      },
    );
  }

  logger.log({
    level: 'info',
    message: 'Applying core bootstrap migration.',
    fields: { version: CORE_BOOTSTRAP_VERSION },
  });

  await deps.migrationDb.withTransaction(async (client) => {
    await client.rows('SELECT pg_advisory_xact_lock(73010402)');
    const locked = await readSchemaStatus({ query: client.rows });
    if (locked.state === 'applied') return;
    if (locked.state === 'incompatible') {
      throw new ThreadlineError('schema_incompatible','The recorded core schema checksum does not match this build.', {
        expectedVersion: CORE_BOOTSTRAP_VERSION, expectedChecksum: locked.expected, recordedChecksum: locked.recorded,
      });
    }
    await client.rows('SET LOCAL search_path = threadline, pg_catalog');
    await client.rows(CORE_BOOTSTRAP_SQL);
    await client.rows(
      `INSERT INTO threadline.schema_migrations (id, store, version, checksum)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [MIGRATION_STORE_POSTGRES, CORE_BOOTSTRAP_VERSION, coreBootstrapChecksum()],
    );
  });

  await hardenSessions(deps);
    await migrateModelAttemptFacts(deps);
  await grantApplicationPrivileges(deps);

  const applied = await readSchemaStatus(deps.migrationDb);
  if (applied.state !== 'applied') {
    throw new ThreadlineError(
      'schema_incompatible',
      'The core migration reported success but no applied row is visible.',
    );
  }
  logger.log({
    level: 'info',
    message: 'Core bootstrap migration applied.',
    fields: { version: CORE_BOOTSTRAP_VERSION, durationMs: Date.now() - startedAt },
  });
  return { status: applied, durationMs: Date.now() - startedAt };
}
/**
 * Grants the non-owner application role its table privileges.
 *
 * Identifiers cannot be bound as parameters, so the role name is validated
 * against a strict pattern and quoted. An unknown role is reported rather than
 * silently skipped: a migration that applies but grants nothing would leave the
 * application failing later with an opaque permission error.
 */
async function grantApplicationPrivileges(deps: MigrationDeps): Promise<void> {
  const role = deps.applicationRole ?? '';
  if (role.length === 0) {
    return;
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new ThreadlineError(
      'schema_incompatible',
      'The configured PostgreSQL application role is not a plain lower-case identifier.',
      { applicationRole: role },
    );
  }
  await deps.migrationDb.withTransaction(async (client) => {
    await client.rows('SELECT pg_advisory_xact_lock(73010402)');
    await client.rows('SET LOCAL search_path = threadline, pg_catalog');
    await client.rows(`GRANT USAGE ON SCHEMA threadline TO "${role}"`);
    await client.rows(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA threadline TO "${role}"`);
    await client.rows(`REVOKE INSERT, UPDATE, DELETE ON threadline.schema_migrations FROM "${role}"`);
    await client.rows(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA threadline TO "${role}"`);
    await client.rows(
      `GRANT EXECUTE ON FUNCTION threadline.session_by_token_hash(char(64)) TO "${role}"`,
    );
  });
}

// Version 1 remains immutable. Existing installations receive a checksummed additive patch.
const SESSION_HARDENING_SQL = `CREATE OR REPLACE FUNCTION threadline.session_by_token_hash(p_token_hash char(64))
RETURNS TABLE(session_id uuid,tenant_id uuid,user_id uuid,display_name text,tenant_slug text,expires_at timestamptz,idle_expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = threadline, pg_catalog AS $$
 SELECT s.id,s.tenant_id,s.user_id,u.display_name,t.slug,s.expires_at,s.idle_expires_at
 FROM threadline.user_sessions s JOIN threadline.users u ON u.id=s.user_id
 JOIN threadline.tenants t ON t.id=s.tenant_id
 JOIN threadline.tenant_memberships tm ON tm.tenant_id=s.tenant_id AND tm.user_id=s.user_id
 WHERE s.token_hash=p_token_hash AND s.revoked_at IS NULL AND u.status='active' AND t.status='active' AND tm.status='active'
$$;
REVOKE ALL ON FUNCTION threadline.session_by_token_hash(char(64)) FROM PUBLIC;`;
async function hardenSessions(deps: MigrationDeps): Promise<void> {
 await deps.migrationDb.withTransaction(async tx => {
  await tx.rows('SELECT pg_advisory_xact_lock(73010402)');
  const checksum = sha256Hex(SESSION_HARDENING_SQL);
  const rows = await tx.rows<{checksum:string}>("SELECT checksum FROM threadline.schema_migrations WHERE store='postgres' AND version=2");
  if (rows[0]) {
   if(rows[0].checksum.trim()!==checksum) throw new ThreadlineError('schema_incompatible','Session migration checksum differs.');
   return;
  }
  await tx.rows(SESSION_HARDENING_SQL);
  await tx.rows("INSERT INTO threadline.schema_migrations(id,store,version,checksum) VALUES(gen_random_uuid(),'postgres',2,$1)",[checksum]);
 });
}

// Additive M02 facts. Never infer possible charge from a status string or lose
// an admitted reservation after a restart. Versions 1 and 2 remain byte-identical.
const MODEL_ATTEMPT_FACTS_SQL = `ALTER TABLE threadline.model_requests
 ADD COLUMN possible_charge boolean,
 ADD COLUMN reserved_tokens bigint CHECK (reserved_tokens >= 0);`;
async function migrateModelAttemptFacts(deps: MigrationDeps): Promise<void> {
  await deps.migrationDb.withTransaction(async tx => {
    await tx.rows('SELECT pg_advisory_xact_lock(73010402)');
    const checksum = sha256Hex(MODEL_ATTEMPT_FACTS_SQL);
    const rows = await tx.rows<{ checksum: string }>(
      "SELECT checksum FROM threadline.schema_migrations WHERE store='postgres' AND version=3");
    if (rows[0]) {
      if (rows[0].checksum.trim() !== checksum)
        throw new ThreadlineError('schema_incompatible', 'Model-attempt migration checksum differs.');
      return;
    }
    await tx.rows(MODEL_ATTEMPT_FACTS_SQL);
    await tx.rows("INSERT INTO threadline.schema_migrations(id,store,version,checksum) VALUES(gen_random_uuid(),'postgres',3,$1)", [checksum]);
  });
}
