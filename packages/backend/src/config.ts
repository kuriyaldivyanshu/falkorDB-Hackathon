import { readFileSync } from 'node:fs';

import { ConfigurationError, type ConfigurationIssue } from '@threadline/shared';

import { installationPaths, type EnvironmentMap, type InstallationPaths } from './environment.js';

/**
 * Memory-service configuration.
 *
 * Everything here is enforced by real code: a limit nothing applies is not a
 * limit. There is no provider key, model, run or inference setting, because
 * Threadline performs no inference. Credentials live in an owner-only secrets
 * file inside the installation root and are never part of the loggable config.
 */

export interface ServiceLimits {
  /** Maximum accepted HTTP request body. */
  readonly maxRequestBodyBytes: number;
  /** Bounded concurrent operations in the graph/commit worker. */
  readonly workerSlots: number;
  /** Worker poll interval when the queue is empty. */
  readonly workerPollMs: number;
  /** Lease duration for a claimed operation. */
  readonly operationLeaseMs: number;
}

export interface PostgresConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /**
   * Application identity. It must not be a superuser and must not hold
   * BYPASSRLS, or the tenant fence is decorative. Verified at startup.
   */
  readonly user: string;
  /** Never logged, never returned, never included in a digest. */
  readonly password: string;
  /** Schema/role owner used only to apply migrations. */
  readonly migrationUser: string;
  readonly migrationPassword: string;
  /** Role the migration grants table privileges to. */
  readonly applicationRole: string;
  readonly ssl: 'disable' | 'require';
  readonly connectTimeoutMs: number;
  readonly maxConnections: number;
}

export interface FalkorDbConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly connectTimeoutMs: number;
}

export const THREADLINE_SQL_SCHEMA = 'threadline_memory';

export interface ServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly paths: InstallationPaths;
  readonly limits: ServiceLimits;
  readonly postgres: PostgresConfig;
  readonly falkordb: FalkorDbConfig;
  /** Operator display label for the local owner principal. */
  readonly ownerLabel: string;
}

export interface ConfigSource {
  readonly env: EnvironmentMap;
  readonly home: string;
}

export const DEFAULT_LIMITS: ServiceLimits = {
  maxRequestBodyBytes: 8 * 1024 * 1024,
  workerSlots: 2,
  workerPollMs: 250,
  operationLeaseMs: 30_000,
};

export const DEFAULT_SERVICE_HOST = '127.0.0.1';
export const DEFAULT_SERVICE_PORT = 47_822;

const ENV_KEYS = {
  host: 'THREADLINE_HOST',
  port: 'THREADLINE_PORT',
  pgHost: 'THREADLINE_PG_HOST',
  pgPort: 'THREADLINE_PG_PORT',
  pgDatabase: 'THREADLINE_PG_DATABASE',
  pgUser: 'THREADLINE_PG_USER',
  pgPassword: 'THREADLINE_PG_PASSWORD',
  pgMigrationUser: 'THREADLINE_PG_MIGRATION_USER',
  pgMigrationPassword: 'THREADLINE_PG_MIGRATION_PASSWORD',
  pgApplicationRole: 'THREADLINE_PG_APPLICATION_ROLE',
  pgSsl: 'THREADLINE_PG_SSL',
  graphHost: 'THREADLINE_FALKORDB_HOST',
  graphPort: 'THREADLINE_FALKORDB_PORT',
  graphUsername: 'THREADLINE_FALKORDB_USERNAME',
  graphPassword: 'THREADLINE_FALKORDB_PASSWORD',
  ownerLabel: 'THREADLINE_OWNER_LABEL',
} as const;

export const CONFIG_ENV_KEYS = ENV_KEYS;

/** Non-secret settings written by `threadline init`. */
interface ConfigFileShape {
  readonly host?: unknown;
  readonly port?: unknown;
  readonly postgres?: {
    readonly host?: unknown;
    readonly port?: unknown;
    readonly database?: unknown;
    readonly user?: unknown;
    readonly migrationUser?: unknown;
    readonly applicationRole?: unknown;
    readonly ssl?: unknown;
  };
  readonly falkordb?: { readonly host?: unknown; readonly port?: unknown; readonly username?: unknown };
  readonly ownerLabel?: unknown;
}

export interface LoadedConfig {
  readonly config: ServiceConfig;
  /** Which parts came from the environment rather than the stored file. */
  readonly overriddenFields: readonly string[];
}

/**
 * Loads configuration from the installation root plus explicit overrides.
 *
 * A missing configuration file is not an error here: `threadline init` has to
 * be able to run before one exists, and `serve` reports the missing stores as
 * unavailable rather than inventing them.
 */
export function loadServiceConfig(home: string, env: EnvironmentMap = process.env): LoadedConfig {
  const paths = installationPaths(home);
  const file = readConfigFile(paths.configFile);
  const secrets = readSecretsFile(paths.secretsFile);
  const overridden: string[] = [];

  const pick = (envKey: string, fileValue: string | undefined, fallback: string): string => {
    const fromEnvironment = env[envKey];
    if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
      overridden.push(envKey);
      return fromEnvironment;
    }
    return fileValue ?? fallback;
  };
  const pickInteger = (
    envKey: string,
    fileValue: number | undefined,
    fallback: number,
    bounds: { min: number; max: number },
    issues: ConfigurationIssue[],
  ): number => {
    const raw = env[envKey];
    if (raw !== undefined && raw.length > 0) {
      overridden.push(envKey);
      return readInteger(raw, envKey, bounds, issues, fallback);
    }
    if (fileValue === undefined) {
      return fallback;
    }
    if (!Number.isInteger(fileValue) || fileValue < bounds.min || fileValue > bounds.max) {
      issues.push({
        field: `${paths.configFile}#${envKey}`,
        problem: `must be between ${String(bounds.min)} and ${String(bounds.max)}.`,
        hint: 'Re-run `threadline init` or fix the stored value.',
      });
      return fallback;
    }
    return fileValue;
  };

  const issues: ConfigurationIssue[] = [];
  const host = pick(ENV_KEYS.host, readString(file?.host), DEFAULT_SERVICE_HOST);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    issues.push({
      field: ENV_KEYS.host,
      problem: 'must be a loopback address.',
      hint: 'This service holds local credentials; bind 127.0.0.1.',
    });
  }

  const limitNumber = (envKey: string, fallback: number, bounds: { min: number; max: number }): number =>
    readInteger(env[envKey], envKey, bounds, issues, fallback);

  const limits: ServiceLimits = {
    maxRequestBodyBytes: limitNumber(
      'THREADLINE_MAX_REQUEST_BODY_BYTES',
      DEFAULT_LIMITS.maxRequestBodyBytes,
      { min: 1024, max: 64 * 1024 * 1024 },
    ),
    workerSlots: limitNumber('THREADLINE_WORKER_SLOTS', DEFAULT_LIMITS.workerSlots, { min: 1, max: 8 }),
    workerPollMs: limitNumber('THREADLINE_WORKER_POLL_MS', DEFAULT_LIMITS.workerPollMs, {
      min: 25,
      max: 10_000,
    }),
    operationLeaseMs: limitNumber('THREADLINE_OPERATION_LEASE_MS', DEFAULT_LIMITS.operationLeaseMs, {
      min: 1_000,
      max: 15 * 60 * 1000,
    }),
  };

  const sslRaw = pick(ENV_KEYS.pgSsl, readString(file?.postgres?.ssl), 'disable');
  if (sslRaw !== 'disable' && sslRaw !== 'require') {
    issues.push({
      field: ENV_KEYS.pgSsl,
      problem: 'must be "disable" or "require".',
      hint: 'Local Compose PostgreSQL uses "disable".',
    });
  }

  const postgres: PostgresConfig = {
    host: pick(ENV_KEYS.pgHost, readString(file?.postgres?.host), '127.0.0.1'),
    port: pickInteger(
      ENV_KEYS.pgPort,
      readNumber(file?.postgres?.port),
      55_432,
      { min: 1, max: 65_535 },
      issues,
    ),
    database: pick(ENV_KEYS.pgDatabase, readString(file?.postgres?.database), ''),
    user: pick(ENV_KEYS.pgUser, readString(file?.postgres?.user), ''),
    password: pick(ENV_KEYS.pgPassword, secrets.postgresPassword, ''),
    migrationUser: pick(ENV_KEYS.pgMigrationUser, readString(file?.postgres?.migrationUser), ''),
    migrationPassword: pick(
      ENV_KEYS.pgMigrationPassword,
      secrets.postgresMigrationPassword,
      '',
    ),
    applicationRole: pick(ENV_KEYS.pgApplicationRole, readString(file?.postgres?.applicationRole), ''),
    ssl: sslRaw === 'require' ? 'require' : 'disable',
    connectTimeoutMs: 5_000,
    maxConnections: readInteger(
      env['THREADLINE_PG_MAX_CONNECTIONS'],
      'THREADLINE_PG_MAX_CONNECTIONS',
      { min: 1, max: 64 },
      issues,
      8,
    ),
  };

  const falkordb: FalkorDbConfig = {
    host: pick(ENV_KEYS.graphHost, readString(file?.falkordb?.host), '127.0.0.1'),
    port: pickInteger(
      ENV_KEYS.graphPort,
      readNumber(file?.falkordb?.port),
      56_379,
      { min: 1, max: 65_535 },
      issues,
    ),
    username: pick(ENV_KEYS.graphUsername, readString(file?.falkordb?.username), ''),
    password: pick(ENV_KEYS.graphPassword, secrets.falkordbPassword, ''),
    connectTimeoutMs: 5_000,
  };

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return {
    config: {
      host,
      port: pickInteger(ENV_KEYS.port, readNumber(file?.port), DEFAULT_SERVICE_PORT, {
        min: 1,
        max: 65_535,
      }, issues),
      paths,
      limits,
      postgres,
      falkordb,
      ownerLabel: pick(ENV_KEYS.ownerLabel, readString(file?.ownerLabel), 'Local Owner'),
    },
    overriddenFields: overridden,
  };
}

/**
 * A store is configured only when it can actually be addressed.
 *
 * `safeParse`-style leniency would turn a missing database name into a
 * mysterious driver failure later; this reports it plainly instead.
 */
export function storageConfigured(config: ServiceConfig): boolean {
  return (
    config.postgres.database.length > 0 &&
    config.postgres.user.length > 0 &&
    config.postgres.password.length > 0
  );
}

function readConfigFile(path: string): ConfigFileShape | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed as ConfigFileShape;
  } catch {
    return null;
  }
}

function readSecretsFile(path: string): {
  postgresPassword: string;
  postgresMigrationPassword: string;
  falkordbPassword: string;
} {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return { postgresPassword: '', postgresMigrationPassword: '', falkordbPassword: '' };
    }
    const shape = parsed as Record<string, unknown>;
    return {
      postgresPassword: readString(shape.postgresPassword) ?? '',
      postgresMigrationPassword: readString(shape.postgresMigrationPassword) ?? '',
      falkordbPassword: readString(shape.falkordbPassword) ?? '',
    };
  } catch {
    return { postgresPassword: '', postgresMigrationPassword: '', falkordbPassword: '' };
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readInteger(
  raw: string | undefined,
  field: string,
  bounds: { min: number; max: number },
  issues: ConfigurationIssue[],
  fallback: number,
): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(raw.trim())) {
    issues.push({
      field,
      problem: 'must be a whole number.',
      hint: `Provide an integer between ${String(bounds.min)} and ${String(bounds.max)}.`,
    });
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (parsed < bounds.min || parsed > bounds.max) {
    issues.push({
      field,
      problem: `must be between ${String(bounds.min)} and ${String(bounds.max)}.`,
      hint: 'Lower or raise the value, or unset the variable to use the default.',
    });
    return fallback;
  }
  return parsed;
}

/**
 * The only representation of configuration that may be logged or returned.
 *
 * It is an explicit allowlist, so adding a credential field to `ServiceConfig`
 * cannot accidentally start exposing it. Passwords reduce to a boolean.
 */
export interface ServiceConfigSummary {
  readonly home: string;
  readonly host: string;
  readonly port: number;
  readonly limits: ServiceLimits;
  readonly postgres: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly applicationRole: string;
    readonly ssl: 'disable' | 'require';
    readonly passwordConfigured: boolean;
    readonly migrationUserConfigured: boolean;
  };
  readonly falkordb: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly passwordConfigured: boolean;
  };
}

export function describeConfig(config: ServiceConfig): ServiceConfigSummary {
  return {
    home: config.paths.home,
    host: config.host,
    port: config.port,
    limits: { ...config.limits },
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      applicationRole: config.postgres.applicationRole,
      ssl: config.postgres.ssl,
      passwordConfigured: config.postgres.password.length > 0,
      migrationUserConfigured: config.postgres.migrationUser.length > 0,
    },
    falkordb: {
      host: config.falkordb.host,
      port: config.falkordb.port,
      username: config.falkordb.username,
      passwordConfigured: config.falkordb.password.length > 0,
    },
  };
}
