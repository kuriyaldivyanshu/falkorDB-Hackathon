import { assertSafeText } from './service/admission.js';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';

import { ConfigurationError, ThreadlineError, type ConfigurationIssue } from '@threadline/shared';

import type { ServiceConfig } from './config.js';
import { loadServiceConfig, storageConfigured } from './config.js';
import { installationPaths, resolveHomeDirectory, type EnvironmentMap, type InstallationPaths } from './environment.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { bootstrapLocalOwner } from './service/bootstrap.js';
import { createSourceFileStore } from './storage/files.js';
import { createGraphStore, startGraphStore } from './storage/graph.js';
import {
  assertPrivilegedFunctionOwners,
  ensureMemorySchema,
  readSchemaStatus,
  type SchemaStatus,
} from './storage/migrate.js';
import { assertTenantFenceEnforceable, createSqlDatabase } from './storage/pg.js';

/**
 * Explicit installation setup.
 *
 * This is the only path that writes configuration and applies the new schema. It
 * never touches the retired owned-execution schema, never resets a database and
 * never installs native configuration. `serve` stays read-only on setup: a
 * service that starts without an initialized installation reports its stores
 * unavailable instead of creating them.
 *
 * ## Order of operations
 *
 * Setup writes nothing until it has **proved the target**. The previous order
 * wrote `config.json` and `secrets.json` first and validated the database
 * afterwards, which meant a setup aimed at the wrong root — or one whose
 * credentials were wrong — overwrote a working installation's configuration and
 * secrets before failing, leaving that installation unable to start.
 *
 * The order is now:
 *
 * 1. resolve the root and the configuration, and refuse an unconfigured target;
 * 2. connect with the *incoming* credentials and read the schema, the tenant
 *    fence — all read-only; privileged function ownership follows migrations;
 * 3. check whether this root already holds an installation, and refuse unless
 *    this setup is authorized to write into it (see
 *    {@link assertInstallationTarget});
 * 4. probe graph connectivity;
 * 5. apply migrations, probe source storage and create the local owner identity;
 * 6. and only then write the configuration and secrets.
 *
 * Configuration/identity refusals happen before mutations. Migrations and owner
 * bootstrap are not one transaction with the filesystem; failures after that
 * boundary can leave database/source changes, while config/secrets remain intact.
 */

/**
 * The explicit authorization required to repoint an existing installation.
 *
 * Replacing an installation's storage target is destructive in a way that is not
 * obvious from the command line: the previous configuration and secrets are
 * lost, and the sources under that root no longer match the database it now
 * points at. It therefore needs a named, deliberate signal rather than being
 * inferred from the presence of environment variables.
 *
 * The value must be exactly `true`; anything else, including an unset variable,
 * means "not authorized". This is read from the environment only, because the
 * CLI surface is owned elsewhere and setup must not grow a flag the rest of the
 * product cannot see.
 */
export const REPLACE_INSTALLATION_ENV_KEY = 'THREADLINE_REPLACE_INSTALLATION';

export interface InitReport {
  readonly home: string;
  readonly schema: SchemaStatus;
  readonly graphReachable: boolean;
  readonly sourcesWritable: boolean;
  readonly owner: { readonly tenantId: string; readonly principalId: string; readonly created: boolean };
  readonly credentialPath: string;
  readonly configPath: string;
  readonly secretsPath: string;
  /** True when an existing installation's configuration was replaced. */
  readonly replacedInstallation: boolean;
}

export interface InitDeps {
  readonly home?: string;
  readonly env?: EnvironmentMap;
  readonly clock?: () => Date;
  readonly logger?: Logger;
  /** Injected by focused checks; production opens the configured database. */
  readonly database?: ReturnType<typeof createSqlDatabase>;
  readonly migrationDb?: ReturnType<typeof createSqlDatabase>;
}

/**
 * The storage identity an installation is bound to.
 *
 * This is what makes one installation distinguishable from another: two setups
 * that resolve the same database, graph and roles are initializing the same
 * installation, and one that resolves a different one is aiming at someone
 * else's.
 */
interface StorageIdentity {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly migrationUser: string;
  readonly applicationRole: string;
  readonly ssl: string;
  readonly graphHost: string;
  readonly graphPort: number;
  readonly graphUsername: string;
}

/** Extracts the configured database, role and graph targets for installation comparison. */
function storageIdentityOf(config: ServiceConfig): StorageIdentity {
  return {
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    migrationUser: config.postgres.migrationUser,
    applicationRole: config.postgres.applicationRole,
    ssl: config.postgres.ssl,
    graphHost: config.falkordb.host,
    graphPort: config.falkordb.port,
    graphUsername: config.falkordb.username,
  };
}

/**
 * Reads the identity an existing installation is bound to, or `null` when the
 * file is absent. An unreadable or unrecognised file returns `null` with
 * `unreadable`, which is treated as an installation that must not be replaced
 * without authorization: this build cannot prove what such an installation
 * points at, and "cannot prove" is not "safe to overwrite".
 */
function readStoredIdentity(
  paths: InstallationPaths,
): { readonly identity: StorageIdentity | null; readonly unreadable: boolean } {
  let text: string;
  try {
    text = readFileSync(paths.configFile, 'utf8');
  } catch (error) {
    const absent = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    return { identity: null, unreadable: !absent };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { identity: null, unreadable: true };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { identity: null, unreadable: true };
  }
  const file = parsed as {
    host?: unknown;
    port?: unknown;
    postgres?: Record<string, unknown> | undefined;
    falkordb?: Record<string, unknown> | undefined;
  };
  const pg = file.postgres;
  const falkordb = file.falkordb;
  const required = [
    file.host, file.port,
    pg?.host, pg?.port, pg?.database, pg?.user, pg?.migrationUser,
    pg?.applicationRole, pg?.ssl,
    falkordb?.host, falkordb?.port,
  ];
  if (required.some((value) => value === undefined)) {
    return { identity: null, unreadable: true };
  }
  return {
    unreadable: false,
    identity: {
      host: String(pg?.host),
      port: Number(pg?.port),
      database: String(pg?.database),
      user: String(pg?.user),
      migrationUser: String(pg?.migrationUser),
      applicationRole: String(pg?.applicationRole),
      ssl: String(pg?.ssl),
      graphHost: String(falkordb?.host),
      graphPort: Number(falkordb?.port),
      graphUsername: typeof falkordb?.username === 'string' ? String(falkordb.username) : '',
    },
  };
}

/** The differences that make two setups point at different installations. */
function identityDifferences(
  existing: StorageIdentity,
  incoming: StorageIdentity,
): readonly string[] {
  const fields: readonly (keyof StorageIdentity)[] = [
    'host', 'port', 'database', 'user', 'migrationUser', 'applicationRole', 'ssl',
    'graphHost', 'graphPort', 'graphUsername',
  ];
  return fields.filter((field) => existing[field] !== incoming[field]).map((field) => field);
}

/**
 * Decides whether this setup may write into an installation root.
 *
 * Three cases, and only three:
 *
 * - **No `config.json`.** This is a fresh root. Setup owns it.
 * - **`config.json` bound to the same storage identity.** This is the same
 *   installation. Re-running setup is legitimate and stays legitimate:
 *   migrations are idempotent, the application role's password is never
 *   rewritten by the migration runner, and config.json and secrets are rewritten
 *   from the incoming values after setup succeeds.
 * - **Anything else.** The root holds an installation this setup was not aimed
 *   at, or one whose configuration cannot be read. Refuse, naming both targets.
 *   Writing here would repoint someone else's installation and lose their
 *   secrets, which is exactly the failure this check exists to prevent.
 *
 * The refusal is a `ConfigurationError` so it is reported as a configuration
 * problem rather than as a storage outage, with the exact environment variable
 * that authorizes the replacement.
 */
function assertInstallationTarget(
  paths: InstallationPaths,
  incoming: StorageIdentity,
  env: EnvironmentMap,
): { readonly replacing: boolean } {
  const stored = readStoredIdentity(paths);
  if (stored.identity === null && !stored.unreadable) {
    return { replacing: false };
  }
  const authorized = env[REPLACE_INSTALLATION_ENV_KEY] === 'true';
  if (stored.unreadable) {
    if (authorized) {
      return { replacing: true };
    }
    throw new ConfigurationError([
      {
        field: 'installation',
        problem: `existing config is unreadable; use the intended --home or explicitly set ${REPLACE_INSTALLATION_ENV_KEY}=true`,
        hint: `This build cannot prove which database that installation uses, so it will not overwrite it. Set ${REPLACE_INSTALLATION_ENV_KEY}=true to replace it deliberately.`,
      },
    ]);
  }
  const differences = identityDifferences(stored.identity as StorageIdentity, incoming);
  if (differences.length === 0) {
    return { replacing: false };
  }
  if (!authorized) {
    throw new ConfigurationError([
      {
        field: 'installation',
        problem: `existing target differs in ${differences.join(', ')}; use the intended --home or explicitly set ${REPLACE_INSTALLATION_ENV_KEY}=true`,
        hint:
          `These differ in: ${differences.join(', ')}. Replacing an existing installation's storage target loses its ` +
          `configuration and secrets, so it is not done implicitly. Set ${REPLACE_INSTALLATION_ENV_KEY}=true to ` +
          `replace it deliberately, or point --home / ${'THREADLINE_HOME'} at the intended installation root.`,
      },
    ]);
  }
  return { replacing: true };
}

/** Validates the installation target, prepares storage and then persists configuration and credentials. */
export async function initializeInstallation(deps: InitDeps = {}): Promise<InitReport> {
  const logger = deps.logger ?? silentLogger;
  const env = deps.env ?? process.env;
  const home = resolveHomeDirectory(deps.home);
  const paths = installationPaths(home);

  const loaded = loadServiceConfig(home, env);
  assertSafeText(loaded.config.ownerLabel);
  const issues: ConfigurationIssue[] = [];
  if (!storageConfigured(loaded.config)) {
    issues.push({
      field: 'THREADLINE_PG_DATABASE',
      problem: 'a database, application user and password are required before setup.',
      hint:
        'Set THREADLINE_PG_DATABASE, THREADLINE_PG_USER and THREADLINE_PG_PASSWORD (and THREADLINE_PG_MIGRATION_USER/PASSWORD for schema application), then re-run `threadline init`.',
    });
  }
  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  const db = deps.database ?? createSqlDatabase({ config: loaded.config.postgres, logger });
  const migrationDb =
    deps.migrationDb ??
    (loaded.config.postgres.migrationUser.length > 0 && loaded.config.postgres.migrationUser !== loaded.config.postgres.user
      ? createSqlDatabase({
          config: {
            ...loaded.config.postgres,
            user: loaded.config.postgres.migrationUser,
            password: loaded.config.postgres.migrationPassword,
          },
          logger,
        })
      : db);

  let graphReachable = false;
  let sourcesWritable = false;
  let schema: SchemaStatus;
  let owner: InitReport['owner'];
  let replacing = false;
  try {
    // ---- 2. prove the incoming credentials, read-only -----------------------
    await db.ping();
    const observed = await readSchemaStatus({ db, postgres: loaded.config.postgres });
    if (observed.state === 'incompatible') {
      throw new ThreadlineError(
        'storage_unavailable',
        'The database is on a newer schema version than this build; setup will not touch it.',
        { version: observed.version, expectedVersion: observed.expectedVersion },
      );
    }
    // Reads `pg_roles` only, so it is safe before the schema exists.
    await assertTenantFenceEnforceable(db);
    // The cross-tenant function owners are deliberately *not* checked here: on a
    // fresh database those functions do not exist yet, and asking before the
    // migration that creates them would refuse a legitimate first install. The
    // check runs below, immediately after the schema is applied.

    // ---- 3. is this setup allowed to write into this root? -------------------
    replacing = assertInstallationTarget(paths, storageIdentityOf(loaded.config), env).replacing;
    if (replacing) {
      logger.log({
        level: 'warn',
        message: 'Replacing an existing installation because it was explicitly authorized.',
        fields: { home, authorizedBy: REPLACE_INSTALLATION_ENV_KEY },
      });
    }

    // ---- 4. probe the other two stores, still no writes --------------------
    const graphStore = createGraphStore({ config: loaded.config.falkordb, logger });
    try {
      await startGraphStore(graphStore);
      graphReachable = true;
    } catch (error) {
      logger.log({
        level: 'warn',
        message: 'FalkorDB is not reachable; source history works and graph admission stays pending.',
        fields: { errorName: error instanceof Error ? error.name : typeof error },
      });
    } finally {
      await graphStore.close().catch(() => undefined);
    }

    // ---- 5. now the installation is authorized: migrate and own ------------
    schema = await ensureMemorySchema({
      db,
      migrationDb,
      postgres: loaded.config.postgres,
      logger,
    });
    // The privileged half of the privilege model, verified now that the
    // functions exist, so a later claim can never come back empty.
    await assertPrivilegedFunctionOwners(db);

    const files = createSourceFileStore({ root: paths.sourceRoot, logger });
    sourcesWritable = await files.probe();

    const bootstrap = await bootstrapLocalOwner({
      db,
      credentialPath: paths.credentialFile,
      ownerLabel: loaded.config.ownerLabel,
      clock: deps.clock,
      logger,
    });
    owner = {
      tenantId: bootstrap.credential.tenantId,
      principalId: bootstrap.credential.principalId,
      created: bootstrap.created,
    };
  } finally {
    if (migrationDb !== db) {
      await migrationDb.close().catch(() => undefined);
    }
    await db.close().catch(() => undefined);
  }

  // ---- 6. and only now does the installation's own configuration change ----
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeJsonFile(paths.configFile, publicConfigFile(loaded.config), 0o600);
  writeJsonFile(
    paths.secretsFile,
    {
      postgresPassword: loaded.config.postgres.password,
      postgresMigrationPassword: loaded.config.postgres.migrationPassword,
      falkordbPassword: loaded.config.falkordb.password,
    },
    0o600,
  );

  logger.log({
    level: 'info',
    message: 'Installation initialized.',
    fields: {
      home,
      schemaVersion: schema.version,
      roleVerified: schema.roleVerified,
      graphReachable,
      sourcesWritable,
      replacedInstallation: replacing,
    },
  });
  return {
    home,
    schema,
    graphReachable,
    sourcesWritable,
    owner,
    credentialPath: paths.credentialFile,
    configPath: paths.configFile,
    secretsPath: paths.secretsFile,
    replacedInstallation: replacing,
  };
}

/** The loggable, non-secret configuration that is written back to the home. */
function publicConfigFile(config: ServiceConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      migrationUser: config.postgres.migrationUser,
      applicationRole: config.postgres.applicationRole,
      ssl: config.postgres.ssl,
    },
    falkordb: {
      host: config.falkordb.host,
      port: config.falkordb.port,
      username: config.falkordb.username,
    },
    ownerLabel: config.ownerLabel,
  };
}

/** Writes owner-protected JSON, updating permissions when the file already exists. */
function writeJsonFile(path: string, value: unknown, mode: number): void {
  try {
    const descriptor = openSync(path, 'w', mode);
    try {
      writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(path, mode);
  } catch (error) {
    throw new ThreadlineError('storage_unavailable', 'Could not write an installation file.', {
      reason: error instanceof Error ? error.name : typeof error,
    });
  }
}