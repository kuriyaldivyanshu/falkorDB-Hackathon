/**
 * Serialisable error contract shared by the memory service and its clients.
 *
 * A payload carries a machine-readable code, a message safe to display and
 * optional primitive details. It never carries a stack, a credential, an
 * environment value, a source body or a raw database/graph driver message.
 */

export const THREADLINE_ERROR_CODES = [
  'invalid_request',
  'unknown_command',
  /** The service is not accepting this operation right now. */
  'service_unavailable',
  'internal_error',
  // Authentication and scope are decided server-side; a supplied project,
  // task or session id is a requested target, never proof of authority.
  'unauthorized',
  'not_found',
  // A real store was required and could not be used. Never falls back to memory.
  'storage_unavailable',
  // The applied schema is not the schema this build expects.
  'schema_incompatible',
  // The same idempotency key arrived with a different canonical payload.
  'idempotency_mismatch',
  // A guarded write matched no row: the epoch, memory head, claim token or
  // privacy revision moved, or a concurrent writer already committed. The
  // caller must reconcile; retrying the same expectation cannot succeed.
  'authority_conflict',
  // Required authority exists but cannot be resolved (missing or duplicate
  // current version, epoch mismatch, unavailable source). Fails closed.
  'authority_unavailable',
  // A guarded expectation named an explicit version that is no longer current.
  'stale_revision',
  // The caller is authenticated but not permitted for this project, task or
  // source. Distinct from `unauthorized` so a caller is told what to fix.
  'scope_denied',
  // The capability is not part of this product surface at this build.
  'unsupported',
  // A source's bytes are missing, expired or deleted; the metadata may survive.
  'source_unavailable',
  // Project policy is changing or blocked (privacy barrier in progress).
  'deleting',
  // Bounded worker/queue capacity is exhausted. Rejection is explicit rather
  // than an unbounded promise.
  'overloaded',
  // The evidence is known to be incomplete (missing bytes, partial capture,
  // unsupported native record). Never silently upgraded to complete.
  'partial_coverage',
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
  service_unavailable: 'The memory service is not accepting this request right now.',
  internal_error: 'The memory service failed to complete the request.',
  unauthorized: 'The caller is not authenticated for this operation.',
  not_found: 'The requested resource does not exist.',
  storage_unavailable: 'A required data store is unavailable; nothing was recorded.',
  schema_incompatible: 'The applied schema differs from the version this build requires.',
  idempotency_mismatch: 'This operation identity was already used with a different payload.',
  authority_conflict: 'The guarded mutation did not match; reconcile before retrying.',
  authority_unavailable: 'Current authority cannot be resolved; the operation is blocked.',
  stale_revision: 'The named version is no longer current.',
  scope_denied: 'The caller is not permitted for this project, task or source.',
  unsupported: 'This capability is not implemented in this build.',
  source_unavailable: 'The source bytes are unavailable.',
  deleting: 'Project memory is being deleted; releases are blocked until the barrier completes.',
  overloaded: 'The service is at its bounded capacity; retry after the reported delay.',
  partial_coverage: 'The evidence is incomplete; the result is explicitly partial.',
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
    !(THREADLINE_ERROR_CODES as readonly string[]).includes(candidate.code)
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
 * Base class for failures raised inside the service process. It converts to a
 * payload so the HTTP/MCP layer never leaks the original object graph.
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
      `Invalid Threadline configuration: ${issues.map((issue) => `${issue.field} ${issue.problem}`).join('; ')}`,
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
