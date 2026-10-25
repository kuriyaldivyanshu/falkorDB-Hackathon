import { sanitizeContentV3 } from '@threadline/shared';

/**
 * Minimal structured logger for the memory service.
 *
 * It is deliberately not a logging framework: one JSON line per record on
 * stderr, primitive fields only. Callers pass already-sanitised values; this
 * module never reads the environment and never accepts a secret-bearing field
 * name.
 *
 * Source text never reaches a log record. Callers log identifiers,
 * counts, statuses and timings; a transcript body, tool result or rendered
 * context packet would be private content even when it is perfectly ordinary.
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
const FORBIDDEN_FIELD_PATTERN = /(secret|token|password|authorization|api[_-]?key|credential|digest|errorMessage|content|payload|body)/i;

/**
 * The one sanctioned exception: a boolean whose name ends in `Configured` or
 * `Present` reports whether a credential exists, never its value. Anything else
 * with a credential-like name is refused.
 */
const SAFE_METADATA_SUFFIX = /(?:Configured|Present)$/;

export class RedactedLogFieldError extends Error {
  constructor(_field: string) {
    super('Refusing to log a sensitive field.');
    this.name = 'RedactedLogFieldError';
  }
}

const MAX_LOG_FIELD_DEPTH = 4;

function assertLoggable(
  message: string,
  fields: Readonly<Record<string, LogFieldValue>> | undefined,
  depth = 0,
): void {
  assertSafeLogText(message);
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
    const isSafeMetadata =
      typeof value === 'boolean' && SAFE_METADATA_SUFFIX.test(name) && !/^password$/i.test(name);
    if (FORBIDDEN_FIELD_PATTERN.test(name) && !isSafeMetadata) {
      throw new RedactedLogFieldError(name);
    }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string') assertSafeLogText(value);
      continue;
    }
    if (Array.isArray(value)) {
      throw new TypeError(`Log field "${name}" must not be an array.`);
    }
    assertLoggable(`${name}.`, value as { readonly [key: string]: LogFieldValue }, depth + 1);
  }
}

function assertSafeLogText(text: string): void {
  if (!text.length) return;
  const scanned = sanitizeContentV3({ format: 'text', text }, {
    policyRevision: '0', maxInputBytes: 4096, maxOutputBytes: 4096,
  });
  if (scanned.status !== 'safe' || scanned.payload.text !== text) throw new RedactedLogFieldError('redacted');
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
