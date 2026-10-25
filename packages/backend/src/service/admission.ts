import { randomUUID } from 'node:crypto';

import { sanitizeContentV3, SANITIZER_VERSION_V3, ThreadlineError } from '@threadline/shared';

import { loadProductPolicy } from '../policy.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { identityOf, lockReleaseAuthority, type ReleaseAuthority } from './release.js';

export const ADMISSION_POLICY_REVISION = '0';
export const ADMISSION_SCANNER_VERSION = SANITIZER_VERSION_V3;
const MAX_BYTES = 1_048_576;
const MAX_ENTRIES = 4096;

function refuse(): never {
  throw new ThreadlineError('invalid_request', 'Input could not pass the bounded content admission policy.', { field: 'content' });
}

/** The deterministic scanner is shared with the server and pre-transport
 * adapter. Reductions are refused: authored meaning and retry identity never
 * silently change. Credentials belong to authentication, outside this input. */
export function assertSafeText(text: string): void {
  if (!text.length) return;
  if (text.includes('\0')) refuse();
  const result = sanitizeContentV3({ format: 'text', text }, {
    policyRevision: ADMISSION_POLICY_REVISION, maxInputBytes: 65536, maxOutputBytes: 65536,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeJson(value: unknown, profile?: 'observed_under' | 'applicability'): void {
  const text = JSON.stringify(value);
  const result = sanitizeContentV3({ format: 'json', text, ...(profile ? { profile } : {}) }, {
    policyRevision: ADMISSION_POLICY_REVISION, maxInputBytes: 65536, maxOutputBytes: 65536, maxDepth: 8, maxEntries: 1024,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeAdmissionInput(input: unknown): void {
  let entries = 0, bytes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++entries > MAX_ENTRIES || depth > 12) refuse();
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > MAX_BYTES || value.includes('\0')) refuse();
      assertSafeText(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
    } else if (value !== null && typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) refuse();
      for (const [key, entry] of Object.entries(value)) {
        bytes += Buffer.byteLength(key);
        if (bytes > MAX_BYTES) refuse();
        // Profile validation also inspects dynamic parameter names; leaf-only
        // scanning would miss credentials hidden under an innocuous value.
        if (key === 'content') assertSafeJson(entry);
        if (key === 'observedUnder') assertSafeJson(entry, 'observed_under');
        if (key === 'applicability') assertSafeJson(entry, 'applicability');
        if (key === 'bytesBase64') {
          if (typeof entry !== 'string' || entry.length > Math.ceil(MAX_BYTES / 3) * 4
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry)) refuse();
          let text: string;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(entry, 'base64')); }
          catch { refuse(); }
          visit(text, depth + 1);
        } else {
          assertSafeText(key);
          visit(entry, depth + 1);
        }
      }
    } else if (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) refuse();
  };
  visit(input, 0);
}

export interface AdmissionTicket { readonly id: string }
export interface AdmissionService {
  check(call: AuthenticatedCall, surface: string, input: unknown): Promise<AdmissionTicket>;
  revalidate(ticket: AdmissionTicket, tx: TxClient): Promise<void>;
  /** Workers must not promote historical, unqualified payloads. */
  requireCurrentPolicy(): void;
}

export function createAdmissionService(deps: { readonly db: SqlDatabase; readonly policyHome?: string }): AdmissionService {
  const issued = new WeakMap<AdmissionTicket, { call: AuthenticatedCall; authority: ReleaseAuthority }>();
  const requireCurrentPolicy = (): void => {
    // M04-02 owns effective approval/revisions. A candidate file cannot grant
    // authority; equally, its restrictions must never be silently ignored.
    try {
      if (deps.policyHome === undefined || loadProductPolicy(deps.policyHome).state === 'restrictive-defaults') return;
    } catch { /* No parser, filesystem path or discarded value crosses the API. */ }
    throw new ThreadlineError('authority_unavailable', 'Content admission requires an available, activated policy or the restrictive baseline.');
  };
  return {
    requireCurrentPolicy,
    async check(call, surface, input) {
      if (!/^[a-z][a-zA-Z.]{0,63}$/.test(surface)) throw new ThreadlineError('internal_error', 'Invalid admission surface.');
      const id = randomUUID();
      let failure: unknown;
      const authority = await deps.db.withTenantTransaction(call.scope.tenantId, async tx => {
        const authority = await lockReleaseAuthority(tx, identityOf(call));
        requireMatchingAuthority(call, authority);
        try { requireCurrentPolicy(); assertSafeAdmissionInput(input); } catch (error) { failure = error; }
        await tx.rows(`INSERT INTO threadline_memory.ingress_admissions
          (tenant_id,id,principal_id,token_id,project_id,surface,policy_revision,sanitizer_version,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [call.scope.tenantId,id,call.scope.principalId,call.tokenId,
          call.scope.projectId,surface,ADMISSION_POLICY_REVISION,ADMISSION_SCANNER_VERSION,failure ? 'refused' : 'accepted']);
        return authority;
      });
      if (failure) throw failure;
      const ticket = Object.freeze({ id });
      issued.set(ticket, { call, authority });
      return ticket;
    },
    async revalidate(ticket, tx) {
      const state = issued.get(ticket);
      if (!state) throw new ThreadlineError('authority_unavailable', 'Admission requires a current request ticket.');
      const current = await lockReleaseAuthority(tx, identityOf(state.call));
      requireMatchingAuthority(state.call, current);
      if (JSON.stringify(current) !== JSON.stringify(state.authority)) {
        throw new ThreadlineError('stale_revision', 'Admission authority changed; retry the request.');
      }
      requireCurrentPolicy();
      await tx.rows("SELECT set_config('threadline.admission_id',$1,true)", [ticket.id]);
    },
  };
}

function requireMatchingAuthority(call: AuthenticatedCall, authority: ReleaseAuthority): void {
  if (authority.tokenKind !== call.scope.tokenKind || authority.principalKind !== call.scope.principalKind
    || authority.role !== call.scope.role || authority.nativeSessionId !== call.scope.nativeSessionId
    || authority.enrollmentId !== call.enrollmentId || authority.bindingGeneration !== call.bindingGeneration
    || JSON.stringify(authority.scopes ?? []) !== JSON.stringify(call.scopes ?? [])) {
    throw new ThreadlineError('scope_denied', 'Current authority does not permit this admission.');
  }
  if (authority.graphKey !== call.scope.graphKey || authority.graphEpoch !== call.scope.graphEpoch
    || authority.privacyRevision !== call.scope.privacyRevision) {
    throw new ThreadlineError('stale_revision', 'Admission authority changed; retry the request.');
  }
}
