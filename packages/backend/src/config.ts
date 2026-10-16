import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { PROVIDERS, validateProviderBaseUrl, type ProviderApi, type ProviderId } from './provider/catalog.js';
import { ConfigurationError, type ConfigurationIssue } from '@threadline/shared';

/**
 * Declared, enforced limits for the M00 scaffold.
 *
 * Every limit here is applied by real code at this milestone. A limit that
 * nothing enforces is not a limit, so none are declared speculatively.
 */
export type BackendLimits = {
  /** Maximum simultaneous event subscribers. */
  readonly maxEventListeners: number;
  /** Maximum accepted HTTP request body, enforced by the HTTP server. */
  readonly maxRequestBodyBytes: number;
  /** Maximum accepted `development.echo` text length. */
  readonly maxCommandTextLength: number;
  /** Bytes handed to one SSE socket between flushes before it is closed. */
  readonly maxEventBacklogBytes: number;
};

export type BackendConfig = {
  readonly host: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly limits: BackendLimits;
  readonly storage: StorageConfig;
};

/**
 * Real store settings. Nothing here is defaulted into existence: a missing
 * database name in `required` mode is a configuration error, not a reason to
 * start with pretend memory.
 */
export type StorageConfig = {
  readonly mode: 'unconfigured' | 'required';
  readonly postgres: PostgresConfig;
  readonly falkordb: FalkorDbConfig;
  /** Stable local identifiers created by owner-only bootstrap. */
  readonly local: LocalIdentityConfig;
  /** Immutable artifact bytes live under this owner-only directory. */
  readonly artifactsDirectory: string;
  /**
   * Provider credential, read only in coordinator configuration and handed to
   * the driver privately. Never logged, returned, or written to SQL.
   */
  readonly providerId: ProviderId;
  readonly providerApi: ProviderApi;
  readonly providerApiKey: string;
  readonly providerModel: string;
  readonly providerBaseUrl: string;
};

export type PostgresConfig = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /**
   * The application identity. It must NOT be a superuser and must not hold
   * BYPASSRLS, or the tenant fence is decorative. Checked at startup.
   */
  readonly user: string;
  /** Never logged, never returned in a response, never included in a digest. */
  readonly password: string;
  /**
   * Optional schema-owner identity used only to apply and read migrations.
   * Absent means the application identity is also the owner, which is refused
   * when it can bypass row-level security.
   */
  readonly migrationUser: string;
  readonly migrationPassword: string;
  /**
   * Role the migration grants table privileges to, when the application
   * connects as a separate non-owner identity. Empty means "the application
   * identity already has the rights", which is refused if it can bypass RLS.
   */
  readonly applicationRole: string;
  readonly ssl: 'disable' | 'require';
  readonly connectTimeoutMs: number;
  readonly maxConnections: number;
};

export type FalkorDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly connectTimeoutMs: number;
  /** Bounds one graph write. Matches development-profile `graph_write_timeout_ms`. */
  readonly writeTimeoutMs: number;
};

export type LocalIdentityConfig = {
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly userDisplayName: string;
  readonly projectSlug: string;
  /** development-profile `local_auth.idle_expiry_hours`. */
  readonly idleExpiryMs: number;
  /** development-profile `local_auth.absolute_expiry_days`. */
  readonly absoluteExpiryMs: number;
};

export interface ConfigSource {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

const ENV_KEYS = {
  host: 'THREADLINE_HOST',
  port: 'THREADLINE_PORT',
  dataDirectory: 'THREADLINE_DATA_DIR',
  maxEventListeners: 'THREADLINE_MAX_EVENT_LISTENERS',
  maxRequestBodyBytes: 'THREADLINE_MAX_REQUEST_BODY_BYTES',
  maxCommandTextLength: 'THREADLINE_MAX_COMMAND_TEXT_LENGTH',
  maxEventBacklogBytes: 'THREADLINE_MAX_EVENT_BACKLOG_BYTES',
  storageMode: 'THREADLINE_STORAGE_MODE',
  pgHost: 'THREADLINE_PG_HOST',
  pgPort: 'THREADLINE_PG_PORT',
  pgDatabase: 'THREADLINE_PG_DATABASE',
  pgUser: 'THREADLINE_PG_USER',
  pgPassword: 'THREADLINE_PG_PASSWORD',
  pgMigrationUser: 'THREADLINE_PG_MIGRATION_USER',
  pgMigrationPassword: 'THREADLINE_PG_MIGRATION_PASSWORD',
  pgApplicationRole: 'THREADLINE_PG_APPLICATION_ROLE',
  pgSsl: 'THREADLINE_PG_SSL',
  pgConnectTimeoutMs: 'THREADLINE_PG_CONNECT_TIMEOUT_MS',
  pgMaxConnections: 'THREADLINE_PG_MAX_CONNECTIONS',
  graphHost: 'THREADLINE_FALKORDB_HOST',
  graphPort: 'THREADLINE_FALKORDB_PORT',
  graphUsername: 'THREADLINE_FALKORDB_USERNAME',
  graphPassword: 'THREADLINE_FALKORDB_PASSWORD',
  graphConnectTimeoutMs: 'THREADLINE_FALKORDB_CONNECT_TIMEOUT_MS',
  graphWriteTimeoutMs: 'THREADLINE_FALKORDB_WRITE_TIMEOUT_MS',
  providerId: 'THREADLINE_PROVIDER',
  providerApi: 'THREADLINE_PROVIDER_API',
  providerApiKey: 'THREADLINE_OPENAI_API_KEY',
  openCodeApiKey: 'MODEL_OPENCODE_API_KEY',
  customProviderApiKey: 'THREADLINE_PROVIDER_API_KEY',
  providerModel: 'THREADLINE_PROVIDER_MODEL',
  providerBaseUrl: 'THREADLINE_PROVIDER_BASE_URL',
  artifactsDirectory: 'THREADLINE_ARTIFACTS_DIR',
  tenantSlug: 'THREADLINE_TENANT_SLUG',
  userDisplayName: 'THREADLINE_USER_DISPLAY_NAME',
  projectSlug: 'THREADLINE_PROJECT_SLUG',
} as const;

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];

export const DEFAULT_LIMITS: BackendLimits = {
  maxEventListeners: 16,
  maxRequestBodyBytes: 65_536,
  maxCommandTextLength: 4_000,
  maxEventBacklogBytes: 1_048_576,
};

const LIMIT_BOUNDS = {
  maxEventListeners: { min: 1, max: 64 },
  maxRequestBodyBytes: { min: 1_024, max: 1_048_576 },
  maxCommandTextLength: { min: 1, max: 65_536 },
  maxEventBacklogBytes: { min: 1_024, max: 16_777_216 },
} as const satisfies Record<keyof BackendLimits, { min: number; max: number }>;

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 47_821;
export const DEFAULT_DATA_DIRECTORY = '.threadline';

/**
 * Parses and validates configuration from environment variables.
 *
 * Throws {@link ConfigurationError} listing every problem with a fix hint. The
 * reported problems name a field and a rule; they never echo the submitted
 * value, and this configuration surface carries no credentials to leak.
 */
export function parseBackendConfig(source: ConfigSource = {}): BackendConfig {
  const env = source.env ?? {};
  const cwd = source.cwd ?? process.cwd();
  const issues: ConfigurationIssue[] = [];

  const host = readString(env[ENV_KEYS.host], DEFAULT_HOST);
  validateHost(host, issues);

  const port = readInteger(env[ENV_KEYS.port], DEFAULT_PORT, ENV_KEYS.port, issues, {
    min: 0,
    max: 65_535,
  });

  const rawDataDirectory = readString(env[ENV_KEYS.dataDirectory], DEFAULT_DATA_DIRECTORY);
  const dataDirectory = isAbsolute(rawDataDirectory)
    ? rawDataDirectory
    : resolve(cwd, rawDataDirectory);
  validateDataDirectory(dataDirectory, issues);

  const limits: BackendLimits = {
    maxEventListeners: readInteger(
      env[ENV_KEYS.maxEventListeners],
      DEFAULT_LIMITS.maxEventListeners,
      ENV_KEYS.maxEventListeners,
      issues,
      LIMIT_BOUNDS.maxEventListeners,
    ),
    maxRequestBodyBytes: readInteger(
      env[ENV_KEYS.maxRequestBodyBytes],
      DEFAULT_LIMITS.maxRequestBodyBytes,
      ENV_KEYS.maxRequestBodyBytes,
      issues,
      LIMIT_BOUNDS.maxRequestBodyBytes,
    ),
    maxCommandTextLength: readInteger(
      env[ENV_KEYS.maxCommandTextLength],
      DEFAULT_LIMITS.maxCommandTextLength,
      ENV_KEYS.maxCommandTextLength,
      issues,
      LIMIT_BOUNDS.maxCommandTextLength,
    ),
    maxEventBacklogBytes: readInteger(
      env[ENV_KEYS.maxEventBacklogBytes],
      DEFAULT_LIMITS.maxEventBacklogBytes,
      ENV_KEYS.maxEventBacklogBytes,
      issues,
      LIMIT_BOUNDS.maxEventBacklogBytes,
    ),
  };

  const storage = parseStorageConfig(env, issues);

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }
  return { host, port, dataDirectory, limits, storage };
}

const STORAGE_MODES = ['unconfigured', 'required'] as const;

function parseStorageConfig(
  env: Readonly<Record<string, string | undefined>>,
  issues: ConfigurationIssue[],
): StorageConfig {
  const modeRaw = readString(env[ENV_KEYS.storageMode], 'unconfigured');
  if (!STORAGE_MODES.includes(modeRaw as (typeof STORAGE_MODES)[number])) {
    issues.push({
      field: ENV_KEYS.storageMode,
      problem: `must be one of ${STORAGE_MODES.join(' or ')}.`,
      hint: 'Use "required" when a real PostgreSQL and FalkorDB are reachable.',
    });
  }
  const mode = STORAGE_MODES.includes(modeRaw as (typeof STORAGE_MODES)[number])
    ? (modeRaw as StorageConfig['mode'])
    : 'unconfigured';

  const sslRaw = readString(env[ENV_KEYS.pgSsl], 'disable');
  if (sslRaw !== 'disable' && sslRaw !== 'require') {
    issues.push({
      field: ENV_KEYS.pgSsl,
      problem: 'must be "disable" or "require".',
      hint: 'Local Compose PostgreSQL uses "disable"; a managed database uses "require".',
    });
  }

  const postgres: PostgresConfig = {
    host: readString(env[ENV_KEYS.pgHost], '127.0.0.1'),
    port: readInteger(env[ENV_KEYS.pgPort], 55432, ENV_KEYS.pgPort, issues, { min: 1, max: 65_535 }),
    database: readString(env[ENV_KEYS.pgDatabase], ''),
    user: readString(env[ENV_KEYS.pgUser], ''),
    password: readString(env[ENV_KEYS.pgPassword], ''),
    migrationUser: readString(env[ENV_KEYS.pgMigrationUser], ''),
    migrationPassword: readString(env[ENV_KEYS.pgMigrationPassword], ''),
    applicationRole: readString(env[ENV_KEYS.pgApplicationRole], ''),
    ssl: sslRaw === 'require' ? 'require' : 'disable',
    connectTimeoutMs: readInteger(
      env[ENV_KEYS.pgConnectTimeoutMs],
      5_000,
      ENV_KEYS.pgConnectTimeoutMs,
      issues,
      { min: 250, max: 120_000 },
    ),
    maxConnections: readInteger(
      env[ENV_KEYS.pgMaxConnections],
      8,
      ENV_KEYS.pgMaxConnections,
      issues,
      { min: 1, max: 64 },
    ),
  };

  const falkordb: FalkorDbConfig = {
    host: readString(env[ENV_KEYS.graphHost], '127.0.0.1'),
    port: readInteger(
      env[ENV_KEYS.graphPort],
      56379,
      ENV_KEYS.graphPort,
      issues,
      { min: 1, max: 65_535 },
    ),
    username: readString(env[ENV_KEYS.graphUsername], ''),
    password: readString(env[ENV_KEYS.graphPassword], ''),
    connectTimeoutMs: readInteger(
      env[ENV_KEYS.graphConnectTimeoutMs],
      5_000,
      ENV_KEYS.graphConnectTimeoutMs,
      issues,
      { min: 250, max: 120_000 },
    ),
    writeTimeoutMs: readInteger(
      env[ENV_KEYS.graphWriteTimeoutMs],
      2_000,
      ENV_KEYS.graphWriteTimeoutMs,
      issues,
      { min: 250, max: 60_000 },
    ),
  };

  if (mode === 'required') {
    requireNonEmpty(env, ENV_KEYS.pgDatabase, 'the PostgreSQL database name', issues);
    requireNonEmpty(env, ENV_KEYS.pgUser, 'the PostgreSQL user', issues);
    requireNonEmpty(env, ENV_KEYS.pgPassword, 'the PostgreSQL password', issues);
    if ((env[ENV_KEYS.pgMigrationUser] ?? '').length > 0) {
      requireNonEmpty(
        env,
        ENV_KEYS.pgMigrationPassword,
        'the PostgreSQL migration password when a migration user is set',
        issues,
      );
    }
  }

  const artifactsDirectory = resolve(
    readString(env[ENV_KEYS.dataDirectory], DEFAULT_DATA_DIRECTORY),
    readString(env[ENV_KEYS.artifactsDirectory], 'artifacts'),
  );

  const local: LocalIdentityConfig = {
    tenantSlug: readString(env[ENV_KEYS.tenantSlug], 'local'),
    tenantName: 'Local',
    userDisplayName: readString(env[ENV_KEYS.userDisplayName], 'Local Owner'),
    projectSlug: readString(env[ENV_KEYS.projectSlug], 'threadline'),
    idleExpiryMs: 12 * 60 * 60 * 1000,
    absoluteExpiryMs: 7 * 24 * 60 * 60 * 1000,
  };

  const providerRaw = readString(env[ENV_KEYS.providerId], 'openai');
  const providerId = providerRaw in PROVIDERS && Object.hasOwn(PROVIDERS, providerRaw) ? providerRaw as ProviderId : 'openai';
  if (providerRaw !== providerId) issues.push({ field: ENV_KEYS.providerId, problem: 'Unknown provider.', hint: 'Choose openai, anthropic, openrouter, opencode-go or openai-compatible.' });
  const definition = PROVIDERS[providerId];
  const providerApiRaw = readString(env[ENV_KEYS.providerApi], definition.api);
  const providerApi: ProviderApi = providerApiRaw === 'responses' ? 'responses' : providerApiRaw === 'anthropic-messages' ? 'anthropic-messages' : 'chat-completions';
  if (!['responses', 'chat-completions', 'anthropic-messages'].includes(providerApiRaw)) issues.push({ field: ENV_KEYS.providerApi, problem: 'Unsupported wire API.', hint: 'Choose responses, chat-completions or anthropic-messages.' });
  const providerBaseUrl = readString(env[ENV_KEYS.providerBaseUrl], definition.baseUrl);
  try { validateProviderBaseUrl(providerBaseUrl); }
  catch { issues.push({ field: ENV_KEYS.providerBaseUrl, problem: 'Invalid provider base URL.', hint: 'Use HTTPS (or loopback HTTP), without credentials, query or fragment.' }); }

  return {
    mode,
    postgres,
    falkordb,
    local,
    artifactsDirectory,
    providerId,
    providerApi,
    providerApiKey: readString(env[definition.keyEnv], ''),
    providerModel: readString(env[ENV_KEYS.providerModel], ''),
    providerBaseUrl,
  };
}

function requireNonEmpty(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  label: string,
  issues: ConfigurationIssue[],
): void {
  if ((env[key] ?? '').length === 0) {
    issues.push({
      field: key,
      problem: `is required in "${'required'}" storage mode but is missing.`,
      hint: `Set ${label}. It comes from the local Compose .env and is never committed.`,
    });
  }
}

function validateHost(host: string, issues: ConfigurationIssue[]): void {
  if (host.trim().length === 0) {
    issues.push({
      field: ENV_KEYS.host,
      problem: 'must not be empty.',
      hint: `Use one of ${LOOPBACK_HOSTS.join(', ')}.`,
    });
    return;
  }
  if (!LOOPBACK_HOSTS.includes(host)) {
    issues.push({
      field: ENV_KEYS.host,
      problem: 'must be a loopback address.',
      hint: `This backend holds local credentials, so it binds ${LOOPBACK_HOSTS.join(' or ')} only. Remote access needs a separate authenticated service.`,
    });
  }
}

function validateDataDirectory(dataDirectory: string, issues: ConfigurationIssue[]): void {
  try {
    const stats = statSync(dataDirectory);
    if (!stats.isDirectory()) {
      issues.push({
        field: ENV_KEYS.dataDirectory,
        problem: 'points at a path that is not a directory.',
        hint: 'Choose a directory path, or leave the variable unset to use the default.',
      });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // A missing directory is acceptable: M00 creates nothing on disk.
      return;
    }
    if (code === 'EACCES') {
      issues.push({
        field: ENV_KEYS.dataDirectory,
        problem: 'is not readable by this process.',
        hint: 'Fix the directory permissions or choose another path.',
      });
      return;
    }
    issues.push({
      field: ENV_KEYS.dataDirectory,
      problem: 'could not be inspected.',
      hint: 'Choose an existing readable directory path.',
    });
  }
}

function readString(value: string | undefined, fallback: string): string {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  return value;
}

function readInteger(
  raw: string | undefined,
  fallback: number,
  field: string,
  issues: ConfigurationIssue[],
  bounds: { min: number; max: number },
): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  if (!/^-?\d+$/.test(raw.trim())) {
    issues.push({
      field,
      problem: 'must be a whole number.',
      hint: `Provide an integer between ${bounds.min} and ${bounds.max}.`,
    });
    return fallback;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (parsed < bounds.min || parsed > bounds.max) {
    issues.push({
      field,
      problem: `must be between ${bounds.min} and ${bounds.max}.`,
      hint: 'Lower or raise the value, or unset the variable to use the default.',
    });
    return fallback;
  }
  return parsed;
}

export type BackendConfigSummary = {
  readonly host: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly limits: BackendLimits;
  readonly storage: StorageConfigSummary;
};

/**
 * The only representation of configuration that may be logged or returned to a
 * client. It is an explicit allowlist, so adding a credential field to
 * `BackendConfig` cannot accidentally start exposing it. Passwords are reduced
 * to a boolean saying whether one is configured.
 */
export type StorageConfigSummary = {
  readonly mode: 'unconfigured' | 'required';
  readonly postgres: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly ssl: 'disable' | 'require';
    readonly maxConnections: number;
    readonly passwordConfigured: boolean;
    readonly migrationUserConfigured: boolean;
    readonly applicationRole: string;
  };
  readonly falkordb: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly writeTimeoutMs: number;
    readonly passwordConfigured: boolean;
  };
  readonly local: {
    readonly tenantSlug: string;
    readonly userDisplayName: string;
    readonly projectSlug: string;
    readonly idleExpiryMs: number;
    readonly absoluteExpiryMs: number;
  };
  readonly artifactsDirectory: string;
  readonly providerId: ProviderId;
  readonly providerApi: ProviderApi;
  readonly providerCredentialConfigured: boolean;
  readonly providerModel: string;
  readonly providerBaseUrl: string;
};

export function describeConfig(config: BackendConfig): BackendConfigSummary {
  return {
    host: config.host,
    port: config.port,
    dataDirectory: config.dataDirectory,
    limits: { ...config.limits },
    storage: {
      mode: config.storage.mode,
      postgres: {
        host: config.storage.postgres.host,
        port: config.storage.postgres.port,
        database: config.storage.postgres.database,
        user: config.storage.postgres.user,
        ssl: config.storage.postgres.ssl,
        maxConnections: config.storage.postgres.maxConnections,
        passwordConfigured: config.storage.postgres.password.length > 0,
        migrationUserConfigured: config.storage.postgres.migrationUser.length > 0,
        applicationRole: config.storage.postgres.applicationRole,
      },
      falkordb: {
        host: config.storage.falkordb.host,
        port: config.storage.falkordb.port,
        username: config.storage.falkordb.username,
        writeTimeoutMs: config.storage.falkordb.writeTimeoutMs,
        passwordConfigured: config.storage.falkordb.password.length > 0,
      },
      local: {
        tenantSlug: config.storage.local.tenantSlug,
        userDisplayName: config.storage.local.userDisplayName,
        projectSlug: config.storage.local.projectSlug,
        idleExpiryMs: config.storage.local.idleExpiryMs,
        absoluteExpiryMs: config.storage.local.absoluteExpiryMs,
      },
      artifactsDirectory: config.storage.artifactsDirectory,
      providerId: config.storage.providerId,
      providerApi: config.storage.providerApi,
      providerCredentialConfigured: config.storage.providerApiKey.length > 0,
      providerModel: config.storage.providerModel,
      providerBaseUrl: config.storage.providerBaseUrl,
    },
  };
}

export const CONFIG_ENV_KEYS = ENV_KEYS;