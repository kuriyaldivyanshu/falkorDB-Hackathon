import { requirePolicyPermission, type PolicyService, type EffectivePolicySnapshot } from './policy.js';
import { assertSafeAdmissionInput, assertSafeText, assertPolicyInputLimits } from '../admission.js';
import { hasOperationAdmission } from '../admission.js';
export { hasOperationAdmission } from '../admission.js';
import { randomUUID } from 'node:crypto';

import { POLICY_CONTROL_SURFACES, ThreadlineError } from '@threadline/shared';

import { canonicalDigest } from '../storage/digest.js';
import type { SourceFileStore } from '../storage/files.js';
import type { GraphStore } from '../storage/graph.js';
import { projectRootIdFor, readProjectRoot } from '../storage/memoryGraph.js';
import { lockProjectBarriers, type SqlDatabase, type TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { PRODUCER_AUTHORITY_SQL } from './nativeAuthority.js';

export const RELEASE_LIMITS = Object.freeze({ projects: 16, dependencies: 256, depth: 32,
  responseBytes: 1_048_576, sourceBytes: 67_108_864, workMs: 15_000 });

type ResourceKind = 'source' | 'memory' | 'version' | 'task' | 'operation' | 'occurrence' | 'project';
export interface ReleaseResource { readonly projectId: string; readonly kind: ResourceKind; readonly id: string }
export interface ReleaseIdentity {
  readonly tenantId: string; readonly projectId: string | null; readonly tokenId: string; readonly principalId: string;
}
export interface ReleaseAuthority {
  tokenKind: string; principalKind: string; role: string | null; scopes: string[] | null;
  graphKey: string | null; graphEpoch: string | null; privacyRevision: string | null;
  nativeSessionId: string | null; enrollmentId: string | null; bindingGeneration: number;
}

/** The authority rows remain shared-locked until the permit (or graph outcome)
 * commits. Revocation UPDATE/DELETE conflicts with these exact rows. Expiry is
 * checked using advancing SQL time, including a final check before the permit.
 */
export async function lockReleaseAuthority(tx: TxClient, identity: ReleaseIdentity): Promise<ReleaseAuthority> {
  return currentAuthority(tx, identity, true);
}

async function currentAuthority(tx: TxClient, identity: ReleaseIdentity, lock: boolean): Promise<ReleaseAuthority> {
  const shared = lock ? ' FOR SHARE' : '';
  const { tenantId, projectId, tokenId, principalId } = identity;
  const tokens = await tx.rows<{ kind: string; project_id: string | null; scopes: string[] | null;
    native_session_id: string | null; enrollment_id: string | null; binding_generation: number }>(
    `SELECT kind,project_id,scopes,native_session_id,enrollment_id,binding_generation
     FROM threadline_memory.client_tokens WHERE tenant_id=$1 AND id=$2 AND principal_id=$3
       AND state='active' AND revoked_at IS NULL AND expires_at>clock_timestamp()
       AND idle_expires_at>clock_timestamp()${shared}`, [tenantId, tokenId, principalId]);
  const token = tokens[0];
  if (!token || (token.project_id !== null && token.project_id !== projectId)) deny();
  const principals = await tx.rows<{ kind: string }>(`SELECT kind FROM threadline_memory.principals
    WHERE tenant_id=$1 AND id=$2 AND state='active'${shared}`, [tenantId, principalId]);
  const principal = principals[0];
  if (!principal) deny();
  let role: string | null = null;
  let project: { graph_key: string; graph_epoch: string; privacy_revision: string } | undefined;
  if (projectId !== null) {
    const projects = await tx.rows<{ graph_key: string; graph_epoch: string; privacy_revision: string }>(
      `SELECT graph_key,graph_epoch,privacy_revision::text AS privacy_revision FROM threadline_memory.projects
       WHERE tenant_id=$1 AND id=$2 AND state='active' AND policy_state='ready'${shared}`, [tenantId, projectId]);
    project = projects[0];
    if (!project) deny();
    const grants = await tx.rows<{ role: string }>(`SELECT role FROM threadline_memory.project_grants
      WHERE tenant_id=$1 AND project_id=$2 AND principal_id=$3 AND state='active'${shared}`,
    [tenantId, projectId, principalId]);
    role = grants[0]?.role ?? null;
    if (role === null) deny();
  } else if (token.kind !== 'human_admin') deny();
  if (token.kind === 'reader' && (role !== 'reader' || principal.kind !== 'service' || token.project_id !== projectId
    || token.enrollment_id !== null || token.native_session_id !== null)) deny();
  if (token.kind === 'producer') {
    // Lock every row used by the shared producer predicate, including the
    // binding and optional pinned session: EXISTS alone acquires no row locks.
    const enrollments = await tx.rows<{ binding_id: string }>(`SELECT binding_id
      FROM threadline_memory.native_enrollments WHERE tenant_id=$1 AND project_id=$2 AND id=$3${shared}`,
    [tenantId, projectId, token.enrollment_id]);
    const bindingId = enrollments[0]?.binding_id;
    if (!bindingId) deny();
    await tx.rows(`SELECT id FROM threadline_memory.workspace_bindings
      WHERE tenant_id=$1 AND project_id=$2 AND id=$3${shared}`, [tenantId, projectId, bindingId]);
    if (token.native_session_id !== null) await tx.rows(`SELECT id FROM threadline_memory.native_sessions
      WHERE tenant_id=$1 AND project_id=$2 AND id=$3${shared}`, [tenantId, projectId, token.native_session_id]);
    const active = await tx.rows(`SELECT t.id FROM threadline_memory.client_tokens t
      JOIN threadline_memory.principals a ON a.tenant_id=t.tenant_id AND a.id=t.principal_id
      JOIN threadline_memory.projects p ON p.tenant_id=t.tenant_id AND p.id=$2
      JOIN threadline_memory.project_grants g ON g.tenant_id=p.tenant_id AND g.project_id=p.id AND g.principal_id=t.principal_id
      WHERE t.tenant_id=$1 AND t.id=$3 AND ${PRODUCER_AUTHORITY_SQL}`, [tenantId, projectId, tokenId]);
    if (active.length !== 1) deny();
  }
  return { tokenKind: token.kind, principalKind: principal.kind, role, scopes: token.scopes,
    graphKey: project?.graph_key ?? null, graphEpoch: project?.graph_epoch ?? null,
    privacyRevision: project?.privacy_revision ?? null, nativeSessionId: token.native_session_id,
    enrollmentId: token.enrollment_id, bindingGeneration: token.binding_generation };
}

export interface AdmissionSelection { readonly kind: string; readonly sourceIds?: readonly string[]; readonly operationIds?: readonly string[] }
export interface ReleaseSelection { readonly resources: readonly ReleaseResource[]; readonly admission?: AdmissionSelection; readonly policyRevision?: string }

interface DependencySnapshot { resources: ReleaseResource[]; projects: string[]; fingerprint: string; policies: Record<string,string> }
export interface ReleaseTicket {
  readonly requestId: string; readonly call: AuthenticatedCall; readonly startedAt: number;
  readonly surface: string; readonly roots: ReadonlyMap<string, string>; readonly seeds: readonly ReleaseResource[]; readonly graphRead: boolean; readonly policyRevision: string | null;
}
export interface ReleaseService {
  policy(call: AuthenticatedCall, transaction?: TxClient): Promise<EffectivePolicySnapshot>;
  begin(call: AuthenticatedCall, surface: string, seeds?: readonly ReleaseResource[], graphRead?: boolean): Promise<ReleaseTicket>;
  /** Prepared JSON bytes go straight back to onSend after this commit. No
   * permit is returned to a caller or accepted as authorization on a later call. */
  permit(ticket: ReleaseTicket, payload: string, selection: ReleaseSelection): Promise<void>;
  eligibleMany(call: AuthenticatedCall, resources: readonly (readonly ReleaseResource[])[], transaction?: TxClient, deadline?: number): Promise<boolean[]>;
  eligible(call: AuthenticatedCall, resources: readonly ReleaseResource[], transaction?: TxClient, deadline?: number): Promise<boolean>;
}

export function createReleaseService(deps: { db: SqlDatabase; graphStore?: GraphStore; files: SourceFileStore; policies: PolicyService }): ReleaseService {
  const policies = deps.policies;
  const graphStore = (): GraphStore => {
    if (!deps.graphStore) throw new ThreadlineError('authority_unavailable', 'Current graph authority is unavailable.');
    return deps.graphStore;
  };
  const verifiedFiles = new WeakMap<AuthenticatedCall, Map<string, Promise<void>>>();
  const issued = new WeakSet<ReleaseTicket>();
  const deadlines = new WeakMap<AuthenticatedCall, number>();
  const consumed = new WeakSet<ReleaseTicket>();
  const projectRoot = async (call: AuthenticatedCall, projectId: string, tx?: TxClient): Promise<string> => {
    const read = (sql: TxClient) => sql.rows<{ graph_key: string; graph_epoch: string; privacy_revision: string }>(
      `SELECT graph_key,graph_epoch,privacy_revision::text AS privacy_revision FROM threadline_memory.projects
       WHERE tenant_id=$1 AND id=$2 AND state='active' AND policy_state='ready'`, [call.scope.tenantId, projectId]);
    const p = (tx ? await read(tx) : await deps.db.withTenantTransaction(call.scope.tenantId, read))[0];
    if (!p) deny();
    try {
      const root = await readProjectRoot(graphStore().graph(p.graph_key), projectRootIdFor(projectId));
      if (root !== null && (root.graphEpoch !== p.graph_epoch || root.privacyRevision !== p.privacy_revision || root.state !== 'active')) stale();
      return digest({ ...p, root });
    } catch (error) {
      if (error instanceof ThreadlineError) throw error;
      throw new ThreadlineError('authority_unavailable', 'Current graph authority is unavailable.');
    }
  };

  const closure = async (call: AuthenticatedCall, seeds: readonly ReleaseResource[], tx: TxClient, deadline: number, verifyBytes = true, enforcePolicy = true): Promise<DependencySnapshot> => {
    const seen = new Map<string, ReleaseResource>();
    const facts: unknown[] = [];
    const currentPolicies = new Map<string,EffectivePolicySnapshot>();
    const projects = new Set<string>(call.scope.projectId === null ? [] : [call.scope.projectId]);
    const checkedProjects = new Set<string>();
    let frontier = [...seeds];
    let bytes = 0;
    for (let depth = 0; frontier.length; depth++) {
      if (depth >= RELEASE_LIMITS.depth) broad();
      const next: ReleaseResource[] = [];
      for (const resource of frontier.sort((a, b) => key(a).localeCompare(key(b)))) {
        within(deadline);
        if (seen.has(key(resource))) continue;
        seen.set(key(resource), resource); projects.add(resource.projectId);
        if (!checkedProjects.has(resource.projectId)) {
          await currentAuthority(tx, {...identityOf(call),projectId:resource.projectId}, false);
          checkedProjects.add(resource.projectId);
        }
        if (seen.size > RELEASE_LIMITS.dependencies || projects.size > RELEASE_LIMITS.projects) broad();
        if (enforcePolicy && !currentPolicies.has(resource.projectId)) {
          const policy = await policies.current(call.scope.tenantId,resource.projectId,tx);
          requirePolicyPermission(policy,call,'recall');
          currentPolicies.set(resource.projectId,policy);
          facts.push({projectId:resource.projectId,policyRevision:policy.revision,policyDigest:policy.digest});
        }
        const policy = currentPolicies.get(resource.projectId);
        const identity = [call.scope.tenantId, resource.projectId, resource.id];
        const denied = await tx.rows(`SELECT resource_id FROM threadline_memory.release_denials
          WHERE tenant_id=$1 AND project_id=$2 AND resource_kind=$3 AND resource_id=$4`,
        [identity[0], identity[1], resource.kind, identity[2]]);
        if (denied.length) deny();
        const links = await tx.rows<{ dependency_project_id: string; dependency_kind: ResourceKind; dependency_id: string }>(
          `SELECT dependency_project_id,dependency_kind,dependency_id FROM threadline_memory.release_dependencies
           WHERE tenant_id=$1 AND project_id=$2 AND resource_kind=$3 AND resource_id=$4
           ORDER BY dependency_project_id,dependency_kind,dependency_id LIMIT 257`,
        [identity[0],identity[1],resource.kind,identity[2]]);
        if (links.length > RELEASE_LIMITS.dependencies) broad();
        facts.push({resource, links});
        const add = (kind: ResourceKind, id: unknown, projectId = resource.projectId): void => {
          if (typeof id !== 'string' || !UUID.test(id)) deny();
          next.push({ projectId, kind, id });
        };
        for (const link of links) add(link.dependency_kind,link.dependency_id,link.dependency_project_id);
        if (resource.kind === 'project') {
          const rows = await tx.rows(`SELECT graph_key,graph_epoch,privacy_revision::text,policy_state,state
            FROM threadline_memory.projects WHERE tenant_id=$1 AND id=$2`, identity.slice(0,2));
          if (rows.length !== 1) deny(); facts.push({resource, row: rows[0]});
        } else if (resource.kind === 'source') {
          const rows = await tx.rows<{ id: string; availability: string; visibility: string; owner_principal_id: string | null;
            digest: string; byte_size: string; storage_key: string; deletion_generation: string; release_state: string; kind: string }>(
            `SELECT id,availability,visibility,owner_principal_id,digest,byte_size::text AS byte_size,storage_key,
             deletion_generation::text AS deletion_generation,release_state,kind,origin_key,origin_revision,parent_origin_key,
             native_turn_ref,native_item_ref,native_tool_ref,media_type,gap_reason FROM threadline_memory.sources
             WHERE tenant_id=$1 AND project_id=$2 AND id=$3
               AND ($4::integer IS NULL OR captured_at >= clock_timestamp()-make_interval(days=>$4::integer))`,
            [...identity,policy?.settings.ceilings.retention_days ?? null]);
          const row = rows[0];
          if (!row || row.availability !== 'available' || row.release_state !== 'eligible'
            || (row.visibility !== 'project' && row.owner_principal_id !== call.scope.principalId)) deny();
          const size = Number(row.byte_size);
          bytes += size;
          if (!Number.isSafeInteger(size) || size < 0 || bytes > RELEASE_LIMITS.sourceBytes) broad();
          if (verifyBytes) {
            let cache = verifiedFiles.get(call);
            if (!cache) { cache = new Map(); verifiedFiles.set(call,cache); }
            const fileKey = `${resource.projectId}:${row.storage_key}:${row.digest}:${size}:${policy?.revision ?? 'metadata'}`;
            if (!cache.has(fileKey)) cache.set(fileKey, deps.files.readRange({tenantId:call.scope.tenantId,
              projectId:resource.projectId,storageKey:row.storage_key,digest:row.digest,byteSize:size,
              maxBytes:RELEASE_LIMITS.sourceBytes,start:0,end:policy ? size : 0}).then(range=>{
                if (!policy) return;
                const scanner = {revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths};
                try {
                  assertSafeAdmissionInput(Object.fromEntries(Object.entries(row).filter(([,value])=>typeof value==='string')),scanner);
                  const text = new TextDecoder('utf-8',{fatal:true}).decode(range.bytes);
                  if (row.kind==='memory_proposal') {
                    const document = JSON.parse(text) as {content?:unknown;applicability?:unknown;observedUnder?:unknown};
                    assertSafeAdmissionInput(document,scanner);
                    assertPolicyInputLimits(document,{maxPayloadBytes:policy.settings.ceilings.max_payload_bytes,maxBatchRecords:policy.settings.ceilings.max_batch_records});
                  } else {
                    if(size>policy.settings.ceilings.max_payload_bytes)deny();
                    assertSafeText(text,scanner);
                  }
                } catch { deny(); }
              }));
            await cache.get(fileKey);
          }
          const links = await tx.rows<{ parent_source_id: string }>(`SELECT parent_source_id FROM threadline_memory.source_links
            WHERE tenant_id=$1 AND project_id=$2 AND child_source_id=$3 ORDER BY parent_source_id LIMIT 257`, identity);
          if (links.length > RELEASE_LIMITS.dependencies) broad();
          facts.push({ resource, row, links });
          for (const link of links) add('source', link.parent_source_id);
        } else if (resource.kind === 'operation') {
          if (!await hasOperationAdmission(tx, call.scope.tenantId, resource.projectId, resource.id)) deny();
          const rows = await tx.rows<{ intent_source_id: string | null; intent_memory_id: string | null;
            intent_version_id: string | null; intent_task_id: string | null; state: string;
            kind: string; payload:unknown; memory_mode: string | null; expected_head_token: string | null }>(
            `SELECT intent_source_id,intent_memory_id,intent_version_id,intent_task_id,state,kind,payload,
             payload->>'memoryMode' AS memory_mode,expected_head_token
             FROM threadline_memory.operations WHERE tenant_id=$1 AND project_id=$2 AND id=$3`, identity);
          const row = rows[0]; if (!row) deny();
          if(policy)try {
            assertSafeAdmissionInput(row.payload,{revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths});
            assertPolicyInputLimits(row.payload,{maxPayloadBytes:policy.settings.ceilings.max_payload_bytes,maxBatchRecords:policy.settings.ceilings.max_batch_records});
          } catch {deny();}
          facts.push({ resource, row });
          // Denial applies to reserved identities before graph materialization,
          // independently of operation state. Existence is required only for
          // identities that the operation references rather than creates.
          const targets = [
            ['source', row.intent_source_id], ['memory', row.intent_memory_id],
            ['version', row.intent_version_id], ['task', row.intent_task_id],
            ['version', row.expected_head_token],
          ] as const;
          for (const [kind,id] of targets) {
            if (id === null) continue;
            const denied = await tx.rows(`SELECT resource_id FROM threadline_memory.release_denials
              WHERE tenant_id=$1 AND project_id=$2 AND resource_kind=$3 AND resource_id=$4`,
            [identity[0],identity[1],kind,id]);
            if (denied.length) deny();
          }
          if (row.intent_source_id) add('source',row.intent_source_id);
          const existingMemory = ['memory.accept','memory.correct','task.require'].includes(row.kind)
            || (row.kind === 'memory.propose' && row.memory_mode === 'attach');
          if (row.intent_memory_id && (existingMemory || row.state === 'committed')) add('memory',row.intent_memory_id);
          if (row.intent_version_id && (row.kind === 'memory.accept' || row.state === 'committed')) add('version',row.intent_version_id);
          if (row.expected_head_token) add('version',row.expected_head_token);
          if (row.intent_task_id && (row.kind !== 'task.create' || row.state === 'committed')) add('task',row.intent_task_id);
        } else if (resource.kind === 'occurrence') {
          const rows = await tx.rows<{ manifest_source_id: string; task_id: string | null }>(
            `SELECT manifest_source_id,task_id FROM threadline_memory.context_occurrences
             WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND principal_id=$4 AND token_id=$5`,
          [...identity, call.scope.principalId, call.tokenId]);
          const row = rows[0]; if (!row) deny();
          facts.push({ resource, row }); add('source', row.manifest_source_id);
          if (row.task_id) add('task', row.task_id);
        } else {
          const p = (await tx.rows<{ graph_key: string }>(`SELECT graph_key FROM threadline_memory.projects
            WHERE tenant_id=$1 AND id=$2`, identity.slice(0, 2)))[0];
          if (!p) deny();
          // Fixed one-hop dependency expansion, iterated with visited/depth/node
          // bounds. Project membership of every target is resolved explicitly;
          // a corrupt/cross-project edge can never inherit the origin grant.
          const graph = graphStore().graph(p.graph_key);
          const reply = await graph.roQuery<{ id: string; project_id: string; kind: string;
            properties: { supersedes_version_id?: string; origin_task_id?: string } }>(
            `MATCH (root:Entity:ProjectRoot)-[:HAS_MEMORY|HAS_TASK]->(owner:Entity)
             OPTIONAL MATCH (owner)-[:HAS_VERSION]->(v:Entity:MemoryVersion)
             WITH root,owner,v WHERE ($kind='version' AND v.id=$id)
               OR ($kind='memory' AND owner:Memory AND owner.id=$id)
               OR ($kind='task' AND owner:Task AND owner.id=$id)
             WITH DISTINCT root,CASE WHEN $kind='version' THEN v ELSE owner END AS target
             RETURN target.id AS id,root.project_id AS project_id,
               CASE WHEN target:MemoryVersion THEN 'version' WHEN target:Memory THEN 'memory' ELSE 'task' END AS kind,
               properties(target) AS properties LIMIT 2`,
          { params: { id: resource.id, kind: resource.kind }, TIMEOUT: remainingGraphTime(deadline) });
          const rows = reply.data ?? [];
          if (rows.length !== 1) deny();
          const row = rows[0]!;
          if (row.project_id !== resource.projectId || row.kind !== resource.kind) deny();
          if (policy) {
            const scanner = {revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths};
            try {
              assertPolicyInputLimits(row.properties,{maxPayloadBytes:policy.settings.ceilings.max_payload_bytes,maxBatchRecords:policy.settings.ceilings.max_batch_records});
              for(const [field,value] of Object.entries(row.properties)) if(typeof value==='string') {
                if(field.endsWith('_json')) assertSafeAdmissionInput(JSON.parse(value),scanner);
                else assertSafeText(value,scanner);
              }
            } catch { deny(); }
          }
          const edges = await graph.roQuery<{ id: string; labels: string[] }>(
            `MATCH (target:Entity {id:$id})-[:SOURCED_FROM|CONTRADICTS|SUPPORTED_BY|SUPERSEDES|REQUIRES|CURRENT|HAS_VERSION]->(d:Entity)
             RETURN DISTINCT d.id AS id,labels(d) AS labels ORDER BY id LIMIT 257`,
          {params: {id: resource.id}, TIMEOUT: remainingGraphTime(deadline)});
          const dependencies = edges.data ?? [];
          if (dependencies.length > RELEASE_LIMITS.dependencies) broad();
          facts.push({ resource, row, dependencies });
          if (row.properties.supersedes_version_id) add('version', row.properties.supersedes_version_id);
          if (row.properties.origin_task_id) add('task', row.properties.origin_task_id);
          for (const dependency of dependencies) {
            within(deadline);
            if (dependency.labels.includes('SourceAnchor')) { add('source', dependency.id); continue; }
            const kind = dependency.labels.includes('MemoryVersion') ? 'version'
              : dependency.labels.includes('Memory') ? 'memory' : dependency.labels.includes('Task') ? 'task' : null;
            if (kind === null) deny();
            const refs = await graph.roQuery<{ project_id: string }>(
              `MATCH (r:Entity:ProjectRoot)-[:HAS_MEMORY|HAS_TASK]->(o:Entity)
               OPTIONAL MATCH (o)-[:HAS_VERSION]->(v:Entity:MemoryVersion)
               WITH r,o,v WHERE o.id=$id OR v.id=$id
               RETURN DISTINCT r.project_id AS project_id LIMIT 2`,
            { params: { id: dependency.id }, TIMEOUT: remainingGraphTime(deadline) });
            const resolved = refs.data ?? []; if (resolved.length !== 1) deny();
            add(kind, dependency.id, resolved[0]!.project_id);
          }
          // Legacy graph payloads have no safe-ingress attestation. Preserve
          // them privately until the owning ingress/reprocessing work qualifies
          // them; a graph identity/digest is not a sanitizer certificate.
          const safety = await tx.rows(`SELECT resource_id FROM threadline_memory.release_safety
            WHERE tenant_id=$1 AND project_id=$2 AND resource_kind=$3 AND resource_id=$4 AND state='eligible'`,
          [identity[0], identity[1], resource.kind, identity[2]]);
          if (safety.length !== 1) deny();
        }
      }
      frontier = next;
    }
    return { resources: [...seen.values()].sort((a,b) => key(a).localeCompare(key(b))),
      projects: [...projects].sort(), fingerprint: digest(facts), policies:Object.fromEntries([...currentPolicies].map(([id,policy])=>[id,policy.revision])) };
  };

  return {
    async policy(call,transaction) {
      if (!call.scope.projectId) throw new ThreadlineError('scope_denied','Project policy is required.');
      const policy = await policies.current(call.scope.tenantId,call.scope.projectId,transaction);
      requirePolicyPermission(policy,call,'recall');
      return policy;
    },
    async begin(call, surface, seeds = [], graphRead = true) {
      let policyRevision: string | null = null;
      if (call.scope.projectId && policyPurpose(surface)!=='control') {
        const policy = await policies.current(call.scope.tenantId,call.scope.projectId);
        requirePolicyPermission(policy,call,policyPurpose(surface));
        policyRevision = policy.revision;
      }
      const startedAt = Date.now();
      deadlines.set(call, startedAt + RELEASE_LIMITS.workMs);
      verifiedFiles.set(call,new Map());
      const roots = new Map<string, string>();
      if (graphRead && call.scope.projectId !== null) roots.set(call.scope.projectId, await projectRoot(call, call.scope.projectId));
      const ticket: ReleaseTicket = { requestId: randomUUID(), call, surface, seeds, roots, startedAt, graphRead, policyRevision };
      issued.add(ticket); return ticket;
    },
    async eligible(call, resources, transaction, deadline) {
      try {
        const work = (tx: TxClient) => closure(call, resources, tx, Math.min(deadlines.get(call) ?? Infinity, deadline ?? Date.now() + RELEASE_LIMITS.workMs));
        if (transaction) await work(transaction); else await deps.db.withTenantTransaction(call.scope.tenantId, work);
        return true;
      } catch (error) {
        if (error instanceof ThreadlineError && error.code === 'scope_denied') return false;
        throw error;
      }
    },
    async eligibleMany(call, groups, transaction, explicitDeadline) {
      const deadline = Math.min(deadlines.get(call) ?? Infinity,explicitDeadline ?? Date.now()+RELEASE_LIMITS.workMs);
      within(deadline);
      const work = async(tx: TxClient): Promise<boolean[]> => {
        const results: boolean[] = [];
        for (const resources of groups) {
          within(deadline);
          try { await closure(call,resources,tx,deadline); results.push(true); }
          catch(error) {
            if (error instanceof ThreadlineError && error.code === 'scope_denied') results.push(false);
            else throw error;
          }
        }
        return results;
      };
      return transaction ? work(transaction) : deps.db.withTenantTransaction(call.scope.tenantId,work);
    },
    async permit(ticket, payload, selection) {
      if (!issued.has(ticket) || consumed.has(ticket)) deny();
      consumed.add(ticket);
      const deadline = ticket.startedAt + RELEASE_LIMITS.workMs;
      within(deadline);
      if (Buffer.byteLength(payload) > RELEASE_LIMITS.responseBytes) broad();
      if (!selection || !Array.isArray(selection.resources)) deny();
      const seeds = [...ticket.seeds, ...selection.resources];
      const { call } = ticket;
      const checkPolicy = async(tx:TxClient):Promise<void> => {
        if (!call.scope.projectId || ticket.policyRevision===null) return;
        const policy = await policies.current(call.scope.tenantId,call.scope.projectId,tx);
        if(policy.revision!==ticket.policyRevision)stale();
        requirePolicyPermission(policy,call,policyPurpose(ticket.surface));
        try { assertSafeAdmissionInput(JSON.parse(payload),{revision:policy.revision,excludedPaths:policy.settings.capture.exclude_paths}); }
        catch { deny(); }
      };
      if (selection?.admission) {
        // Content-free acknowledgement of this credential's own admission only.
        // Arbitrary requested targets never receive an eligibility exemption.
        await deps.db.withTenantTransaction(call.scope.tenantId,async(tx)=>{
          if (call.scope.projectId === null) deny();
          await lockProjectBarriers(tx,call.scope.tenantId,[call.scope.projectId], 'shared');
          compareAuthority(call,await lockReleaseAuthority(tx,identityOf(call)));
          await checkPolicy(tx);
          for (const id of selection.admission!.sourceIds ?? []) {
            const rows = await tx.rows<{ id: string; operation_id: string }>(`SELECT s.id,o.id AS operation_id FROM threadline_memory.sources s
              JOIN threadline_memory.operations o ON o.tenant_id=s.tenant_id AND o.project_id=s.project_id AND o.intent_source_id=s.id AND o.kind='source.append'
              WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3 AND o.actor_token_id=$4 AND o.actor_principal_id=$5`,
              [call.scope.tenantId,call.scope.projectId,id,call.tokenId,call.scope.principalId]);
            if (rows.length !== 1 || !await hasOperationAdmission(tx, call.scope.tenantId, call.scope.projectId, rows[0]!.operation_id)) deny();
            if ((await tx.rows(`SELECT resource_id FROM threadline_memory.release_denials WHERE tenant_id=$1 AND project_id=$2 AND resource_kind='source' AND resource_id=$3`,[call.scope.tenantId,call.scope.projectId,id])).length) deny();
          }
          for (const id of selection.admission!.operationIds ?? []) {
            if (!await hasOperationAdmission(tx, call.scope.tenantId, call.scope.projectId, id)) deny();
            const rows=await tx.rows<{intent_source_id:string|null;intent_memory_id:string|null;intent_version_id:string|null;intent_task_id:string|null}>(
              `SELECT intent_source_id,intent_memory_id,intent_version_id,intent_task_id FROM threadline_memory.operations
               WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND actor_token_id=$4 AND actor_principal_id=$5 AND kind=$6`,
              [call.scope.tenantId,call.scope.projectId,id,call.tokenId,call.scope.principalId,selection.admission!.kind]);
            const row=rows[0];if(!row)deny();
            for(const [kind,target] of [['operation',id],['source',row.intent_source_id],['memory',row.intent_memory_id],['version',row.intent_version_id],['task',row.intent_task_id]] as const) {
              if(target && (await tx.rows(`SELECT resource_id FROM threadline_memory.release_denials WHERE tenant_id=$1 AND project_id=$2 AND resource_kind=$3 AND resource_id=$4`,[call.scope.tenantId,call.scope.projectId,kind,target])).length)deny();
            }
          }
          within(deadline);await lockReleaseAuthority(tx,identityOf(call));
          await insertPermit(tx,ticket,payload,[call.scope.projectId],0);
        });
        return;
      }
      const before = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) => closure(call, seeds, tx, deadline,true,policyPurpose(ticket.surface)!=='control'));
      // Discover the complete closure before acquiring ANY project lock.
      await deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
          await lockProjectBarriers(tx, call.scope.tenantId, before.projects, 'shared');
          const authority = await lockReleaseAuthority(tx, identityOf(call));
          compareAuthority(call, authority);
          await checkPolicy(tx);
          if(selection.policyRevision!==undefined && call.scope.projectId) {
            const current = await tx.rows<{policy_revision:string}>(`SELECT policy_revision::text FROM threadline_memory.projects WHERE tenant_id=$1 AND id=$2`,[call.scope.tenantId,call.scope.projectId]);
            if(current[0]?.policy_revision!==selection.policyRevision)stale();
          }
          for (const projectId of before.projects) {
            if (projectId !== call.scope.projectId) await lockReleaseAuthority(tx, { ...identityOf(call), projectId });
          }
          const unresolved = await tx.rows(`SELECT operation_id FROM threadline_memory.graph_submissions
            WHERE tenant_id=$1 AND project_id=ANY($2::uuid[]) LIMIT 1`, [call.scope.tenantId, before.projects]);
          if (unresolved.length) throw new ThreadlineError('authority_unavailable', 'Graph reconciliation is required before release.');
          const after = await closure(call, seeds, tx, deadline, false,policyPurpose(ticket.surface)!=='control');
          if (digest(before) !== digest(after)) stale();
          for (const projectId of before.projects) {
            if (!ticket.graphRead && !before.resources.some((r) => ['memory','version','task'].includes(r.kind))) continue;
            const root = await projectRoot(call, projectId, tx);
            const expected = ticket.roots.get(projectId);
            // Foreign project roots are covered by closure fingerprints under
            // their barriers; origin graph must also match the pre-read root.
            if (expected !== undefined && root !== expected) stale();
          }
          within(deadline);
          await lockReleaseAuthority(tx, identityOf(call));
          await insertPermit(tx,ticket,payload,before.projects,before.resources.length,selection.policyRevision!==undefined && call.scope.projectId ? {...after.policies,[call.scope.projectId]:selection.policyRevision} : after.policies);
      });
    },
  };
}

export function identityOf(call: AuthenticatedCall): ReleaseIdentity {
  return { tenantId: call.scope.tenantId, projectId: call.scope.projectId, tokenId: call.tokenId, principalId: call.scope.principalId };
}
function compareAuthority(call: AuthenticatedCall, current: ReleaseAuthority): void {
  if (current.tokenKind !== call.scope.tokenKind || current.principalKind !== call.scope.principalKind
    || current.role !== call.scope.role || current.nativeSessionId !== call.scope.nativeSessionId
    || digest(current.scopes ?? []) !== digest(call.scopes ?? [])
    || current.enrollmentId !== call.enrollmentId || current.bindingGeneration !== call.bindingGeneration) deny();
  if (current.graphKey !== call.scope.graphKey || current.graphEpoch !== call.scope.graphEpoch
    || current.privacyRevision !== call.scope.privacyRevision) stale();
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function key(resource: ReleaseResource): string { return `${resource.projectId}:${resource.kind}:${resource.id}`; }
function deny(): never { throw new ThreadlineError('scope_denied', 'This release is not authorized.'); }
function stale(): never { throw new ThreadlineError('stale_revision', 'Release authority changed; prepare the response again.'); }
function broad(): never { throw new ThreadlineError('overloaded', 'The release scope exceeds the bounded response limits.'); }
function within(deadline: number): void { if (Date.now() > deadline) broad(); }

function digest(value: unknown): string {
  return canonicalDigest(JSON.parse(JSON.stringify(value)) as Parameters<typeof canonicalDigest>[0]);
}

async function insertPermit(tx: TxClient,ticket: ReleaseTicket,payload: string,projects: readonly string[],count:number,policyRevisions?:Record<string,string>): Promise<void> {
  // Bounded metadata ledger per credential; old request IDs are never accepted
  // as authorization, so expired entries need not remain indefinitely.
  await tx.rows(`DELETE FROM threadline_memory.release_permits WHERE tenant_id=$1 AND id IN
    (SELECT id FROM threadline_memory.release_permits WHERE tenant_id=$1 AND token_id=$2
     ORDER BY committed_at DESC,id DESC OFFSET 255 LIMIT 32)`,[ticket.call.scope.tenantId,ticket.call.tokenId]);
  await tx.rows(`INSERT INTO threadline_memory.release_permits
    (tenant_id,id,token_id,principal_id,project_ids,surface,response_bytes,dependency_count,policy_revisions)
    VALUES ($1,$2,$3,$4,$5::uuid[],$6,$7,$8,$9::jsonb)`,
    [ticket.call.scope.tenantId,ticket.requestId,ticket.call.tokenId,ticket.call.scope.principalId,projects,ticket.surface,Buffer.byteLength(payload),count,JSON.stringify(policyRevisions ?? (ticket.call.scope.projectId && ticket.policyRevision!==null ? {[ticket.call.scope.projectId]:ticket.policyRevision} : {}))]);
}

const policyControlSurfaces = new Set<string>(POLICY_CONTROL_SURFACES);
function remainingGraphTime(deadline:number):number {within(deadline);return Math.max(1,Math.min(2000,deadline-Date.now()));}
function policyPurpose(surface:string): 'control' | 'write' | 'recall' {
  if(policyControlSurfaces.has(surface))return 'control';
  if (/^POST \/v2\/(?:context|context-occurrences)/.test(surface)) return 'recall';
  if (/^POST \/v2\/(?:sources|memories|tasks)/.test(surface)) return 'write';
  if (/^GET \/v2\/(?:sources|history|memories|tasks|operations)/.test(surface)) return 'recall';
  return 'recall';
}
