import { createHash } from 'node:crypto';

/**
 * Canonical digest for identity and idempotency.
 *
 * The canonical form is deliberately narrow and documented rather than
 * "whatever JSON.stringify produced": keys are sorted, `undefined` members are
 * dropped, and no whitespace is emitted. Two callers that build the same value
 * by different property order must produce the same digest, otherwise a
 * legitimate retry would look like a conflicting payload.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

export function canonicalize(value: CanonicalValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cannot canonicalize a non-finite number.');
    }
    // Integers must not drift between 1 and 1.0 renderings.
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const body = entries
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalize(member as CanonicalValue)}`)
    .join(',');
  return `{${body}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalDigest(value: CanonicalValue): string {
  return sha256Hex(canonicalize(value));
}