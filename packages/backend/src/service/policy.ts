import {
  activatePolicyV3Schema, ownerPolicyV3Schema, policyStatusV3Schema, parseContract, uuidSchema, ThreadlineError, ConfigurationError,
  policyPurpose, isContextManifestSourceKind, type OwnerPolicyV3, type PolicyStatusV3,
} from '@threadline/shared';

import { baselinePolicySettings, policyCandidate } from '../effectivePolicy.js';
import { OWNER_POLICY_FILE_NAME, PROJECT_PREFERENCES_FILE_NAME } from '../environment.js';
import { loadProductPolicy, loadProjectPreferences, type ProductPolicySettings } from '../policy.js';
import { canonicalDigest } from '../storage/digest.js';
import { withProjectWriteLock, type SqlDatabase, type TxClient } from '../storage/pg.js';
import { authorizeProjectOwner } from './access.js';
import type { AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';

export interface EffectivePolicySnapshot {
  readonly revision: string;
  readonly settings: ProductPolicySettings;
  readonly digest: string;
  readonly bindingId: string | null;
}
export interface PolicyService {
  current(tenantId: string, projectId: string, transaction?: TxClient): Promise<EffectivePolicySnapshot>;
  inspect(call: AuthenticatedCall, bindingId?: string): Promise<PolicyStatusV3>;
  activate(call: AuthenticatedCall, input: unknown): Promise<OwnerPolicyV3>;
}
interface Head { policy_revision: string; privacy_revision: string; graph_epoch: string }
interface Revision {
  revision: string; binding_id: string; candidate_digest: string; settings: ProductPolicySettings;
  request_digest: string; owner_principal_id: string; owner_state: string;
}
function unavailable(): never {
  throw new ThreadlineError('authority_unavailable', 'Policy needs owner reconciliation before new content work or release.', { reason: 'policy_unavailable' });
}
export function requirePolicyPermission(snapshot: EffectivePolicySnapshot, call: AuthenticatedCall, purpose: 'write' | 'recall' | 'control'): void {
  if (purpose === 'write' && !snapshot.settings.ceilings.manual_record) {
    throw new ThreadlineError('scope_denied', 'Current owner policy does not permit manual recording.');
  }
  if (purpose === 'recall' && !(call.scope.principalKind === 'human'
    ? snapshot.settings.retrieval.allow_explicit_user_requests : snapshot.settings.retrieval.allow_agent_requests)) {
    throw new ThreadlineError('scope_denied', 'Current owner policy does not permit this requested recall.');
  }
}
export function baselinePolicySnapshot(): EffectivePolicySnapshot {
  const settings=baselinePolicySettings();
  return { revision: '0', settings, digest: canonicalDigest({revision:'0',settings}), bindingId: null };
}
/** Receipt qualification alone is historical. Fresh delivery requires the same
 * current revision and current write permission, including the trusted audit
 * exception for existing context-manifest operations. */
export function requireOperationPolicy(snapshot:EffectivePolicySnapshot,admittedRevision:string,kind:string,payload:unknown):void {
  if(snapshot.revision!==admittedRevision)throw new ThreadlineError('stale_revision','Recorded intent uses an earlier policy revision.',{reason:'policy_unavailable'});
  const surface=kind==='source.append' && isContextManifestSourceKind((payload as {sourceKind?:unknown})?.sourceKind) ? 'context.manifest' : kind;
  const purpose=policyPurpose(surface);
  if(purpose===null || purpose==='control' || (purpose==='write' && !snapshot.settings.ceilings.manual_record)) {
    throw new ThreadlineError('authority_unavailable','Current policy does not permit this recorded intent.',{reason:'policy_unavailable'});
  }
}
export function createPolicyService(deps: { readonly db: SqlDatabase; readonly policyHome: string }): PolicyService {
  const head = async (tx: TxClient, tenantId: string, projectId: string): Promise<Head> => {
    const rows = await tx.rows<Head>(`SELECT policy_revision::text,privacy_revision::text,graph_epoch
      FROM threadline_memory.projects WHERE tenant_id=$1 AND id=$2 AND state='active' AND policy_state='ready' FOR SHARE`, [tenantId,projectId]);
    if (!rows[0]) unavailable();
    return rows[0];
  };
  const revision = async (tx: TxClient, tenantId: string, projectId: string, value: string): Promise<Revision> => {
    const rows = await tx.rows<Revision>(`SELECT revision::text,binding_id,candidate_digest,settings,request_digest,owner_principal_id,owner_state
      FROM threadline_memory.policy_revisions
      WHERE tenant_id=$1 AND project_id=$2 AND revision=$3 FOR SHARE`, [tenantId,projectId,value]);
    if (!rows[0]) unavailable();
    return rows[0];
  };
  const candidate = async (tx: TxClient, tenantId: string, projectId: string, bindingId?: string) => {
    if (!deps.policyHome) unavailable();
    const bindings = await tx.rows<{id:string;canonical_root:string}>(`SELECT id,canonical_root
      FROM threadline_memory.workspace_bindings WHERE tenant_id=$1 AND project_id=$2 AND state='active'
        AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at,id LIMIT 2 FOR SHARE`, [tenantId,projectId,bindingId ?? null]);
    if (bindings.length !== 1) throw new ThreadlineError('invalid_request', 'Select one active workspace binding for policy approval.', {field:'bindingId'});
    const binding = bindings[0]!;
    const owner = loadProductPolicy(deps.policyHome);
    const preferences = loadProjectPreferences(binding.canonical_root);
    return { ...policyCandidate(owner,preferences,binding.id), bindingId: binding.id, owner };
  };
  const wire = (projectId: string, row: Head, settings: ProductPolicySettings, ownerPrincipalId: string): OwnerPolicyV3 => ownerPolicyV3Schema.parse({
    protocolVersion:3,projectId,ownerPrincipalId,
    fence:{policyRevision:row.policy_revision,privacyGeneration:row.privacy_revision,graphEpoch:row.graph_epoch},
    ceilings:ceilingsOf(settings),automaticRecall:false,externalInference:false,nativeOccurrenceCapture:false,
  });
  const preview = (settings:ProductPolicySettings):PolicyStatusV3['currentSettings'] => ({
    ceilings:ceilingsOf(settings),
    recall:{allowAgentRequests:settings.retrieval.allow_agent_requests,allowExplicitUserRequests:settings.retrieval.allow_explicit_user_requests,
      maxCandidates:settings.retrieval.max_candidates,optionalWaitMs:settings.retrieval.optional_wait_ms,
      recallMaxTokens:settings.context.recall_max_tokens,followupMaxTokens:settings.context.followup_max_tokens,activeTargetTokens:settings.context.active_target_tokens},
    excludePaths:[...settings.capture.exclude_paths],automaticRecall:false,externalInference:false,nativeOccurrenceCapture:false,
  });
  const service: PolicyService = {
    async current(tenantId,projectId,transaction) {
      const work = async (tx: TxClient): Promise<EffectivePolicySnapshot> => {
        const row = await head(tx,tenantId,projectId);
        if (row.policy_revision === '0') {
          try { if (deps.policyHome && loadProductPolicy(deps.policyHome).state !== 'restrictive-defaults') unavailable(); }
          catch { unavailable(); }
          return baselinePolicySnapshot();
        }
        const approved = await revision(tx,tenantId,projectId,row.policy_revision);
        try {
          const loaded = await candidate(tx,tenantId,projectId,approved.binding_id);
          if (loaded.digest !== approved.candidate_digest) unavailable();
          return {revision:row.policy_revision,settings:loaded.settings,digest:loaded.digest,bindingId:loaded.bindingId};
        } catch { unavailable(); }
      };
      return transaction ? work(transaction) : deps.db.withTenantTransaction(tenantId,work);
    },
    async inspect(call,bindingId) {
      requirePermission(call,'access.admin');
      if(bindingId!==undefined)parseContract(uuidSchema,bindingId,'workspace binding');
      const projectId = call.scope.projectId!;
      return deps.db.withTenantTransaction(call.scope.tenantId,async tx => {
        await authorizeProjectOwner(tx,call,projectId);
        const row = await head(tx,call.scope.tenantId,projectId);
        const approved = row.policy_revision === '0' ? null : await revision(tx,call.scope.tenantId,projectId,row.policy_revision);
        let loaded: Awaited<ReturnType<typeof candidate>> | null = null;
        const diagnostics:PolicyStatusV3['diagnostics']=[];
        let state: PolicyStatusV3['state'] = approved ? 'reconciliation_required' : 'baseline';
        try {
          loaded = await candidate(tx,call.scope.tenantId,projectId,bindingId ?? approved?.binding_id);
          if (approved && loaded.digest === approved.candidate_digest) state='active';
          else if (loaded.owner.state === 'configured' || approved) state='reconciliation_required';
        } catch (error) {
          if(error instanceof ConfigurationError) {
            state='reconciliation_required';
            for(const issue of error.issues.slice(0,8)) {
              const [file,key]=issue.field.split('#');
              diagnostics.push({file:file===PROJECT_PREFERENCES_FILE_NAME?'project':'owner',key:key && /^[a-z_][a-z0-9_.]{0,127}$/.test(key)?key:'document',reason:'invalid_policy',message:`${issue.problem} ${issue.hint}`});
            }
          } else if(error instanceof ThreadlineError && error.code==='invalid_request' && error.details?.field==='bindingId') {
            state='binding_required';diagnostics.push({file:'binding',key:'bindingId',reason:'binding_required',message:'Select one active workspace binding, then inspect its policy candidate before approval.'});
          } else {
            state='reconciliation_required';diagnostics.push({file:'owner',key:'document',reason:'invalid_policy',message:'The policy candidate is unavailable. Restore a readable owner-controlled policy file and retry inspection.'});
          }
        }
        if(approved && loaded && loaded.digest!==approved.candidate_digest)diagnostics.push({file:'owner',key:'document',reason:'reconciliation_required',message:'The files differ from the approved policy. Restore the approved files or inspect and explicitly approve this candidate.'});
        if(approved && loaded?.owner.state==='restrictive-defaults')diagnostics.push({file:'owner',key:'document',reason:'reconciliation_required',message:`The approved ${OWNER_POLICY_FILE_NAME} is missing. Restore it or explicitly approve the displayed restrictive candidate; defaults never activate automatically.`});
        return policyStatusV3Schema.parse({projectId,state,current:wire(projectId,row,
          approved?.settings ?? baselinePolicySettings(),approved?.owner_principal_id ?? call.scope.principalId),
        candidateDigest:loaded?.digest ?? null,candidateCeilings:loaded ? ceilingsOf(loaded.settings) : null,
        bindingId:loaded?.bindingId ?? approved?.binding_id ?? null,
        currentSettings:preview(approved?.settings ?? baselinePolicySettings()),candidateSettings:loaded?preview(loaded.settings):null,diagnostics});
      });
    },
    async activate(call,input) {
      requirePermission(call,'access.admin');
      const parsed = parseContract(activatePolicyV3Schema,input,'policy approval');
      if(parsed.ceilings.checkpointCallbacks)throw new ThreadlineError('unsupported','Checkpoint callbacks are not available for policy activation.');
      if (call.scope.projectId !== parsed.projectId) throw new ThreadlineError('scope_denied','The credential is not scoped to this project.');
      return withProjectWriteLock(deps.db,call.scope.tenantId,parsed.projectId,async tx => {
        await authorizeProjectOwner(tx,call,parsed.projectId);
        const row = await head(tx,call.scope.tenantId,parsed.projectId);
        const digest = canonicalDigest(parsed);
        const known = await tx.rows<Revision>(`SELECT revision::text,binding_id,candidate_digest,settings,request_digest,owner_principal_id,owner_state
          FROM threadline_memory.policy_revisions
          WHERE tenant_id=$1 AND project_id=$2 AND request_id=$3`, [call.scope.tenantId,parsed.projectId,parsed.requestId]);
        if (known[0]) {
          if (known[0].request_digest !== digest || known[0].owner_principal_id !== call.scope.principalId) {
            throw new ThreadlineError('idempotency_mismatch','This policy approval identity names another request.');
          }
          if (known[0].revision !== row.policy_revision || row.privacy_revision !== parsed.guard.expectedPrivacyGeneration) throw new ThreadlineError('stale_revision','The policy has changed since this approval.');
          return wire(parsed.projectId,row,known[0].settings,known[0].owner_principal_id);
        }
        if (row.policy_revision !== parsed.guard.expectedPolicyRevision || row.privacy_revision !== parsed.guard.expectedPrivacyGeneration) {
          throw new ThreadlineError('stale_revision','Policy or privacy changed; inspect and approve the current candidate.');
        }
        let loaded:Awaited<ReturnType<typeof candidate>>;
        try {loaded=await candidate(tx,call.scope.tenantId,parsed.projectId,parsed.bindingId);}
        catch(error) {
          if(error instanceof ConfigurationError)throw new ThreadlineError('invalid_request','Policy files could not be loaded. Inspect project policy status for safe file/key recovery guidance.',{field:'candidateDigest'});
          throw error;
        }
        if (loaded.digest !== parsed.candidateDigest || canonicalDigest(ceilingsOf(loaded.settings)) !== canonicalDigest(parsed.ceilings)) {
          throw new ThreadlineError('stale_revision','The policy candidate changed; inspect it before approval.');
        }
        const next = BigInt(row.policy_revision)+1n;
        if (next > 9223372036854775807n) unavailable();
        await tx.rows(`INSERT INTO threadline_memory.policy_revisions
          (tenant_id,project_id,revision,owner_principal_id,owner_token_id,binding_id,request_id,request_digest,candidate_digest,settings,owner_state)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`, [call.scope.tenantId,parsed.projectId,next.toString(),call.scope.principalId,
          call.tokenId,loaded.bindingId,parsed.requestId,digest,loaded.digest,JSON.stringify(loaded.settings),loaded.owner.state]);
        const advanced=await tx.rows(`UPDATE threadline_memory.projects SET policy_revision=$3
          WHERE tenant_id=$1 AND id=$2 AND policy_revision=$4 AND privacy_revision=$5 RETURNING id`,
          [call.scope.tenantId,parsed.projectId,next.toString(),parsed.guard.expectedPolicyRevision,parsed.guard.expectedPrivacyGeneration]);
        if(advanced.length!==1)throw new ThreadlineError('stale_revision','Policy or privacy changed; inspect and approve the current candidate.');
        return wire(parsed.projectId,{...row,policy_revision:next.toString()},loaded.settings,call.scope.principalId);
      });
    },
  };
  return service;
}
export function ceilingsOf(settings: ProductPolicySettings): OwnerPolicyV3['ceilings'] {
  return {manualRecord:settings.ceilings.manual_record,checkpointCallbacks:false,maxPayloadBytes:settings.ceilings.max_payload_bytes,
    maxBatchRecords:settings.ceilings.max_batch_records,retentionDays:settings.ceilings.retention_days};
}
