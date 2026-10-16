import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ThreadlineError, type RunStartOutcome, type StartRunInput } from '@threadline/shared';
import type { ApplicationServices } from '../domain/services.js';
import type { AuthenticatedPrincipal } from '../storage/identity.js';
import type { SqlDatabase } from '../storage/pg.js';
import { createAnthropicDriver } from '../provider/anthropic.js';
import { createChatCompletionsDriver } from '../provider/chat-completions.js';
import type { ProviderId, ProviderApi } from '../provider/catalog.js';
import { createResponsesDriver, type ResponsesDriver } from '../provider/responses.js';
import { prepareCandidateWorkspace } from '../workspace/candidate.js';
import { createWorkspaceReader } from '../workspace/read-only.js';
import { READ_ONLY_FUNCTIONS } from '../workspace/tools.js';
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
    if (!provider.apiKey || !provider.model) throw new ThreadlineError('unauthorized', 'Explicit provider credentials and model configuration are required.');
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
  return {
    assertConfigurable,
    configuration() { return { ...provider }; },
    configure(next: typeof provider, persist: () => void) {
      assertConfigurable(); persist(); provider = { ...next };
    },
    /** Explicit local setup returns the real IDs required by run:start. No model request. */
    async prepare(principal: AuthenticatedPrincipal, projectId: string, contextWindowTokens: number): Promise<StartRunInput> {
      configured();
      if (closed) throw new ThreadlineError('service_unavailable', 'The runtime is closing.');
      if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 1501 || contextWindowTokens > 10_000_000)
        throw new ThreadlineError('invalid_request', 'Declare an effective context window between 1501 and 10000000 tokens.');
      const authority = await deps.services.authority(principal, projectId);
      const exec = execution();
      const key = randomUUID();
      await mkdir(deps.dataDirectory, { recursive: true, mode: 0o700 });
      const root = await realpath(deps.dataDirectory);
      const candidate = await prepareCandidateWorkspace({ runId: key, candidateRoot: join(root, 'candidates', key),
        seedRoot: fileURLToPath(new URL('../../../../../fixtures/inventory-export-v1/seed/', import.meta.url)) });
      const host = await exec.registry.registerHost({ tenantId: principal.tenantId, userId: principal.userId,
        name: 'local-owned-runtime', allowedRoots: [candidate.root], capabilities: ['workspace.read', 'workspace.search', 'workspace.inspect'] });
      const account = await exec.registry.registerProviderAccount({ tenantId: principal.tenantId, userId: principal.userId,
        provider: provider.providerId, runtime: `owned-${provider.providerApi}`, authRoute: deps.driver ? 'local' : 'api_key', label: `Local ${provider.providerId}`,
        secretRef: null, probeStatus: deps.driver ? 'fixture' : 'configured' });
      const profile = await exec.registry.registerProviderProfile({ tenantId: principal.tenantId, projectId,
        ownerUserId: principal.userId, providerAccountId: account.id, name: 'Local read-only Builder', modelId: provider.model,
        adapterVersion: `threadline-${provider.providerApi}-v1`, settings: { contextWindowTokens, maxOutputTokens: exec.limits.maxOutputTokens,
          providerId: provider.providerId, api: provider.providerApi, baseUrl: provider.baseUrl, credentialRevision: provider.credentialRevision } });
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
        const answer = await exec.start({ apiKey: provider.apiKey, fixtureProfileAllowed: deps.driver !== undefined,
          providerId: provider.providerId, api: provider.providerApi, baseUrl: provider.baseUrl, credentialRevision: provider.credentialRevision }, principal,
          { ...input, hostId: registered.host_id, workspacePath: registered.canonical_path,
            workspaceFingerprint: registered.repository_fingerprint.trim() }, randomUUID());
        // Replays resolve identity only: a response retry must never cause another dispatch.
        if (answer.kind !== 'admitted') return answer;
        if (active) throw new ThreadlineError('authority_conflict', 'A local run is already executing.');
        const run = answer.run;
        if (run.model !== provider.model) throw new ThreadlineError('unauthorized', 'The admitted profile model differs from the configured model.');
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
        const done = (async () => {
          let status: 'completed' | 'paused' = 'paused';
          try {
            const authority = await deps.services.authority(principal, run.projectId);
            const loop = createRuntimeLoop({ driver: deps.driver ?? (provider.providerApi === 'responses'
              ? createResponsesDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, sessionId: run.sessionId })
              : provider.providerApi === 'anthropic-messages' ? createAnthropicDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl })
              : createChatCompletionsDriver({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, sessionId: run.sessionId })),
              tools: reader, guard, sink: emit, tools4Provider: READ_ONLY_FUNCTIONS });
            const result = await loop.run({ context, claim, budget: { ...run.budget,
              deadlineMs: Math.max(0, Date.parse(run.budget.deadlineAt) - Date.now()) },
              policy: exec.limits, apiKey: provider.apiKey }, [{ role: 'user', content: JSON.stringify({
                goal: authority.goalText, constraints: authority.constraints,
                instruction: 'Inspect the authored candidate using read-only tools. Keep the final report under 300 words, prioritizing concrete defects and source locations. No edits or completion acceptance are available.' }) }], abort.signal);
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
