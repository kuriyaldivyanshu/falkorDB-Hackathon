import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ThreadlineError } from '@threadline/shared';
import { canonicalDigest } from '../storage/digest.js';
import type { AuthenticatedCall } from './auth.js';

// Process-bound opaque cursors: restarting invalidates them explicitly. Hidden
// scan positions never appear as decoded IDs/sequences/counts in client tokens.
const key = randomBytes(32);
function binding(call: AuthenticatedCall, filter: string): Buffer {
  return Buffer.from(canonicalDigest({ tenant: call.scope.tenantId, principal: call.scope.principalId,
    token: call.tokenId, project: call.scope.projectId, privacy: call.scope.privacyRevision,
    epoch: call.scope.graphEpoch, filter }));
}
export function encodePageCursor(call: AuthenticatedCall, filter: string, position: unknown): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(binding(call, filter));
  const bytes = Buffer.concat([cipher.update(JSON.stringify({position,expiresAt:Date.now()+900000})),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function decodePageCursor<T>(call: AuthenticatedCall, filter: string, token: string | undefined, fallback: T): T {
  if (token === undefined) return fallback;
  try {
    if (token.length > 2048) throw new Error();
    const bytes = Buffer.from(token,'base64url');
    const decipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    decipher.setAAD(binding(call,filter)); decipher.setAuthTag(bytes.subarray(12,28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString()) as {position:T;expiresAt:number};
    if (value.expiresAt <= Date.now()) throw new Error();
    return value.position;
  } catch { throw new ThreadlineError('stale_revision','The page cursor expired or no longer matches this credential and scope. Start a new listing.'); }
}
