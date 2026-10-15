/**
 * Transport-level failures.
 *
 * These describe the connection between this process and the backend, not
 * anything the backend decided. A command the backend rejected is a normal
 * {@link CommandFailure} result and must be rendered, not thrown.
 */

/** The backend could not be reached, or the request never completed. */
export class BackendUnreachableError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, reason: string, options?: { cause?: unknown }) {
    super(`Cannot reach the backend at ${endpoint}: ${reason}`, options);
    this.name = 'BackendUnreachableError';
    this.endpoint = endpoint;
  }
}

/** The backend answered, but not with something this protocol version accepts. */
export class BackendProtocolError extends Error {
  readonly endpoint: string;
  readonly status: number | null;

  constructor(endpoint: string, detail: string, status: number | null, options?: { cause?: unknown }) {
    super(`Unexpected answer from ${endpoint}: ${detail}`, options);
    this.name = 'BackendProtocolError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Describes a failure for a human, unwrapping the `cause` chain so a bare
 * "fetch failed" reports why — a refused connection, a reset socket or an
 * aborted request are very different problems for whoever is reading the log.
 */
export function describeCause(error: unknown): string {
  // Transport errors already state the endpoint and the reason in their own
  // message, so unwrapping them again would print the same detail twice.
  if (error instanceof BackendUnreachableError || error instanceof BackendProtocolError) {
    return error.message;
  }
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(typeof current);
      break;
    }
    const code = (current as NodeJS.ErrnoException).code;
    parts.push(code === undefined ? current.message : `${current.message} (${code})`);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(': ');
}
