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