import { randomUUID } from 'node:crypto';

import { ThreadlineError, policyPurpose } from '@threadline/shared';

import { assertSafeAdmissionInput, assertPolicyInputLimits, ADMISSION_SCANNER_VERSION } from '../admission.js';
export { assertSafeText, assertSafeJson, assertSafeAdmissionInput, ADMISSION_POLICY_REVISION, ADMISSION_SCANNER_VERSION } from '../admission.js';

import { createPolicyService, baselinePolicySnapshot, requirePolicyPermission, type PolicyService, type EffectivePolicySnapshot } from './policy.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { identityOf, lockReleaseAuthority, type ReleaseAuthority } from './release.js';

export interface AdmissionTicket { readonly id: string }
export interface AdmissionService {
  check(call: AuthenticatedCall, surface: string, input: unknown, transaction?: TxClient): Promise<AdmissionTicket>;
  revalidate(ticket: AdmissionTicket, tx: TxClient): Promise<void>;
  /** Workers must not promote historical, unqualified payloads. */
  readonly policies: PolicyService;
  policy(ticket: AdmissionTicket): EffectivePolicySnapshot;
  requireCurrentPolicy(tenantId: string, projectId: string, transaction?: TxClient): Promise<EffectivePolicySnapshot>;
}

export function createAdmissionService(deps: { readonly db: SqlDatabase; readonly policyHome?: string; readonly policies?: PolicyService }): AdmissionService {
  const issued = new WeakMap<AdmissionTicket, { call: AuthenticatedCall; authority: ReleaseAuthority; policy: EffectivePolicySnapshot; purpose: 'write' | 'recall' | 'control' }>();
  if(!deps.policies && !deps.policyHome)throw new ThreadlineError('authority_unavailable','An explicit policy service or policy home is required.');
  const policies = deps.policies ?? createPolicyService({db:deps.db,policyHome:deps.policyHome!});
  return {
    policies,
    requireCurrentPolicy: (tenantId,projectId,transaction) => policies.current(tenantId,projectId,transaction),
    policy(ticket) {
      const state = issued.get(ticket);
      if (!state) throw new ThreadlineError('authority_unavailable','Current request policy is required.');
      return state.policy;
    },
    async check(call, surface, input, transaction) {
      if (!/^[a-z][a-zA-Z.]{0,63}$/.test(surface)) throw new ThreadlineError('internal_error', 'Invalid admission surface.');
      const id = randomUUID();
      let failure: unknown;
      let policy = baselinePolicySnapshot();
      const purpose = policyPurpose(surface);
      if(purpose===null)throw new ThreadlineError('scope_denied','This action has no policy purpose contract.');
      const check = async (tx: TxClient): Promise<ReleaseAuthority> => {
        const authority = await lockReleaseAuthority(tx, identityOf(call));
        requireMatchingAuthority(call, authority);
        try {
          if (call.scope.projectId && purpose!=='control') policy = await policies.current(call.scope.tenantId,call.scope.projectId,tx);
          requirePolicyPermission(policy,call,purpose);
          assertSafeAdmissionInput(input,{revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths});
          if(purpose!=='control')assertPolicyInputLimits(input,{maxPayloadBytes:policy.settings.ceilings.max_payload_bytes,maxBatchRecords:policy.settings.ceilings.max_batch_records});
        } catch (error) { failure = error; }
        await tx.rows(`INSERT INTO threadline_memory.ingress_admissions
          (tenant_id,id,principal_id,token_id,project_id,surface,policy_revision,sanitizer_version,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [call.scope.tenantId,id,call.scope.principalId,call.tokenId,
          call.scope.projectId,surface,policy.revision,ADMISSION_SCANNER_VERSION,failure ? 'refused' : 'accepted']);
        return authority;
      };
      const authority = transaction ? await check(transaction) : await deps.db.withTenantTransaction(call.scope.tenantId, check);
      if (failure) throw failure;
      const ticket = Object.freeze({ id });
      issued.set(ticket, { call, authority, policy, purpose });
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
      const policy = state.call.scope.projectId && state.purpose!=='control' ? await policies.current(state.call.scope.tenantId,state.call.scope.projectId,tx) : baselinePolicySnapshot();
      if (policy.revision !== state.policy.revision) throw new ThreadlineError('stale_revision','Effective policy changed; retry admission.');
      requirePolicyPermission(policy,state.call,state.purpose);
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
