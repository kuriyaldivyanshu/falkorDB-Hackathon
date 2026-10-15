/**
 * Serialisable error contract shared by the backend and the terminal client.
 *
 * A payload carries a machine-readable code, a message safe to display and
 * optional primitive details. It never carries a stack, a credential, an
 * environment value or a raw database/provider message.
 */

export const THREADLINE_ERROR_CODES = [
  'invalid_request',
  'unknown_command',
  'service_unavailable',
  'internal_error',
  // M01. Authentication and scope are decided server-side; a supplied project
  // id or user name is a requested target, never proof of authority.
  'unauthorized',
  'not_found',
  // The same request id arrived with a different canonical payload. No mutation
  // is attempted and the original receipt is not disclosed.
  'idempotency_mismatch',
  // A guarded write matched no row: the epoch moved, authority was absent, or a
  // concurrent writer already committed. The caller must reconcile, not retry.
  'authority_conflict',
  // Required authority exists but cannot be resolved (missing or duplicate
  // current version, epoch mismatch, unavailable source). Fails closed.
  'authority_unavailable',
  // A real store was required and could not be used. Never falls back to memory.
  'storage_unavailable',
  // The applied schema is not the schema this build expects.
  'schema_incompatible',
] as const;

export type ThreadlineErrorCode = (typeof THREADLINE_ERROR_CODES)[number];

/** Detail values are limited to primitives so a payload cannot smuggle objects. */
export type ThreadlineErrorDetail = string | number | boolean;

export interface ThreadlineErrorPayload {
  readonly code: ThreadlineErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, ThreadlineErrorDetail>>;
}

const DEFAULT_MESSAGE: Record<ThreadlineErrorCode, string> = {
  invalid_request: 'The request was not understood.',
  unknown_command: 'The requested command does not exist.',
  service_unavailable: 'The backend is not accepting this request right now.',
  internal_error: 'The backend failed to complete the request.',
  unauthorized: 'The caller is not authenticated for this operation.',
  not_found: 'The requested resource does not exist.',
  idempotency_mismatch: 'This request id was already used with a different payload.',
  authority_conflict: 'The guarded authority mutation did not match; reconcile before retrying.',
  authority_unavailable: 'Current authority cannot be resolved; the operation is blocked.',
  storage_unavailable: 'A required data store is unavailable; nothing was recorded.',
  schema_incompatible: 'The applied schema differs from the version this build requires.',
};

export function errorPayload(
  code: ThreadlineErrorCode,
  message?: string,
  details?: Readonly<Record<string, ThreadlineErrorDetail>>,
): ThreadlineErrorPayload {
  const base = { code, message: message ?? DEFAULT_MESSAGE[code] };
  return details === undefined ? base : { ...base, details };
}

export function isThreadlineErrorPayload(value: unknown): value is ThreadlineErrorPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; message?: unknown; details?: unknown };
  if (
    typeof candidate.code !== 'string' ||
    !THREADLINE_ERROR_CODES.includes(candidate.code as ThreadlineErrorCode)
  ) {
    return false;
  }
  if (typeof candidate.message !== 'string') {
    return false;
  }
  if (candidate.details === undefined) {
    return true;
  }
  return isDetailRecord(candidate.details);
}

function isDetailRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (detail) =>
      typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean',
  );
}

/**
 * Base class for failures raised inside the backend process. It converts to a
 * payload so the HTTP layer never leaks the original object graph.
 */
export class ThreadlineError extends Error {
  readonly code: ThreadlineErrorCode;
  readonly details: Readonly<Record<string, ThreadlineErrorDetail>> | undefined;

  constructor(
    code: ThreadlineErrorCode,
    message: string,
    details?: Readonly<Record<string, ThreadlineErrorDetail>>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }

  toPayload(): ThreadlineErrorPayload {
    return errorPayload(this.code, this.message, this.details);
  }
}

/** A field-level configuration problem, reported with an actionable hint. */
export interface ConfigurationIssue {
  /** Dotted configuration path, never the submitted value. */
  readonly field: string;
  readonly problem: string;
  /** What a human should do next. */
  readonly hint: string;
}

export class ConfigurationError extends ThreadlineError {
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[]) {
    super(
      'invalid_request',
      `Invalid backend configuration: ${issues.map((issue) => `${issue.field} ${issue.problem}`).join('; ')}`,
      { issueCount: issues.length },
    );
    this.issues = issues;
  }

  format(): string {
    return this.issues
      .map((issue) => `- ${issue.field}: ${issue.problem}\n  fix: ${issue.hint}`)
      .join('\n');
  }
}

/** Raised when a new subscriber would exceed the declared listener bound. */
export class EventCapacityError extends ThreadlineError {
  constructor(maxListeners: number) {
    super('internal_error', 'The event publisher listener limit was reached.', {
      maxListeners,
    });
  }
}

/** Raised when a publisher is used after it has been closed. */
export class PublisherClosedError extends ThreadlineError {
  constructor(operation: 'publish' | 'subscribe') {
    super('internal_error', `The event publisher is closed and cannot ${operation}.`);
  }
}

/** Raised when a backend operation is attempted in the wrong lifecycle state. */
export class BackendStateError extends ThreadlineError {
  constructor(operation: string, expected: string, actual: string) {
    super('service_unavailable', `Cannot ${operation}: backend is ${actual}, expected ${expected}.`, {
      actual,
      expected,
    });
  }
}