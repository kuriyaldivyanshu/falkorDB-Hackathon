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

export type LogFieldValue =
  | string
  | number
  | boolean
  | null
  | Readonly<Record<string, string | number | boolean | null>>;

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

function assertLoggable(
  message: string,
  fields: Readonly<Record<string, LogFieldValue>> | undefined,
): void {
  if (message.trim().length === 0) {
    throw new TypeError('Log message must not be empty.');
  }
  if (fields === undefined) {
    return;
  }
  for (const [name, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD_PATTERN.test(name)) {
      throw new RedactedLogFieldError(name);
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'object' && !Array.isArray(value))
    ) {
      throw new TypeError(
        `Log field "${name}" must be a string, number, boolean, null or a record of those.`,
      );
    }
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