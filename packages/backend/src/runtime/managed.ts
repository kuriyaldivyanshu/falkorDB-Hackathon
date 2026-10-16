import {renderPacket} from '../context/service.js';
import { createRuntimeContext } from '../context/runtime.js';
import { createTacticalTools } from '../tactical/tools.js';
import { createProviderCapture } from '../capture/provider-capture.js';
import type { EvidenceReferences } from '@threadline/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThreadlineError, type RunStartOutcome, type StartRunInput } from '@threadline/shared';
import type { ApplicationServices } from '../domain/services.js';
import type { AuthenticatedPrincipal } from '../storage/identity.js';
import { withTaskCheckpointLock, type SqlDatabase } from '../storage/pg.js';
import { createAnthropicDriver } from '../provider/anthropic.js';
import { createChatCompletionsDriver } from '../provider/chat-completions.js';
import type { ProviderId, ProviderApi } from '../provider/catalog.js';
import { createResponsesDriver, type ResponsesDriver } from '../provider/responses.js';
import { prepareCandidateWorkspace } from '../workspace/candidate.js';
import { createWorkspaceReader } from '../workspace/read-only.js';
import { MODEL_TOOL_FUNCTIONS } from '../capture/tools.js';
import { createSourceRetrieval, SourceRetrievalError } from '../capture/sources.js';
import { MODEL_FACING_SOURCE_RANGE_MAX_BYTES } from '@threadline/shared';
import { createRuntimeLoop } from './loop.js';
import type { RuntimeActivity, RunContext, ClaimState } from './contracts.js';

/** One owned, explicitly started execution. Construction and preparation never infer. */
export function createManagedRuntime(deps: {
  services: ApplicationServices;
  db: SqlDatabase;
  dataDirectory: string;
  apiKey: string;
  model: string;
  providerId: ProviderId;
  providerApi: ProviderApi;
  baseUrl: string;
  credentialRevision?: string;
  /** Injection is available only to code constructing a backend, never HTTP/env. */
  driver?: ResponsesDriver;
  activity: (projectId: string, tenantId: string, sessionId: string, runId: string, activity: RuntimeActivity) => void;
}) {
  let provider = { apiKey: deps.apiKey, model: deps.model, providerId: deps.providerId, providerApi: deps.providerApi, baseUrl: deps.baseUrl, credentialRevision: deps.credentialRevision ?? 'environment' };
  let active: { requestId: string; projectId: string; runId: string; abort: AbortController; done: Promise<void> } | null = null;
  let admitting = false;
  let closed = false;
  const execution = () => {
    const value = deps.services.execution();
    if (!value) throw new ThreadlineError('storage_unavailable', 'Execution storage is unavailable.');
    return value;
  };
  const configured = () => {
    if (!provider.apiKey) throw new ThreadlineError('unauthorized', 'Explicit provider credentials and model configuration are required.');
  };
  const workspace = async (principal: AuthenticatedPrincipal, projectId: string, workspaceId: string) => {
    await deps.services.authority(principal, projectId);
    const rows = await deps.db.withTenantTransaction(principal.tenantId, tx => tx.rows<{
      canonical_path: string; repository_fingerprint: string; host_id: string;
    }>(`SELECT w.canonical_path, w.repository_fingerprint, w.host_id
        FROM threadline.workspace_registrations w
        JOIN threadline.worker_hosts h ON h.tenant_id = w.tenant_id AND h.id = w.host_id
        WHERE w.tenant_id = $1 AND w.project_id = $2 AND w.id = $3
          AND w.status = 'registered' AND h.user_id = $4 AND h.revoked_at IS NULL`,
      [principal.tenantId, projectId, workspaceId, principal.userId]));
    const row = rows[0];
    if (!row || await realpath(row.canonical_path) !== row.canonical_path)
      throw new ThreadlineError('unauthorized', 'A real registered candidate owned by this user is required.');
    return row;
  };
  const assertConfigurable = () => {
    if (closed || admitting || active) throw new ThreadlineError('authority_conflict', 'Wait for the active run to finish or cancel it before changing providers.');
  };
  deps.services.provisioning().bindRuntime({assertConfigurable,configuration:()=>({providerId:provider.providerId,providerApi:provider.providerApi,baseUrl:provider.baseUrl,model:provider.model,credentialRevision:provider.credentialRevision,configured:!!provider.apiKey,fixture:!!deps.driver})});
  return {
    assertConfigurable,
    configuration() { return { ...provider }; },
    configure(next: typeof provider, persist: () => void) {
      assertConfigurable(); persist(); provider = { ...next };
    },
    /** Explicit local setup returns the real IDs required by run:start. No model request. */
    async prepare(principal: AuthenticatedPrincipal, projectId: string, contextWindowTokens: number, selectedProfileId?: string): Promise<StartRunInput> {
      configured();
      assertConfigurable();
      if (closed) throw new ThreadlineError('service_unavailable', 'The runtime is closing.');
      if (!selectedProfileId) throw new ThreadlineError('invalid_request','Select an immutable profile with /model and supply profileId before preparation.');
      const selected = await deps.db.withTenantTransaction(principal.tenantId,tx=>tx.rows<{
        id:string;model_id:string;settings:Record<string,unknown>;
      }>(`SELECT p.id,p.model_id,p.settings FROM threadline.provider_profiles p JOIN threadline.provider_accounts a
        ON a.tenant_id=p.tenant_id AND a.id=p.provider_account_id
        WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3 AND p.owner_user_id=$4 AND a.user_id=$4`,
        [principal.tenantId,projectId,selectedProfileId,principal.userId]));
      const profile=selected[0]; if(!profile)throw new ThreadlineError('not_found','No owned selected profile exists.');
      if(profile.settings['credentialRevision']!==provider.credentialRevision||profile.settings['providerId']!==provider.providerId||profile.settings['api']!==provider.providerApi||profile.settings['baseUrl']!==provider.baseUrl||profile.settings['contextWindowTokens']!==contextWindowTokens)
        throw new ThreadlineError('authority_conflict','Selected profile is incompatible or stale; select the configured profile again.');
      const authority = await deps.services.authority(principal, projectId);
      const exec = execution();
      const contextService=deps.services.context();if(!contextService)throw new ThreadlineError('storage_unavailable','Context is unavailable.');
      const packet=await contextService.refresh({tenantId:principal.tenantId,projectId,userId:principal.userId,userSessionId:principal.sessionId,taskId:authority.taskId});
      if(!packet.manifest)throw new ThreadlineError('authority_conflict',packet.refusal?.message??'Current authority does not fit.');
      const preview=contextService.budget({instructionsText:'Inspect the authored candidate using read-only tools.',historyText:'',toolSchemasText:JSON.stringify(MODEL_TOOL_FUNCTIONS),packetText:renderPacket(packet.manifest),retrievalText:'',reservedOutputTokens:Number(profile.settings['maxOutputTokens']),safetyHeadroomTokens:1024,limitTokens:contextWindowTokens});
      if(!preview.permitted)throw new ThreadlineError('authority_conflict','Selected profile cannot fit current authority, tools and output reserve. Select a compatible capacity.');
      const key = randomUUID();
      await mkdir(deps.dataDirectory, { recursive: true, mode: 0o700 });
      const root = await realpath(deps.dataDirectory);
      const candidate = await prepareCandidateWorkspace({ runId: key, candidateRoot: join(root, 'candidates', key),
        seedRoot: fileURLToPath(new URL('../../../../../fixtures/inventory-export-v1/seed/', import.meta.url)) });
      const host = await exec.registry.registerHost({ tenantId: principal.tenantId, userId: principal.userId,
        name: 'local-owned-runtime', allowedRoots: [candidate.root], capabilities: ['workspace.read', 'workspace.search', 'workspace.inspect'] });
      const registered = await exec.registry.registerWorkspace({ tenantId: principal.tenantId, projectId, hostId: host.hostId,
        canonicalPath: candidate.root, repositoryFingerprint: candidate.marker.seedDigest, kind: 'builder' });
      return { projectId, requestId: key, taskId: authority.taskId, profileId: profile.id, workspaceId: registered.id,
        expectedRevision: authority.taskRevision, expectedRequirementRevision: authority.requirementRevision };
    },
    async start(principal: AuthenticatedPrincipal, input: StartRunInput): Promise<RunStartOutcome> {
      configured();
      if (closed || admitting) throw new ThreadlineError('authority_conflict', 'Another run admission is in progress or the runtime is closing.');
      admitting = true;
      try {
        if (active && (active.requestId !== input.requestId || active.projectId !== input.projectId))
          throw new ThreadlineError('authority_conflict', 'A local run is already executing.');
        const exec = execution();
        const registered = await workspace(principal, input.projectId, input.workspaceId);
        const profiles=await deps.db.withTenantTransaction(principal.tenantId,tx=>tx.rows<{model_id:string;settings:Record<string,unknown>}>(
          'SELECT model_id,settings FROM threadline.provider_profiles WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND owner_user_id=$4',
          [principal.tenantId,input.projectId,input.profileId,principal.userId]));
        const selected=profiles[0];if(!selected)throw new ThreadlineError('not_found','Selected profile is unavailable.');
        const latest=await deps.db.withTenantTransaction(principal.tenantId,tx=>tx.rows<{id:string}>(`SELECT id FROM threadline.provider_profiles WHERE tenant_id=$1 AND project_id=$2 AND owner_user_id=$3 AND selection_operation_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1`,[principal.tenantId,input.projectId,principal.userId]));
        const previous=await deps.db.withTenantTransaction(principal.tenantId,tx=>tx.rows<{id:string}>(`SELECT s.id FROM threadline.agent_sessions s JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id WHERE s.tenant_id=$1 AND s.project_id=$2 AND r.initiated_by=$3 AND s.authorization_manifest->>'requestId'=$4 LIMIT 1`,[principal.tenantId,input.projectId,principal.userId,input.requestId]));
        if(latest[0]?.id!==input.profileId&&!previous.length)throw new ThreadlineError('authority_conflict','A newer model selection invalidated this prepared start.');
        const selectedOutput=selected.settings['maxOutputTokens'];const selectedWindow=selected.settings['contextWindowTokens'];
        if(typeof selectedOutput!=='number'||typeof selectedWindow!=='number')throw new ThreadlineError('invalid_request','Profile capacity is missing.');
        const answer = await exec.start({ apiKey: provider.apiKey, fixtureProfileAllowed: deps.driver !== undefined,
          providerId: provider.providerId, api: provider.providerApi, baseUrl: provider.baseUrl, credentialRevision: provider.credentialRevision }, principal,
          { ...input, hostId: registered.host_id, workspacePath: registered.canonical_path,
            workspaceFingerprint: registered.repository_fingerprint.trim() }, randomUUID());
        // Replays resolve identity only: a response retry must never cause another dispatch.
        if (answer.kind !== 'admitted') return answer;
        if (active) throw new ThreadlineError('authority_conflict', 'A local run is already executing.');
        const run = answer.run;

        const context: RunContext = { tenantId: principal.tenantId, projectId: run.projectId, runId: run.runId,
          sessionId: run.sessionId, taskId: run.taskId, profileId: run.profileId, workspaceId: run.workspaceId,
          graphEpoch: run.graphEpoch, model: run.model, correlationId: run.correlationId };
        const claim: ClaimState = { fence: run.claim.fence, revision: run.claim.revision,
          requirementRevision: run.claim.requirementRevision, leaseExpiresMs: Date.parse(run.claim.leaseExpiresAt) };
        const guard = exec.turnGuard(context, claim);
        const abort = new AbortController();
        const emit = (activity: RuntimeActivity) => deps.activity(run.projectId, principal.tenantId, run.sessionId, run.runId, activity);
        const reader = createWorkspaceReader({ root: registered.canonical_path, authorize: async () => {
          if (abort.signal.aborted) throw new ThreadlineError('unauthorized', 'The run is cancelled.');
          await deps.services.authority(principal, run.projectId);
        } });
        // The real Source service backs the fourth tool. It is composed rather
        // than stubbed, so the model-facing range cap and the membership recheck
        // on every read are the ones that actually apply.
        const sourceService = deps.services.sources();
        const sourceRetrieval = sourceService === null
          ? undefined
          : createSourceRetrieval({
              source: sourceService,
              reader: {
                tenantId: principal.tenantId,
                projectId: run.projectId,
                userId: principal.userId,
                userSessionId: principal.sessionId,
                agentSessionId: run.sessionId,
              },
              // The model-facing envelope, not the 32 KiB inspection range.
              maxBytes: MODEL_FACING_SOURCE_RANGE_MAX_BYTES,
            });
        const done = (async () => {
          let status: 'completed' | 'paused' = 'paused';
          try {
            await deps.services.authority(principal, run.projectId);
            const evidence = new Map<string, EvidenceReferences>();
            const capture = createProviderCapture({ capture: deps.services.captureStore(),
              correlation: { tenantId: principal.tenantId, projectId: run.projectId, runId: run.runId,
                agentSessionId: run.sessionId, taskId: run.taskId, graphEpoch: run.graphEpoch,
                acceptedRevision: claim.revision, requirementRevision: claim.requirementRevision },
              resolveReferences: async prepared => {
                const refs = evidence.get(prepared.attemptId);
                if (!refs) throw new Error('The durable model identity is unavailable.');
                return refs;
              } });
            const checkpoints=deps.services.checkpoints();
            if (!checkpoints) throw new ThreadlineError('storage_unavailable','Checkpoint service is unavailable.');
            await checkpoints.evaluateTrigger({tenantId:principal.tenantId,projectId:run.projectId,
              userId:principal.userId,taskId:run.taskId,runId:run.runId,agentSessionId:run.sessionId},'task_admission');
            const tactical=createTacticalTools({service:checkpoints,scope:{tenantId:principal.tenantId,
              projectId:run.projectId,userId:principal.userId,taskId:run.taskId,
              runId:run.runId,agentSessionId:run.sessionId}});
            const guarded={...guard,beginTurn:async(...args:Parameters<typeof guard.beginTurn>)=>{
              await deps.services.flushCapture();
              const state=await checkpoints.inspect({tenantId:principal.tenantId,projectId:run.projectId,
                userId:principal.userId,taskId:run.taskId,runId:run.runId,agentSessionId:run.sessionId});
              if(state.freshness==='blocked'||state.criticalCapturePending)throw new ThreadlineError('authority_conflict','Checkpoint recovery is blocked by a capture gap or overflow.');
              return guard.beginTurn(...args);
            }};
            const contextService=deps.services.context();
            if(!contextService)throw new ThreadlineError('storage_unavailable','Context service unavailable.');
            const scope={tenantId:principal.tenantId,projectId:run.projectId,userId:principal.userId,userSessionId:principal.sessionId,
              taskId:run.taskId,runId:run.runId,agentSessionId:run.sessionId};
            const runtimeContext=createRuntimeContext({service:contextService,scope,db:deps.db,limitTokens:selectedWindow,maxOutputTokens:selectedOutput,maxInputTokens:exec.limits.maxInputTokens,toolsText:JSON.stringify(MODEL_TOOL_FUNCTIONS)});
            const loop = createRuntimeLoop({ capture,/* Hold only the admission barrier, never the network turn. Guarded ports
              retain their independently committed SQL transactions. */ admissionBarrier:work=>withTaskCheckpointLock(deps.db,principal.tenantId,run.projectId,run.taskId,async()=>work()), tactical:{...tactical,invoke:async(name,input,operationId)=>{
              if(name==='memory.refresh'){
                if(!input||typeof input!=='object'||Object.keys(input).length)throw new ThreadlineError('invalid_request','Refresh accepts no fields.');
                const result=await contextService.refresh(scope);return {kind:result.kind,packetId:result.packetId,refusal:result.refusal,delivery:'staged; replaced before next dependent turn'};
              }return tactical.invoke(name,input,operationId);
            }}, context:runtimeContext,
              onJournalled: (prepared, ids) => { evidence.set(prepared.attemptId, ids); },
              onSettled: (prepared, responseArtifactId) => {
                evidence.set(prepared.attemptId, { ...evidence.get(prepared.attemptId), responseArtifactId });
              },
              driver: deps.driver ?? (provider.providerApi === 'responses'
              ? createResponsesDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, sessionId: run.sessionId })
              : provider.providerApi === 'anthropic-messages' ? createAnthropicDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl })
              : createChatCompletionsDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, sessionId: run.sessionId })),
              tools: reader, guard:guarded, sink: emit, tools4Provider: MODEL_TOOL_FUNCTIONS,
              sources:{invoke:async(input:unknown)=>{
                if(!input||typeof input!=='object'||Array.isArray(input))throw new SourceRetrievalError('invalid_input','invalid_input','Retrieve needs an object.');
                const value=input as Record<string,unknown>;
                if(Object.keys(value).some(k=>!['mode','sourceId','offset','maxBytes','query','limit'].includes(k)))throw new SourceRetrievalError('invalid_input','invalid_input','Unknown retrieval field.');
                if(value['mode']==='search'){
                  if(typeof value['query']!=='string'||value['sourceId']!=null||value['offset']!=null||value['maxBytes']!=null||(value['limit']!=null&&typeof value['limit']!=='number'))throw new SourceRetrievalError('invalid_input','invalid_input','Invalid search fields.');
                  return contextService.search(scope,{query:value['query'],limit:typeof value['limit']==='number'?value['limit']:undefined});
                }
                if(!sourceRetrieval)throw new Error('Source service unavailable.');
                if(value['query']!=null||value['limit']!=null)throw new SourceRetrievalError('invalid_input','invalid_input','Invalid Source mode fields.');
                return sourceRetrieval.invoke({mode:value['mode'],sourceId:value['sourceId'],offset:value['offset'],maxBytes:value['maxBytes']});
              }} });
            const instructions=await deps.db.withTenantTransaction(principal.tenantId,async tx=>tx.rows<{id:string;body:string}>(`UPDATE threadline.project_messages SET run_id=$1
              WHERE tenant_id=$2 AND project_id=$3 AND task_graph_id=$4 AND author_user_id=$5 AND visibility='project' AND run_id IS NULL AND input_kind IS NOT NULL
              RETURNING id,body`,[run.runId,principal.tenantId,run.projectId,run.taskId,principal.userId]));
            const result = await loop.run({ context, claim, budget: { ...run.budget,
              deadlineMs: Math.max(0, Date.parse(run.budget.deadlineAt) - Date.now()) },
              policy: {...exec.limits,maxOutputTokens:selectedOutput}, apiKey: provider.apiKey }, [{ role: 'user', content: JSON.stringify({

                instruction: 'Inspect the authored candidate using read-only tools. Use memory_refresh to inspect current checkpoint state before versioned plan or progress updates. task_update_plan and memory_checkpoint record proposals; a completed plan does not verify or complete the task. Keep the final report under 300 words, prioritizing concrete defects and source locations. No edits or completion acceptance are available.' }) },...instructions.map(i=>({role:'user' as const,content:JSON.stringify({type:'human_instruction',sourceMessageId:i.id,text:i.body,requirementChange:false})}))], abort.signal);
            status = result.stop === 'final_output' ? 'completed' : 'paused';
            emit({ kind: 'run_state', runId: run.runId, state: result.stop, detail: result.reason });
          } catch {
            emit({ kind: 'run_state', runId: run.runId, state: 'blocked', detail: 'Execution stopped; inspect durable attempt records before retrying.' });
          } finally {
            try {
              if (await exec.journal.countUnresolved(principal.tenantId, run.projectId, run.sessionId) === 0) {
                await guard.releaseClaim('runtime_ended');
                await deps.db.withTenantTransaction(principal.tenantId, tx => tx.rows(
                  `UPDATE threadline.runs SET observed_status = $1, finished_at = now()
                    WHERE tenant_id = $2 AND id = $3 AND finished_at IS NULL`, [status, principal.tenantId, run.runId]));
              }
            } finally { active = null; }
          }
        })().catch(() => { emit({ kind: 'run_state', runId: run.runId, state: 'blocked', detail: 'Storage could not settle execution; automatic resume is disabled.' }); });
        active = { requestId: input.requestId, projectId: input.projectId, runId: run.runId, abort, done };
        return answer;
      } finally { admitting = false; }
    },
    async cancel(principal: AuthenticatedPrincipal, runId: string, reason: string) {
      const answer = await execution().cancel(principal, runId, reason);
      if (active?.runId === runId) active.abort.abort();
      return answer;
    },
    async close() { closed = true; const running = active; running?.abort.abort(); await running?.done; },
  };
}
export type ManagedRuntime = ReturnType<typeof createManagedRuntime>;
