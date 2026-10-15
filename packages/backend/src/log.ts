/**
 * Minimal structured logger for the M00 scaffold.
 *
 * It is deliberately not a logging framework: one JSON line per record on
 * stderr, primitive fields only. Callers pass already-sanitised values; this
 * module never reads the environment and never accepts a secret-bearing field
 * name.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

type LogPrimitive = string | number | boolean | null;

/**
 * Primitives, or a record of them. Nesting is accepted for the allowlisted
 * configuration summary; `assertLoggable` bounds the depth at runtime so a
 * recursive object cannot be smuggled into a log record.
 */
export type LogFieldValue = LogPrimitive | { readonly [key: string]: LogFieldValue };

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, LogFieldValue>>;
}

export interface Logger {
  log(record: LogRecord): void;
  child(fields: Readonly<Record<string, LogFieldValue>>): Logger;
}

/** Field names that must never appear in a record, whatever the caller passes. */
const FORBIDDEN_FIELD_PATTERN = /(secret|token|password|authorization|api[_-]?key|credential)/i;

export class RedactedLogFieldError extends Error {
  constructor(field: string) {
    super(`Refusing to log a field whose name looks sensitive: "${field}".`);
    this.name = 'RedactedLogFieldError';
  }
}

const MAX_LOG_FIELD_DEPTH = 4;

function assertLoggable(
  message: string,
  fields: Readonly<Record<string, LogFieldValue>> | undefined,
  depth = 0,
): void {
  if (message.trim().length === 0) {
    throw new TypeError('Log message must not be empty.');
  }
  if (fields === undefined) {
    return;
  }
  if (depth > MAX_LOG_FIELD_DEPTH) {
    throw new TypeError('Log fields are nested too deeply.');
  }
  for (const [name, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD_PATTERN.test(name) && !(name === 'passwordConfigured' && typeof value === 'boolean')) {
      throw new RedactedLogFieldError(name);
    }
    if (value === null || typeof value !== 'object') {
      continue;
    }
    if (Array.isArray(value)) {
      throw new TypeError(`Log field "${name}" must not be an array.`);
    }
    assertLoggable(`${name}.`, value as { readonly [key: string]: LogFieldValue }, depth + 1);
  }
}

export function createJsonLogger(boundFields: Readonly<Record<string, LogFieldValue>> = {}) {
  assertLoggable('logger', boundFields);
  const write = (record: LogRecord): void => {
    assertLoggable(record.message, record.fields);
    const merged = { ...boundFields, ...(record.fields ?? {}) };
    process.stderr.write(
      `${JSON.stringify({ at: new Date().toISOString(), level: record.level, message: record.message, ...merged })}\n`,
    );
  };
  const logger: Logger = {
    log: write,
    child: (fields) => createJsonLogger({ ...boundFields, ...fields }),
  };
  return logger;
}

/** Discards records. Used by tests and by any caller that supplies no logger. */
export const silentLogger: Logger = {
  log: () => {},
  child: () => silentLogger,
};