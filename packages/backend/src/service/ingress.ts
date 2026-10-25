import { sanitizeContentV3, SANITIZER_VERSION_V3, ThreadlineError } from '@threadline/shared';

export const MANUAL_SCANNER_VERSION = SANITIZER_VERSION_V3;
/** Narrow explicit manual ingress, using the existing common scanner. No native
 * observation is enabled. Refuse reductions rather than changing authored meaning
 * or silently reusing its acceptance/idempotency identity after sanitization. */
export function requireSafeManualText(text: string): void {
  if (text.length === 0) return;
  const result = sanitizeContentV3({ format: 'text', text }, { policyRevision: '0', maxInputBytes: 65536, maxOutputBytes: 65536 });
  if (result.status !== 'safe' || result.payload.text !== text) {
    throw new ThreadlineError('invalid_request', 'Manual input could not pass the bounded content scanner.', { field: 'content' });
  }
}
export function requireSafeManualJson(value: unknown, profile?: 'observed_under' | 'applicability'): void {
  const text = JSON.stringify(value);
  const result = sanitizeContentV3({ format: 'json', text, ...(profile ? { profile } : {}) },
    { policyRevision: '0', maxInputBytes: 65536, maxOutputBytes: 65536, maxDepth: 8, maxEntries: 1024 });
  if (result.status !== 'safe' || result.payload.text !== text) {
    throw new ThreadlineError('invalid_request', 'Manual input could not pass the bounded content scanner.', { field: 'content' });
  }
}
