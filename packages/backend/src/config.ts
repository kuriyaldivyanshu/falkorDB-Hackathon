import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

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

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }
  return { host, port, dataDirectory, limits };
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
};

/**
 * Builds the only representation of configuration that may be logged or
 * returned to a client. It is an explicit allowlist, so adding a credential
 * field to `BackendConfig` cannot accidentally start exposing it.
 */
export function describeConfig(config: BackendConfig): BackendConfigSummary {
  return {
    host: config.host,
    port: config.port,
    dataDirectory: config.dataDirectory,
    limits: { ...config.limits },
  };
}

export const CONFIG_ENV_KEYS = ENV_KEYS;