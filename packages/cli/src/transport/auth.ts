/**
 * Bearer credential handling for the local backend transport.
 *
 * The token is attached as a header and is never placed in a URL, a command
 * argument or an activity line. Anything derived from a request or an answer is
 * passed through {@link redactSecrets} before it can reach a terminal.
 */

export class MissingCredentialError extends Error {
  constructor(reason: string) {
    super(`No local session credential is available: ${reason}`);
    this.name = 'MissingCredentialError';
  }
}

/**
 * Builds the header set for an authenticated request.
 *
 * Returns `{}` when no token is supplied, which keeps the M00 development
 * surface working before an owner session exists.
 */
export function authHeaders(token: string | null): Record<string, string> {
  if (token === null || token.length === 0) {
    return {};
  }
  return { authorization: `Bearer ${token}` };
}

/**
 * Wraps a one-shot so every line it emits is scrubbed.
 *
 * A backend that echoes an Authorization header in an error must not be able to
 * push the token into the terminal through this client.
 */
export function redactingSink(
  write: (line: string) => void,
  secrets: readonly (string | null)[],
): (line: string) => void {
  const active = secrets.filter((secret): secret is string => typeof secret === 'string' && secret.length > 0);
  if (active.length === 0) {
    return write;
  }
  return (line: string) => {
    let safe = line;
    for (const secret of active) {
      safe = safe.split(secret).join('<redacted>');
    }
    write(safe);
  };
}
