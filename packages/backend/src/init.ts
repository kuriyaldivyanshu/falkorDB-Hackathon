import { chmodSync, closeSync, mkdirSync, openSync, writeSync } from 'node:fs';

import { ConfigurationError, ThreadlineError, type ConfigurationIssue } from '@threadline/shared';

import { loadServiceConfig, storageConfigured, type ServiceConfig } from './config.js';
import { installationPaths, resolveHomeDirectory, type EnvironmentMap } from './environment.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { bootstrapLocalOwner } from './service/bootstrap.js';
import { createSourceFileStore } from './storage/files.js';
import { createGraphStore, startGraphStore } from './storage/graph.js';
import { assertPrivilegedFunctionOwners, ensureMemorySchema, type SchemaStatus } from './storage/migrate.js';
import { assertTenantFenceEnforceable, createSqlDatabase } from './storage/pg.js';

/**
 * Explicit installation setup.
 *
 * This is the only path that writes configuration and applies the new schema.
 * It never touches the retired owned-execution schema, never resets a database
 * and never installs native configuration. `serve` stays read-only on setup:
 * a service that starts without an initialized installation reports its stores
 * unavailable instead of creating them.
 */

export interface InitReport {
  readonly home: string;
  readonly schema: SchemaStatus;
  readonly graphReachable: boolean;
  readonly sourcesWritable: boolean;
  readonly owner: { readonly tenantId: string; readonly principalId: string; readonly created: boolean };
  readonly credentialPath: string;
  readonly configPath: string;
  readonly secretsPath: string;
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

export async function initializeInstallation(deps: InitDeps = {}): Promise<InitReport> {
  const logger = deps.logger ?? silentLogger;
  const home = resolveHomeDirectory(deps.home);
  const paths = installationPaths(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });

  const loaded = loadServiceConfig(home, deps.env);
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
  try {
    await db.ping();
    schema = await ensureMemorySchema({
      db,
      migrationDb,
      postgres: loaded.config.postgres,
      logger,
    });
    await assertTenantFenceEnforceable(db);
    // The fence check above covers ordinary access. The cross-tenant functions
    // are the privileged half of the same model, so setup verifies their owners
    // rather than discovering an empty claim later.
    await assertPrivilegedFunctionOwners(db);

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

  logger.log({
    level: 'info',
    message: 'Installation initialized.',
    fields: {
      home,
      schemaVersion: schema.version,
      roleVerified: schema.roleVerified,
      graphReachable,
      sourcesWritable,
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
