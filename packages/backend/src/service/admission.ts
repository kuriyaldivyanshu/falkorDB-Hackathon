import { randomUUID } from 'node:crypto';

import { ThreadlineError } from '@threadline/shared';

import { assertSafeAdmissionInput, ADMISSION_POLICY_REVISION, ADMISSION_SCANNER_VERSION } from '../admission.js';
export { assertSafeText, assertSafeJson, assertSafeAdmissionInput, ADMISSION_POLICY_REVISION, ADMISSION_SCANNER_VERSION } from '../admission.js';

import { loadProductPolicy } from '../policy.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { identityOf, lockReleaseAuthority, type ReleaseAuthority } from './release.js';

export interface AdmissionTicket { readonly id: string }
export interface AdmissionService {
  check(call: AuthenticatedCall, surface: string, input: unknown, transaction?: TxClient): Promise<AdmissionTicket>;
  revalidate(ticket: AdmissionTicket, tx: TxClient): Promise<void>;
  /** Workers must not promote historical, unqualified payloads. */
  requireCurrentPolicy(): void;
}

export function createAdmissionService(deps: { readonly db: SqlDatabase; readonly policyHome?: string }): AdmissionService {
  const issued = new WeakMap<AdmissionTicket, { call: AuthenticatedCall; authority: ReleaseAuthority }>();
  const requireCurrentPolicy = (): void => {
    // M04-02 owns effective approval/revisions. A candidate file cannot grant
    // authority; equally, its restrictions must never be silently ignored.
    let configured: boolean;
    try { configured = deps.policyHome !== undefined && loadProductPolicy(deps.policyHome).state !== 'restrictive-defaults'; }
    catch {
      throw new ThreadlineError('authority_unavailable', 'Current content policy could not be read safely; retry with a stable, valid policy.', { reason: 'policy_unavailable' });
    }
    if (configured) throw new ThreadlineError('authority_unavailable',
      'Configured content policy is not activated; writes are paused until effective policy activation is available.', { reason: 'policy_unavailable' });
  };
  return {
    requireCurrentPolicy,
    async check(call, surface, input, transaction) {
      if (!/^[a-z][a-zA-Z.]{0,63}$/.test(surface)) throw new ThreadlineError('internal_error', 'Invalid admission surface.');
      const id = randomUUID();
      let failure: unknown;
      const check = async (tx: TxClient): Promise<ReleaseAuthority> => {
        const authority = await lockReleaseAuthority(tx, identityOf(call));
        requireMatchingAuthority(call, authority);
        try { requireCurrentPolicy(); assertSafeAdmissionInput(input); } catch (error) { failure = error; }
        await tx.rows(`INSERT INTO threadline_memory.ingress_admissions
          (tenant_id,id,principal_id,token_id,project_id,surface,policy_revision,sanitizer_version,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [call.scope.tenantId,id,call.scope.principalId,call.tokenId,
          call.scope.projectId,surface,ADMISSION_POLICY_REVISION,ADMISSION_SCANNER_VERSION,failure ? 'refused' : 'accepted']);
        return authority;
      };
      const authority = transaction ? await check(transaction) : await deps.db.withTenantTransaction(call.scope.tenantId, check);
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
      if (!sameAuthority(current, state.authority)) {
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
    || !sameScopes(authority.scopes, call.scopes)) {
    throw new ThreadlineError('scope_denied', 'Current authority does not permit this admission.');
  }
  if (authority.graphKey !== call.scope.graphKey || authority.graphEpoch !== call.scope.graphEpoch
    || authority.privacyRevision !== call.scope.privacyRevision) {
    throw new ThreadlineError('stale_revision', 'Admission authority changed; retry the request.');
  }
}

function sameScopes(left: readonly string[] | null | undefined, right: readonly string[] | null | undefined): boolean {
  const a = [...(left ?? [])].sort(), b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function sameAuthority(a: ReleaseAuthority, b: ReleaseAuthority): boolean {
  return a.tokenKind === b.tokenKind && a.principalKind === b.principalKind && a.role === b.role
    && a.graphKey === b.graphKey && a.graphEpoch === b.graphEpoch && a.privacyRevision === b.privacyRevision
    && a.nativeSessionId === b.nativeSessionId && a.enrollmentId === b.enrollmentId
    && a.bindingGeneration === b.bindingGeneration && sameScopes(a.scopes, b.scopes);
}
