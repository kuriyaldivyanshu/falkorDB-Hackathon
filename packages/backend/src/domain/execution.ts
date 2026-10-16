import { createHash, randomUUID } from 'node:crypto';

import {
  ThreadlineError,
  type CancelRunOutcome,
  type RunBudgetView,
  type RunInspectView,
  type RunLaunchView,
  type RunStartOutcome,
  type StartRunInput,
} from '@threadline/shared';

import type {
  BudgetSnapshot,
  ClaimState,
  ProviderLifecycle,
  ReleaseAuthorityFacts,
  RunContext,
  RunPolicy,
  TerminalRecord,
  TerminalSettlement,
  ToolAuthorization,
  ToolIntent,
  ToolResultRecord,
  TurnGuard,
} from '../runtime/contracts.js';
import type { ActivitySink } from '../runtime/contracts.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { fromAnthropicMessages } from '../provider/anthropic.js';
import { fromChatMessages } from '../provider/chat-completions.js';
import { MAX_PROVIDER_OUTPUT_TOKENS } from '../provider/lifecycle.js';
import { estimateRequestTokens } from '../storage/budget.js';
import type { ArtifactWriter } from '../storage/artifacts.js';
import type { CaptureStore } from '../storage/capture.js';
import { canonicalDigest, sha256Hex, type CanonicalValue } from '../storage/digest.js';
import type { ExecutionRegistry, ProviderProfileView } from '../storage/execution.js';
import {
  CLAIM_TASK_CYPHER,
  READ_CLAIM_LEASE_CYPHER,
  READ_RELEASE_AUTHORITY_CYPHER,
  READ_REQUIRED_SOURCES_CYPHER,
  RENEW_CLAIM_CYPHER,
  RELEASE_CLAIM_CYPHER,
  RELEASE_CHECKPOINTED_CLAIM_CYPHER,
} from '../storage/graph-queries.js';
import type { GraphStore } from '../storage/graph.js';
import type { ModelRequestJournal } from '../storage/model-requests.js';
import { withTaskCheckpointLock, withProjectAdmissionLock, type SqlDatabase } from '../storage/pg.js';
import { requireProjectMembership } from '../storage/identity.js';
import type { AuthenticatedPrincipal, ProjectScope } from './services.js';

/**
 * Execution authority: one Run, one live logical Builder, a guarded graph claim
 * with a real fence and lease, and a real budget.
 *
 * Ownership rule: the run initiator, the provider-profile owner and the
 * provider-account owner must be the same authenticated human. A caller-supplied
 * UUID is a requested target; only these SQL rows authorise a release.
 */

export interface ExecutionPolicyLimits {
  readonly maxAttempts: number;
  readonly maxToolCalls: number;
  readonly maxTotalTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly deadlineMs: number;
  readonly claimLeaseMs: number;
  readonly claimHeartbeatMs: number;
}

export const DEVELOPMENT_LIMITS: ExecutionPolicyLimits = Object.freeze({
  maxAttempts: 25,
  maxToolCalls: 80,
  maxTotalTokens: 120_000,
  maxInputTokens: 12_000,
  maxOutputTokens: MAX_PROVIDER_OUTPUT_TOKENS,
  deadlineMs: 30 * 60 * 1000,
  claimLeaseMs: 30_000,
  claimHeartbeatMs: 10_000,
});

export interface ExecutionDeps {
  readonly db: SqlDatabase;
  readonly graphs: GraphStore;
  readonly registry: ExecutionRegistry;
  readonly journal: ModelRequestJournal;
  readonly artifacts: ArtifactWriter;
  /**
   * The single capture boundary.
   *
   * M02 wrote capture rows inline, which left positions allocated unsafely and
   * the payload digest holding the artifact digest. Tool capture now goes
   * through this service so one boundary has one record and produces the M03
   * outbox entry in the same transaction.
   */
  readonly capture: CaptureStore;
  readonly limits?: ExecutionPolicyLimits;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly activity?: ActivitySink;
}

/**
 * Only the credential reaches `start`. Everything else the execution service
 * needs was supplied once at construction, so a caller cannot substitute its
 * own database handle, graph client or registry.
 */
export interface StartRunDeps {
  /** Present only in production configuration. Absent means fail closed. */
  readonly apiKey: string | null;
  /** True only when the caller explicitly injected a test provider. */
  readonly fixtureProfileAllowed?: boolean;
  readonly providerId?: string;
  readonly credentialRevision?: string;
  readonly api?: string;
  readonly baseUrl?: string;
}

export interface StartRunRequest extends StartRunInput {
  readonly hostId: string;
  readonly workspacePath: string;
  readonly workspaceFingerprint: string;
}

export function createExecutionService(deps: ExecutionDeps) {
  const logger = deps.logger ?? silentLogger;
  const limits = deps.limits ?? DEVELOPMENT_LIMITS;
  const clock = deps.clock;

  const policy = (): RunPolicy => ({
    maxAttempts: limits.maxAttempts,
    maxToolCalls: limits.maxToolCalls,
    maxTotalTokens: limits.maxTotalTokens,
    maxInputTokens: limits.maxInputTokens,
    maxOutputTokens: limits.maxOutputTokens,
    deadlineMs: limits.deadlineMs,
    claimLeaseMs: limits.claimLeaseMs,
    claimHeartbeatMs: limits.claimHeartbeatMs,
  });

  const projectScope = (
    principal: AuthenticatedPrincipal,
    projectId: string,
  ): Promise<ProjectScope> =>
    requireProjectMembership(deps.db, principal.tenantId, projectId, principal.userId);

  const loadProfile = async (
    tenantId: string,
    projectId: string,
    profileId: string,
  ): Promise<{ profile: ProviderProfileView; accountOwnerId: string; accountProbeStatus: string; accountAuthRoute: string; accountProvider: string }> => {
    const rows = await deps.db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{
        id: string;
        owner_user_id: string;
        provider_account_id: string;
        name: string;
        model_id: string;
        config_digest: string;
        adapter_version: string;
        settings: Record<string, unknown>;
        account_user_id: string;
        probe_status: string;
        auth_route: string;
        provider: string;
      }>(
        `SELECT p.id, p.owner_user_id, p.provider_account_id, p.name, p.model_id,
                p.config_digest, p.adapter_version, p.settings,
                a.user_id AS account_user_id, a.probe_status, a.auth_route, a.provider
           FROM threadline.provider_profiles p
           JOIN threadline.provider_accounts a
             ON a.tenant_id = p.tenant_id AND a.id = p.provider_account_id
          WHERE p.tenant_id = $1 AND p.project_id = $2 AND p.id = $3`,
        [tenantId, projectId, profileId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ThreadlineError('not_found', 'No provider profile exists for that id.', {
        profileId,
      });
    }
    if (canonicalDigest({ modelId: row.model_id, adapterVersion: row.adapter_version, settings: row.settings as CanonicalValue }) !== row.config_digest.trim())
      throw new ThreadlineError('authority_conflict', 'The provider profile configuration no longer matches its digest.');
    return {
      profile: {
        id: row.id,
        ownerUserId: row.owner_user_id,
        providerAccountId: row.provider_account_id,
        name: row.name,
        modelId: row.model_id,
        configDigest: row.config_digest.trim(),
        settings: row.settings,
      },
      accountOwnerId: row.account_user_id,
      accountProbeStatus: row.probe_status,
      accountAuthRoute: row.auth_route,
      accountProvider: row.provider,
    };
  };

  /**
   * M02A02. All three owners must be the initiating human, and the account must
   * not be a labelled fixture when the caller asked for production behaviour.
   */
  const assertOwnership = (
    principal: AuthenticatedPrincipal,
    loaded: {
      profile: ProviderProfileView;
      accountOwnerId: string;
      accountProbeStatus: string;
      accountAuthRoute: string;
    },
    allowFixture: boolean,
  ): void => {
    if (loaded.profile.ownerUserId !== principal.userId) {
      throw new ThreadlineError('unauthorized', 'The provider profile belongs to another human.', {
        reason: 'profile_owner_mismatch',
      });
    }
    if (loaded.accountOwnerId !== principal.userId) {
      throw new ThreadlineError('unauthorized', 'The provider account belongs to another human.', {
        reason: 'account_owner_mismatch',
      });
    }
    if (!allowFixture && loaded.accountProbeStatus === 'fixture') {
      throw new ThreadlineError(
        'unauthorized',
        'The selected provider account is a test fixture and is not a production route.',
        { reason: 'fixture_account_refused' },
      );
    }
  };

  const snapshot = async (scope: JournalLike): Promise<BudgetSnapshot> => {
    const [attemptsUsed, toolCallsUsed, reserved, observed] = await Promise.all([
      deps.journal.countAttempts(scope.tenantId, scope.projectId, scope.sessionId),
      countToolCalls(deps.db, scope),
      deps.journal.reservedTokens(scope.tenantId, scope.projectId, scope.sessionId),
      deps.journal.observedTokens(scope.tenantId, scope.projectId, scope.sessionId),
    ]);
    return {
      maxAttempts: limits.maxAttempts,
      attemptsUsed,
      maxToolCalls: limits.maxToolCalls,
      toolCallsUsed,
      maxTotalTokens: limits.maxTotalTokens,
      reservedTokens: reserved,
      observedTokens: observed,
      deadlineMs: limits.deadlineMs,
    };
  };

  const budgetView = async (scope: JournalLike): Promise<RunBudgetView> => ({
    ...(await snapshot(scope)),
    deadlineAt: new Date(clock().getTime() + limits.deadlineMs).toISOString(),
    blockedOnReconciliation:
      (await deps.journal.countUnresolved(scope.tenantId, scope.projectId, scope.sessionId)) > 0,
  });

  const runView = async (
    _principal: AuthenticatedPrincipal,
    scope: ProjectScope,
    sessionId: string,
    runId: string,
    taskId: string,
    profileId: string,
    workspaceId: string,
    claim: ClaimState,
    correlationId: string,
  ): Promise<RunLaunchView> => {
    const loaded = await loadProfile(scope.tenantId, scope.projectId, profileId);
    const policyDigest = await runPolicyDigest(deps.db, scope.tenantId, runId);
    return {
      runId,
      sessionId,
      projectId: scope.projectId,
      taskId,
      profileId,
      workspaceId,
      model: loaded.profile.modelId,
      graphEpoch: scope.graphEpoch,
      state: 'active',
      sessionState: 'live',
      claim: {
        taskId,
        taskClaimState: 'claimed',
        ownerSessionId: sessionId,
        fence: claim.fence,
        revision: claim.revision,
        requirementRevision: claim.requirementRevision,
        leaseExpiresAt: new Date(claim.leaseExpiresMs).toISOString(),
      },
      budget: await budgetView({ tenantId: scope.tenantId, projectId: scope.projectId, sessionId }),
      policyDigest,
      profileConfigDigest: loaded.profile.configDigest.trim(),
      correlationId,
    };
  };

  const service = {
    limits,
    policy,

    /**
     * M02A01. Writes SQL identities first, then commits the guarded graph
     * claim. A failure after SQL leaves the run inspectable and reconcilable
     * rather than accepted through an in-memory shortcut.
     */
    async start(
      startDeps: StartRunDeps,
      principal: AuthenticatedPrincipal,
      request: StartRunRequest,
      correlationId: string,
    ): Promise<RunStartOutcome> {
      const scope = await projectScope(principal, request.projectId);
      const loaded = await loadProfile(scope.tenantId, scope.projectId, request.profileId);
      assertOwnership(principal, loaded, startDeps.fixtureProfileAllowed === true);

      if (startDeps.apiKey === null || startDeps.apiKey.length === 0) {
        throw new ThreadlineError(
          'unauthorized',
          'No provider credential is configured; a run is not started without one.',
          { reason: 'no_configured_credential' },
        );
      }

      if (startDeps.providerId && (loaded.accountProvider !== startDeps.providerId ||
        loaded.profile.settings['providerId'] !== startDeps.providerId || loaded.profile.settings['api'] !== startDeps.api ||
        loaded.profile.settings['baseUrl'] !== startDeps.baseUrl ||
        (startDeps.credentialRevision !== undefined && loaded.profile.settings['credentialRevision'] !== startDeps.credentialRevision)))
        throw new ThreadlineError('unauthorized', 'The profile does not match the configured provider, protocol and endpoint. Prepare a new profile.');
      const now = clock();
      const authorizationManifest = {
        humanSessionId: principal.sessionId,
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        workspacePath: request.workspacePath,
        workspaceFingerprint: request.workspaceFingerprint,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        taskId: request.taskId,
        profileId: request.profileId,
        profileDigest: loaded.profile.configDigest,
        expectedRevision: request.expectedRevision,
        expectedRequirementRevision: request.expectedRequirementRevision,
        graphEpoch: scope.graphEpoch,
      };
      const authorizationDigest = canonicalDigest(authorizationManifest);

      const existing = await findExistingRun(deps.db, scope.tenantId, scope.projectId, request.requestId);
      if (existing !== null) {
        if (existing.authorizationDigest.trim() !== authorizationDigest)
          throw new ThreadlineError('idempotency_mismatch', 'This run request ID already binds different input.');
        const receipts = await deps.graphs.graph(scope.graphKey).roQuery<{ request_digest: string; result_json: string }>(
          `MATCH (r:RequestReceipt {graph_epoch:$graph_epoch,request_id:$request_id})
           WHERE r.operation='task.claim' RETURN r.request_digest AS request_digest,r.result_json AS result_json`,
          { params: { graph_epoch: scope.graphEpoch, request_id: request.requestId } });
        const receipt = receipts.data?.[0];
        if (!receipt) {
          if (existing.claimRefused) throw new ThreadlineError('authority_conflict', 'This run request was definitively refused. Prepare a new request against current authority.',
            { reason: 'claim_refused', runId: existing.runId, sessionId: existing.sessionId, correlationId });
          return { kind: 'accepted', runId: existing.runId, sessionId: existing.sessionId,
            pendingReason: 'The graph claim has no resolved receipt; automatic dispatch is disabled.' };
        }
        const result = JSON.parse(receipt.result_json) as { sessionId?: unknown; taskId?: unknown };
        if (receipt.request_digest !== authorizationDigest || result.sessionId !== existing.sessionId || result.taskId !== request.taskId)
          throw new ThreadlineError('authority_conflict', 'The graph claim receipt does not match the stored admission.');
        await markRunActive(deps.db, scope.tenantId, scope.projectId, existing.runId);
        return { kind: 'replayed', run: (await service.inspect(principal, existing.runId)).run };
      }

      await assertOneLiveRun(deps.db, scope.tenantId, scope.projectId);

      const workspace = await registerCandidateWorkspace(deps, principal, scope, request);
      const { runId } = await deps.registry.createRun({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        initiatedBy: principal.userId,
        profileId: request.profileId,
        policy: policy(),
      });
      const { sessionId } = await deps.registry.createAgentSession({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        runId,
        taskGraphId: request.taskId,
        profileId: request.profileId,
        workspaceId: workspace.id,
        authorizationDigest,
        authorizationManifest,
      });

      const graph = deps.graphs.graph(scope.graphKey);
      const claimed = await graph.query<{ revision: number; fence: number; event_seq: number }>(
        CLAIM_TASK_CYPHER,
        {
          params: claimParams({
            projectId: scope.projectId,
            graphEpoch: scope.graphEpoch,
            taskId: request.taskId,
            sessionId,
            runId,
            stateId: randomUUID(),
            requestId: request.requestId,
            requestDigest: authorizationDigest,
            expectedRevision: request.expectedRevision,
            expectedRequirementRevision: request.expectedRequirementRevision,
            requirementRevision: request.expectedRequirementRevision,
            fence: 0,
            leaseExpiresMs: now.getTime() + limits.claimLeaseMs,
            authorizationDigest,
            authorizationJson: JSON.stringify(authorizationManifest),
            policyDigest: canonicalDigest(policy() as unknown as CanonicalValue),
            maxTotalTokens: limits.maxTotalTokens,
            deadlineMs: now.getTime() + limits.deadlineMs,
            actorId: randomUUID(),
            nowMs: now.getTime(),
          }),
        },
      );
      const row = claimed.data?.[0];
      if (row === undefined) {
        // The guard refused: stale epoch/revision, already claimed, or a receipt
        // exists. This returned statement made no claim for these SQL identities.
        // A thrown graph error remains ambiguous and never enters this cleanup.
        await deps.db.withTenantTransaction(scope.tenantId, async tx => {
          await tx.rows(`UPDATE threadline.agent_sessions SET runtime_status='stopped',ended_at=$1
            WHERE tenant_id=$2 AND project_id=$3 AND id=$4 AND ended_at IS NULL`, [clock(),scope.tenantId,scope.projectId,sessionId]);
          await tx.rows(`UPDATE threadline.runs SET observed_status='cancelled',finished_at=$1
            WHERE tenant_id=$2 AND project_id=$3 AND id=$4 AND finished_at IS NULL`, [clock(),scope.tenantId,scope.projectId,runId]);
        });
        deps.activity?.({
          kind: 'run_state',
          runId,
          state: 'rejected',
          detail: 'The guarded task claim matched no row.',
        });
        throw new ThreadlineError(
          'authority_conflict',
          'The task claim was refused: epoch, revision, owner or lease does not match.',
          { correlationId, runId, sessionId, reason: 'claim_refused' },
        );
      }

      await markRunActive(deps.db, scope.tenantId, scope.projectId, runId);
      const claim: ClaimState = {
        fence: row.fence,
        revision: row.revision,
        requirementRevision: request.expectedRequirementRevision,
        leaseExpiresMs: now.getTime() + limits.claimLeaseMs,
      };
      const view = await runView(
        principal,
        scope,
        sessionId,
        runId,
        request.taskId,
        request.profileId,
        workspace.id,
        claim,
        correlationId,
      );
      deps.activity?.({
        kind: 'run_state',
        runId,
        state: 'active',
        detail: `Claim committed with fence ${String(claim.fence)}.`,
      });
      logger.log({
        level: 'info',
        message: 'Run admitted and task claimed.',
        fields: { correlationId, runId, sessionId, fence: claim.fence },
      });
      return { kind: 'admitted', run: view };
    },

    /** Renews the lease under the current fence. 409 when the claim moved. */
    async heartbeat(
      principal: AuthenticatedPrincipal,
      runId: string,
    ): Promise<{ leaseExpiresAt: string; fence: number }> {
      const located = await locateSession(deps.db, deps.graphs, principal.tenantId, runId);
      await requireRunControl(deps.db, principal, located);
      const updated = await service.turnGuard({ tenantId: principal.tenantId, projectId: located.projectId,
        runId, sessionId: located.sessionId, taskId: located.taskGraphId, profileId: located.profileId,
        workspaceId: located.workspaceId, graphEpoch: located.graphEpoch, model: located.modelId, correlationId: randomUUID() },
        { fence: located.fence, revision: located.revision, requirementRevision: located.requirementRevision,
          leaseExpiresMs: located.leaseExpiresMs }).heartbeat();
      return { leaseExpiresAt: new Date(updated.leaseExpiresMs).toISOString(), fence: updated.fence };
    },

    /** Acknowledges cancellation. Never claims provider compute stopped. */
    async cancel(
      principal: AuthenticatedPrincipal,
      runId: string,
      reason: string,
    ): Promise<CancelRunOutcome> {
      const located = await locateSession(deps.db, deps.graphs, principal.tenantId, runId);
      await requireRunControl(deps.db, principal, located);
      await deps.db.withTenantTransaction(principal.tenantId, async (tx) => {
        await tx.rows(
          `UPDATE threadline.agent_sessions SET runtime_status = 'stopping', ended_at = $1
            WHERE tenant_id = $2 AND project_id = $3 AND id = $4 AND ended_at IS NULL`,
          [clock(), principal.tenantId, located.projectId, located.sessionId],
        );
        await tx.rows(
          `UPDATE threadline.runs SET observed_status = 'cancelled', finished_at = $1
            WHERE tenant_id = $2 AND project_id = $3 AND id = $4 AND finished_at IS NULL`,
          [clock(), principal.tenantId, located.projectId, runId],
        );
      });

      const unresolved = await deps.journal.countUnresolved(
        principal.tenantId,
        located.projectId,
        located.sessionId,
      );
      deps.activity?.({
        kind: 'run_state',
        runId,
        state: 'cancelled',
        detail: `Cancellation acknowledged: ${reason}`,
      });
      return {
        acknowledged: true,
        runId,
        state: 'cancelled',
        sessionState: 'stopping',
        // Unresolved attempts keep their reservation; usage is genuinely unknown.
        usageUncertain: unresolved > 0,
        reason,
      };
    },

    /** Open runs for a project, newest first. Read-only. */
    async listActiveRuns(tenantId: string, projectId: string): Promise<readonly string[]> {
      const rows = await deps.db.withTenantTransaction(tenantId, (tx) =>
        tx.rows<{ id: string }>(
          `SELECT id FROM threadline.runs
            WHERE tenant_id = $1 AND project_id = $2 AND finished_at IS NULL
            ORDER BY created_at DESC`,
          [tenantId, projectId],
        ),
      );
      return rows.map((row) => row.id);
    },

    /** Read-only inspection for the CLI. */
    async inspect(principal: AuthenticatedPrincipal, runId: string): Promise<RunInspectView> {
      const located = await locateSession(deps.db, deps.graphs, principal.tenantId, runId);
      await requireProjectMembership(deps.db, principal.tenantId, located.projectId, principal.userId);
      const unresolvedAttempts = await deps.journal.countUnresolved(principal.tenantId, located.projectId, located.sessionId);
      const budgetView: RunBudgetView = {
        maxAttempts: limits.maxAttempts,
        attemptsUsed: await deps.journal.countAttempts(
          principal.tenantId,
          located.projectId,
          located.sessionId,
        ),
        maxToolCalls: limits.maxToolCalls,
        toolCallsUsed: await countToolCalls(deps.db, {
          tenantId: principal.tenantId,
          projectId: located.projectId,
          sessionId: located.sessionId,
        }),
        maxTotalTokens: limits.maxTotalTokens,
        reservedTokens: await deps.journal.reservedTokens(
          principal.tenantId,
          located.projectId,
          located.sessionId,
        ),
        observedTokens: await deps.journal.observedTokens(
          principal.tenantId,
          located.projectId,
          located.sessionId,
        ),
        deadlineAt: new Date(located.createdAt.getTime() + limits.deadlineMs).toISOString(),
        blockedOnReconciliation: unresolvedAttempts > 0,
      };
      return {
        run: {
          runId,
          sessionId: located.sessionId,
          projectId: located.projectId,
          taskId: located.taskGraphId,
          profileId: located.profileId,
          workspaceId: located.workspaceId,
          model: located.modelId,
          graphEpoch: located.graphEpoch,
          state: located.runStatus,
          sessionState: located.sessionStatus,
          claim: {
            taskId: located.taskGraphId,
            taskClaimState: located.sessionStatus === 'live' ? 'claimed' : 'released',
            ownerSessionId: located.sessionStatus === 'live' ? located.sessionId : null,
            fence: located.fence,
            revision: located.revision,
            requirementRevision: located.requirementRevision,
            leaseExpiresAt: new Date(located.leaseExpiresMs).toISOString(),
          },
          budget: budgetView,
          policyDigest: located.policyDigest,
          profileConfigDigest: located.profileConfigDigest,
          correlationId: randomUUID(),
        },
        attempts: (await deps.journal.list(principal.tenantId, located.projectId, located.sessionId)).map(
          (attempt) => ({
            logicalRequestId: attempt.logicalRequestId,
            attemptId: attempt.attemptId,
            attemptNo: attempt.attemptNo,
            state: attempt.state,
            providerRequestId: attempt.providerRequestId,
            // Only a dispatch can possibly be charged; preparation cannot.
            possibleCharge: attempt.possibleCharge ?? (attempt.dispatchedAt !== null || ['completed','unknown','streaming'].includes(attempt.state)),
            inputDigest: attempt.inputDigest,
            profileDigest: attempt.profileDigest,
            inputArtifactId: attempt.inputArtifactId,
            responseArtifactId: attempt.responseArtifactId,
            createdAt: attempt.createdAt.toISOString(),
            finishedAt: attempt.finishedAt === null ? null : attempt.finishedAt.toISOString(),
          }),
        ),
        unresolvedAttempts,
      };
    },

    /**
     * Builds the port the loop uses. Every guard re-checks the claim, the
     * revisions, store readiness, source availability and the remaining budget
     * immediately before it permits work.
     */
    turnGuard(scope: RunContext, claim: ClaimState): TurnGuard {
      return createTurnGuard({
        capture: deps.capture,
        db: deps.db,
        graphs: deps.graphs,
        journal: deps.journal,
        artifacts: deps.artifacts,
        clock: deps.clock,
        logger,
        activity: deps.activity,
        scope,
        claim,
        limits,
        policy: policy(),
      });
    },
  };
  return service;
}

interface JournalLike {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

async function countToolCalls(db: SqlDatabase, scope: JournalLike): Promise<number> {
  const rows = await db.withTenantTransaction(scope.tenantId, (tx) =>
    tx.rows<{ count: string }>(
      `SELECT count(*) AS count FROM threadline.tool_executions
        WHERE tenant_id = $1 AND project_id = $2 AND agent_session_id = $3`,
      [scope.tenantId, scope.projectId, scope.sessionId],
    ),
  );
  const value = Number(rows[0]?.count ?? '0');
  return Number.isSafeInteger(value) ? value : 0;
}

interface ClaimParamInput {
  readonly projectId: string;
  readonly graphEpoch: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly stateId: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly expectedRevision: number;
  readonly expectedRequirementRevision: number;
  readonly requirementRevision: number;
  readonly fence: number;
  readonly leaseExpiresMs: number;
  readonly authorizationDigest: string;
  readonly authorizationJson: string;
  readonly policyDigest: string;
  readonly maxTotalTokens: number;
  readonly deadlineMs: number;
  readonly actorId: string;
  readonly nowMs: number;
}

function claimParams(input: ClaimParamInput): Record<string, string | number> {
  const eventPayloadJson = JSON.stringify({
    taskId: input.taskId,
    sessionId: input.sessionId,
    runId: input.runId,
    fence: input.fence,
  });
  return {
    project_id: input.projectId,
    graph_epoch: input.graphEpoch,
    task_id: input.taskId,
    session_id: input.sessionId,
    run_id: input.runId,
    state_id: input.stateId,
    request_id: input.requestId,
    request_digest: input.requestDigest,
    expected_revision: input.expectedRevision,
    expected_requirement_revision: input.expectedRequirementRevision,
    requirement_revision: input.requirementRevision,
    lease_expires_ms: input.leaseExpiresMs,
    authorization_digest: input.authorizationDigest,
    authorization_json: input.authorizationJson,
    policy_digest: input.policyDigest,
    max_total_tokens: input.maxTotalTokens,
    deadline_ms: input.deadlineMs,
    actor_id: input.actorId,
    now_ms: input.nowMs,
    current_state_edge_id: randomUUID(),
    has_run_edge_id: randomUUID(),
    event_id: randomUUID(),
    receipt_id: randomUUID(),
    event_payload_json: eventPayloadJson,
    event_payload_digest: sha256Hex(eventPayloadJson),
    result_json: JSON.stringify({ taskId: input.taskId, sessionId: input.sessionId }),
  };
}

async function markRunActive(db: SqlDatabase, tenantId: string, projectId: string, runId: string): Promise<void> {
  await db.withTenantTransaction(tenantId, tx => tx.rows(`UPDATE threadline.runs SET observed_status='active'
    WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND observed_status='admitted' AND finished_at IS NULL`, [tenantId,projectId,runId]));
}

async function requireRunControl(db: SqlDatabase, principal: AuthenticatedPrincipal, run: LocatedSession): Promise<void> {
  await requireProjectMembership(db, principal.tenantId, run.projectId, principal.userId);
  if (run.initiatedBy !== principal.userId)
    throw new ThreadlineError('unauthorized', 'Only the run initiator may renew or cancel this run.', { reason: 'run_initiator_required' });
}

async function findExistingRun(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  requestId: string,
): Promise<{ runId: string; sessionId: string; authorizationDigest: string; claimRefused: boolean } | null> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{ run_id: string; session_id: string; authorization_digest: string; claim_refused: boolean }>(
      `SELECT s.run_id, s.id AS session_id, s.authorization_digest,
          (r.observed_status='cancelled' AND r.finished_at IS NOT NULL AND s.runtime_status='stopped') AS claim_refused
         FROM threadline.agent_sessions s
         JOIN threadline.runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
        WHERE s.tenant_id = $1 AND s.project_id = $2
          AND s.authorization_manifest->>'requestId' = $3
        LIMIT 1`,
      [tenantId, projectId, requestId],
    ),
  );
  const row = rows[0];
  return row === undefined ? null : { runId: row.run_id, sessionId: row.session_id, authorizationDigest: row.authorization_digest, claimRefused: row.claim_refused };
}

async function assertOneLiveRun(db: SqlDatabase, tenantId: string, projectId: string): Promise<void> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{ id: string }>(
      `SELECT id FROM threadline.runs
        WHERE tenant_id = $1 AND project_id = $2 AND (finished_at IS NULL
          OR EXISTS (SELECT 1 FROM threadline.agent_sessions s JOIN threadline.model_requests m
            ON m.tenant_id = s.tenant_id AND m.agent_session_id = s.id
            WHERE s.tenant_id = threadline.runs.tenant_id AND s.run_id = threadline.runs.id
             AND m.status IN ('prepared','dispatched','streaming','unknown')))
        LIMIT 1`,
      [tenantId, projectId],
    ),
  );
  if (rows.length > 0) {
    throw new ThreadlineError(
      'authority_conflict',
      'A run is already active for this project; only one live run is allowed.',
      { reason: 'one_live_run' },
    );
  }
}

async function registerCandidateWorkspace(
  deps: ExecutionDeps,
  principal: AuthenticatedPrincipal,
  scope: ProjectScope,
  request: StartRunRequest,
): Promise<{ id: string }> {
  const rows = await deps.db.withTenantTransaction(scope.tenantId, (tx) =>
    tx.rows<{ id: string; host_id: string }>(
      `SELECT id, host_id FROM threadline.workspace_registrations
        WHERE tenant_id = $1 AND project_id = $2 AND canonical_path = $3 AND status = 'registered'
        LIMIT 1`,
      [scope.tenantId, scope.projectId, request.workspacePath],
    ),
  );
  const existing = rows[0];
  if (existing !== undefined) {
    return { id: existing.id };
  }
  const registered = await deps.registry.registerWorkspace({
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    hostId: request.hostId,
    canonicalPath: request.workspacePath,
    repositoryFingerprint: request.workspaceFingerprint,
    kind: 'builder',
  });
  void principal;
  void request.workspaceFingerprint;
  return { id: registered.id };
}

interface LocatedSession {
  readonly initiatedBy: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly taskGraphId: string;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly modelId: string;
  readonly graphEpoch: string;
  readonly graphKey: string;
  /** Digest of the immutable run policy. */
  readonly policyDigest: string;
  /** Digest of the admitted provider profile's immutable configuration. */
  readonly profileConfigDigest: string;
  readonly runStatus: 'admitted' | 'active' | 'paused' | 'completed' | 'cancelled';
  readonly sessionStatus: 'reserved' | 'live' | 'stopping' | 'stopped' | 'unknown';
  readonly fence: number;
  readonly revision: number;
  readonly requirementRevision: number;
  readonly leaseExpiresMs: number;
  readonly createdAt: Date;
}

/** Reads the policy digest the run was admitted with. */
async function runPolicyDigest(db: SqlDatabase, tenantId: string, runId: string): Promise<string> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{ policy_digest: string }>(
      'SELECT trim(policy_digest) AS policy_digest FROM threadline.runs WHERE tenant_id = $1 AND id = $2',
      [tenantId, runId],
    ),
  );
  const digest = rows[0]?.policy_digest;
  if (digest === undefined) {
    throw new ThreadlineError('not_found', 'No run exists for that id.');
  }
  return digest;
}

async function locateSession(
  db: SqlDatabase,
  graphs: GraphStore,
  tenantId: string,
  runId: string,
): Promise<LocatedSession> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{
      project_id: string;
      session_id: string;
      task_graph_id: string;
      profile_id: string;
      workspace_id: string;
      model_id: string;
      graph_epoch: string;
      graph_key: string;
      policy_digest: string;
      profile_config_digest: string;
      initiated_by: string;
      run_status: 'admitted' | 'active' | 'paused' | 'completed' | 'cancelled';
      session_status: 'reserved' | 'live' | 'stopping' | 'stopped' | 'unknown';
      created_at: Date;
    }>(
      `SELECT s.project_id, s.id AS session_id, s.task_graph_id, s.profile_id, s.workspace_id,
              p.model_id, pj.graph_epoch, pj.graph_key,
              trim(r.policy_digest) AS policy_digest,
              trim(p.config_digest) AS profile_config_digest,
              r.initiated_by, r.observed_status AS run_status, s.runtime_status AS session_status, r.created_at
         FROM threadline.agent_sessions s
         JOIN threadline.runs r ON r.tenant_id = s.tenant_id AND r.id = s.run_id
         JOIN threadline.provider_profiles p
           ON p.tenant_id = s.tenant_id AND p.id = s.profile_id
         JOIN threadline.projects pj ON pj.tenant_id = s.tenant_id AND pj.id = s.project_id
        WHERE s.tenant_id = $1 AND s.run_id = $2
        LIMIT 1`,
      [tenantId, runId],
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    throw new ThreadlineError('not_found', 'No run exists for that id.');
  }
  const current = await graphs.graph(row.graph_key).roQuery<{
    fence: number; revision: number; requirement_revision: number; lease_expires_ms: number;
  }>(`MATCH (p:ProjectRoot {id:$project_id}), (t:Task {id:$task_id})-[:CURRENT_STATE]->(s:TaskState)
      OPTIONAL MATCH (a:AgentSession {sql_id:$session_id})
      WITH p,t,s,a WHERE p.graph_epoch=$graph_epoch AND s.revision=t.current_revision AND s.status=t.current_status
      RETURN coalesce(t.fence,0) AS fence,t.current_revision AS revision,
       t.requirement_revision AS requirement_revision,coalesce(a.lease_expires_ms,s.lease_expires_ms,0) AS lease_expires_ms`,
    { params: { project_id: row.project_id, task_id: row.task_graph_id, graph_epoch: row.graph_epoch, session_id: row.session_id } });
  const claim = current.data?.[0];
  if (current.data?.length !== 1 || !claim)
    throw new ThreadlineError('authority_unavailable', 'The run has no unique current task state.');
  return {
    initiatedBy: row.initiated_by,
    projectId: row.project_id,
    sessionId: row.session_id,
    taskGraphId: row.task_graph_id,
    profileId: row.profile_id,
    workspaceId: row.workspace_id,
    modelId: row.model_id,
    graphEpoch: row.graph_epoch,
    graphKey: row.graph_key,
    policyDigest: row.policy_digest,
    profileConfigDigest: row.profile_config_digest,
    runStatus: row.run_status,
    sessionStatus: row.session_status,
    fence: claim.fence,
    revision: claim.revision,
    requirementRevision: claim.requirement_revision,
    leaseExpiresMs: claim.lease_expires_ms,
    createdAt: row.created_at,
  };
}

function createTurnGuard(input: {
  readonly db: SqlDatabase;
  readonly graphs: GraphStore;
  readonly journal: ModelRequestJournal;
  readonly artifacts: ArtifactWriter;
  readonly capture: CaptureStore;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly activity?: ActivitySink;
  readonly scope: RunContext;
  readonly claim: ClaimState;
  readonly limits: ExecutionPolicyLimits;
  readonly policy: RunPolicy;
}): TurnGuard {
  const { db, graphs, journal, artifacts, capture, clock, logger, activity, scope, claim, limits } = input;
  const prepared = new Map<string, { attemptNo: number; reservationId: string; reservedTokens: number }>();
  const releasedTools = new Map<string, ToolIntent>();
  let observationChain: Promise<void> = Promise.resolve();
  // The lease and fence genuinely move during a run, so the guard keeps its own
  // mutable copy rather than mutating the readonly view it was handed.
  let liveFence = claim.fence;
  let liveRevision = claim.revision;
  let leaseExpiresMs = claim.leaseExpiresMs;

  /**
   * Re-resolves the authority facts from SQL.
   *
   * This runs before every release rather than once at launch, so a revoked
   * session, a withdrawn membership or a changed profile owner stops the work
   * instead of being papered over by the run's original snapshot.
   */
  const resolveReleaseFacts = async (): Promise<ReleaseAuthorityFacts> => {
    const rows = await db.withTenantTransaction(scope.tenantId, (tx) =>
      tx.rows<{
        initiator_user_id: string;
        run_created_at: Date;
        user_session_id: string;
        human_session_revoked: Date | null;
        human_session_expires: Date;
        human_session_idle: Date;
        membership_status: string | null;
        profile_owner_user_id: string;
        account_owner_user_id: string;
        account_probe_status: string;
        profile_config_digest: string;
        profile_settings: Record<string, unknown>;
        profile_model_id: string;
        profile_adapter_version: string;
      }>(
        `SELECT r.initiated_by AS initiator_user_id, r.created_at AS run_created_at,
                us.id AS user_session_id,
                us.revoked_at AS human_session_revoked,
                us.expires_at AS human_session_expires,
                us.idle_expires_at AS human_session_idle,
                pm.status AS membership_status,
                pp.owner_user_id AS profile_owner_user_id,
                pa.user_id AS account_owner_user_id,
                pa.probe_status AS account_probe_status,
                trim(pp.config_digest) AS profile_config_digest,
                pp.settings AS profile_settings, pp.model_id AS profile_model_id, pp.adapter_version AS profile_adapter_version
           FROM threadline.runs r
           JOIN threadline.provider_profiles pp
             ON pp.tenant_id = r.tenant_id AND pp.id = $1
           JOIN threadline.provider_accounts pa
             ON pa.tenant_id = pp.tenant_id AND pa.id = pp.provider_account_id
           JOIN threadline.agent_sessions s
             ON s.tenant_id = r.tenant_id AND s.run_id = r.id AND s.id = $5
           JOIN threadline.user_sessions us
             ON us.tenant_id = r.tenant_id
            AND us.id::text = s.authorization_manifest->>'humanSessionId'
            AND us.user_id = r.initiated_by
           LEFT JOIN threadline.project_memberships pm
             ON pm.tenant_id = r.tenant_id
            AND pm.project_id = r.project_id
            AND pm.user_id = r.initiated_by
          WHERE r.tenant_id = $2 AND r.project_id = $3 AND r.id = $4
            AND s.ended_at IS NULL AND r.finished_at IS NULL
            AND pp.config_digest = s.authorization_manifest->>'profileDigest'
          LIMIT 1`,
        [scope.profileId, scope.tenantId, scope.projectId, scope.runId, scope.sessionId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ThreadlineError(
        'authority_conflict',
        'The run identities could not be resolved; the release is refused.',
        { reason: 'run_identities_unresolvable' },
      );
    }
    if (canonicalDigest({ modelId: row.profile_model_id, adapterVersion: row.profile_adapter_version,
      settings: row.profile_settings as CanonicalValue }) !== row.profile_config_digest.trim())
      throw new ThreadlineError('authority_conflict', 'The admitted provider configuration changed.', { reason: 'profile_config_changed' });
    if (clock().getTime() > row.run_created_at.getTime() + limits.deadlineMs)
      throw new ThreadlineError('authority_conflict', 'The run deadline has expired.', { reason: 'run_deadline' });
    if (row.human_session_revoked !== null) {
      throw new ThreadlineError('unauthorized', 'The initiating session has been revoked.', {
        reason: 'session_revoked',
      });
    }
    const now = clock();
    if (row.human_session_expires.getTime() <= now.getTime()) {
      throw new ThreadlineError('unauthorized', 'The initiating session has expired.', {
        reason: 'session_absolute_expired',
      });
    }
    if (row.human_session_idle.getTime() <= now.getTime()) {
      throw new ThreadlineError('unauthorized', 'The initiating session is idle-expired.', {
        reason: 'session_idle_expired',
      });
    }
    if (row.membership_status !== 'active') {
      throw new ThreadlineError('unauthorized', 'The initiating human is no longer an active project member.', {
        reason: 'membership_inactive',
      });
    }
    if (row.profile_owner_user_id !== row.initiator_user_id) {
      throw new ThreadlineError('unauthorized', 'The provider profile is no longer owned by the initiator.', {
        reason: 'profile_owner_changed',
      });
    }
    if (row.account_owner_user_id !== row.initiator_user_id) {
      throw new ThreadlineError('unauthorized', 'The provider account is no longer owned by the initiator.', {
        reason: 'account_owner_changed',
      });
    }
    return {
      initiatorUserId: row.initiator_user_id,
      humanSessionId: row.user_session_id,
      profileOwnerUserId: row.profile_owner_user_id,
      providerAccountOwnerUserId: row.account_owner_user_id,
      profileIsFixture: row.account_probe_status === 'fixture',
      profileConfigDigest: row.profile_config_digest.trim(),
      profileSettings: row.profile_settings,
      requiredSourceIds: [],
    };
  };

  /**
   * The authoritative release guard.
   *
   * Order matters: cheap local checks, then the SQL authority re-resolution,
   * then the graph read that decides epoch/revision/fence/owner, then the lease
   * compared against the controlled clock. Nothing here trusts a value cached
   * when the run started.
   */
  const verifyReleaseAuthority = async (): Promise<ReleaseAuthorityFacts> => {
    if (clock().getTime() > leaseExpiresMs) {
      throw new ThreadlineError(
        'authority_conflict',
        'The claim lease has expired; admission is revoked. This does not prove external execution stopped.',
        { reason: 'claim_expired' },
      );
    }
    const facts = await resolveReleaseFacts();

    const graphKey = await currentGraphKey(db, scope);
    const graph = graphs.graph(graphKey);

    const authority = await graph.query<{
      graph_epoch: string;
      requirement_revision: number;
      revision: number;
      task_requirement_revision: number;
      fence: number;
      owner_session_id: string;
      run_id: string;
    }>(READ_RELEASE_AUTHORITY_CYPHER, {
      params: {
        project_id: scope.projectId,
        graph_epoch: scope.graphEpoch,
        task_id: scope.taskId,
        session_id: scope.sessionId,
        run_id: scope.runId,
        fence: liveFence,
        revision: liveRevision,
        requirement_revision: claim.requirementRevision,
      },
    });
    const row = authority.data?.[0];
    if (row === undefined) {
      throw new ThreadlineError(
        'authority_conflict',
        'The graph no longer shows this session holding the task at this epoch, revision and fence.',
        { reason: 'release_authority_lost' },
      );
    }
    liveRevision = row.revision; // Checkpoint-only states retain the same owner, fence and requirement.
    if (row.run_id !== scope.runId) {
      throw new ThreadlineError('authority_conflict', 'The task is bound to a different run.', {
        reason: 'run_binding_changed',
      });
    }

    // The lease comes from the graph, not from a cached timestamp.
    const lease = await graph.query<{ lease_expires_ms: number; status: string }>(
      READ_CLAIM_LEASE_CYPHER,
      {
        params: {
          project_id: scope.projectId,
          graph_epoch: scope.graphEpoch,
          task_id: scope.taskId,
          session_id: scope.sessionId,
          fence: liveFence,
        },
      },
    );
    const leaseRow = lease.data?.[0];
    if (leaseRow === undefined) {
      throw new ThreadlineError('authority_conflict', 'The claim lease is no longer recorded for this fence.', {
        reason: 'claim_lease_missing',
      });
    }
    if (clock().getTime() > leaseRow.lease_expires_ms) {
      throw new ThreadlineError(
        'authority_conflict',
        'The claim lease has expired in the graph; admission is revoked. This does not prove external execution stopped.',
        { reason: 'claim_expired' },
      );
    }
    leaseExpiresMs = leaseRow.lease_expires_ms;

    // Original sources must still be readable, or the work has no provenance.
    const requiredSources = await requiredSourcesFor(graphs, graphKey);
    await requireSourcesReadable(db, scope, requiredSources);

    return {
      ...facts,
      requiredSourceIds: requiredSources.map((source) => source.sourceSqlId),
    };
  };

  const requireBudgetHeadroom = async (): Promise<void> => {
    const attempts = await journal.countAttempts(scope.tenantId, scope.projectId, scope.sessionId);
    if (attempts >= limits.maxAttempts) {
      throw new ThreadlineError('authority_conflict', 'The run has reached its provider attempt limit.', {
        reason: 'max_attempts',
      });
    }
    const unresolved = await journal.countUnresolved(scope.tenantId, scope.projectId, scope.sessionId);
    if (unresolved > 0) {
      throw new ThreadlineError(
        'authority_conflict',
        'An earlier attempt has an unresolved outcome; reconcile before starting another.',
        { reason: 'unresolved_attempt' },
      );
    }
    const [reserved, observed] = await Promise.all([
      journal.reservedTokens(scope.tenantId, scope.projectId, scope.sessionId),
      journal.observedTokens(scope.tenantId, scope.projectId, scope.sessionId),
    ]);
    if (reserved + observed >= limits.maxTotalTokens) {
      throw new ThreadlineError('authority_conflict', 'The run has reached its total token budget.', {
        reason: 'max_total_tokens',
      });
    }
    // The heartbeat interval is the renewal cadence; once less than one
    // interval of lease remains, a new turn must not start without a renewal.
    if (leaseExpiresMs - clock().getTime() < limits.claimHeartbeatMs) {
      throw new ThreadlineError('authority_conflict', 'The claim lease is stale; heartbeat first.', {
        reason: 'stale_lease',
      });
    }
  };

  return {
    async rebuildInput() {
      const attempts = await journal.list(scope.tenantId, scope.projectId, scope.sessionId);
      const last = attempts.at(-1);
      if (!last || last.state !== 'completed' || !last.responseArtifactId)
        throw new ThreadlineError('authority_conflict', 'The latest turn is not durably complete.');
      const submitted = JSON.parse((await artifacts.read(scope.tenantId, scope.projectId, last.inputArtifactId)).toString('utf8'));
      const terminal = JSON.parse((await artifacts.read(scope.tenantId, scope.projectId, last.responseArtifactId)).toString('utf8'));
      const api = (await resolveReleaseFacts()).profileSettings['api'];
      const submittedInput = Array.isArray(submitted.input) ? submitted.input : api === 'anthropic-messages' ? fromAnthropicMessages(submitted.messages) : fromChatMessages(submitted.messages);
      if (!Array.isArray(submittedInput) || !Array.isArray(terminal.visibleOutput) || !Array.isArray(terminal.toolCalls))
        throw new ThreadlineError('authority_conflict', 'Durable conversation records are incomplete.');
      const items: import('../provider/responses.js').ConversationItem[] = [...submittedInput, ...terminal.visibleOutput];
      for (const call of terminal.toolCalls as TerminalRecord['toolCalls']) {
        if (!items.some(item => 'type' in item && item.type === 'function_call' && item.call_id === call.callId))
          items.push({ type: 'function_call', call_id: call.callId, name: call.toolName, arguments: call.argumentsJson });
      }
      for (const call of terminal.toolCalls as TerminalRecord['toolCalls']) {
        const rows = await db.withTenantTransaction(scope.tenantId, tx => tx.rows<{ output_artifact_id: string | null }>(
          `SELECT output_artifact_id FROM threadline.tool_executions
           WHERE tenant_id=$1 AND project_id=$2 AND agent_session_id=$3 AND runtime_call_id=$4 AND finished_at IS NOT NULL`,
          [scope.tenantId, scope.projectId, scope.sessionId, call.callId]));
        if (rows.length !== 1 || !rows[0]?.output_artifact_id)
          throw new ThreadlineError('authority_conflict', 'A durable tool result is missing or duplicated.');
        const output = await artifacts.read(scope.tenantId, scope.projectId, rows[0].output_artifact_id);
        items.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ ...JSON.parse(output.toString('utf8')), evidenceSourceId: rows[0].output_artifact_id }) });
      }
      return items;
    },
    async beginTurn() {
      await verifyReleaseAuthority();
      return { logicalRequestId: randomUUID(), attemptId: randomUUID() };
    },

    async authorizeAndJournal(preparedAttempt) {
      // 1. authority, 2. budget, 3. durable input artifact + attempt row.
      const facts = await verifyReleaseAuthority();
      await requireBudgetHeadroom();
      if (preparedAttempt.model !== scope.model) {
        throw new ThreadlineError('unauthorized', 'The turn model is not the admitted profile model.', {
          reason: 'model_mismatch',
        });
      }
      if (estimateRequestTokens(preparedAttempt.requestBody).tokens > limits.maxInputTokens) {
        throw new ThreadlineError('authority_conflict', 'The whole request exceeds the conservative input budget.', { reason: 'max_input_tokens' });
      }
      if (preparedAttempt.maxOutputTokens > limits.maxOutputTokens) {
        throw new ThreadlineError('authority_conflict', 'The requested output limit exceeds the run policy.', {
          reason: 'max_output_tokens',
        });
      }

      const outcome = await journal.prepare(
        {
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          sessionId: scope.sessionId,
          runId: scope.runId,
          profileId: scope.profileId,
          profileConfigDigest: facts.profileConfigDigest,
          profileSettings: facts.profileSettings,
          profileIsFixture: facts.profileIsFixture,
          maxTotalTokens: limits.maxTotalTokens,
          taskId: scope.taskId,
          graphEpoch: scope.graphEpoch,
          requirementRevision: claim.requirementRevision,
          correlationId: scope.correlationId,
        },
        preparedAttempt,
        async () => { await verifyReleaseAuthority(); await requireBudgetHeadroom(); },
      );
      prepared.set(preparedAttempt.attemptId, {
        attemptNo: outcome.attemptNo,
        reservationId: outcome.reservationId,
        reservedTokens: outcome.reservedTokens,
      });
      activity?.({
        kind: 'attempt_state',
        runId: scope.runId,
        logicalRequestId: preparedAttempt.logicalRequestId,
        attemptNo: outcome.attemptNo,
        state: 'prepared',
      });
      return { modelRequestId: outcome.attemptRowId, inputArtifactId: outcome.inputArtifactId };
    },

    observeLifecycle(event) {
      // Synchronous by contract; serialize so an observation can never reorder
      // or block the transport that produced it.
      observationChain = observationChain
        .then(() =>
          journal.observe(
            {
              tenantId: scope.tenantId,
              projectId: scope.projectId,
              sessionId: scope.sessionId,
              runId: scope.runId,
              profileId: scope.profileId,
              taskId: scope.taskId,
              graphEpoch: scope.graphEpoch,
              requirementRevision: claim.requirementRevision,
              correlationId: scope.correlationId,
            },
            lifecycleAttemptId(event),
            event,
          ),
        )
        .catch((error: unknown) => {
          logger.log({
            level: 'warn',
            message: 'Lifecycle observation could not be journalled.',
            fields: { errorName: error instanceof Error ? error.name : typeof error },
          });
        });
      void observationChain;
    },

    async settleAttempt(settled, terminal: TerminalRecord): Promise<TerminalSettlement> {
      const state = prepared.get(settled.attemptId);
      if (state === undefined) {
        throw new ThreadlineError('authority_conflict', 'The attempt was never prepared or journalled.');
      }
      await observationChain;
      const outcome = await journal.settle(
        {
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          sessionId: scope.sessionId,
          runId: scope.runId,
          profileId: scope.profileId,
          taskId: scope.taskId,
          graphEpoch: scope.graphEpoch,
          requirementRevision: claim.requirementRevision,
          correlationId: scope.correlationId,
        },
        settled.attemptId,
        state.attemptNo,
        state.reservationId,
        settled,
        terminal,
      );
      activity?.({
        kind: 'attempt_state',
        runId: scope.runId,
        logicalRequestId: settled.logicalRequestId,
        attemptNo: state.attemptNo,
        state: outcome.state,
      });
      if (outcome.state === 'completed' && terminal.complete) {
        for (const call of terminal.toolCalls) {
          if (releasedTools.has(call.callId)) throw new ThreadlineError('authority_conflict', 'A tool call ID was reused.');
          releasedTools.set(call.callId, call);
        }
      }
      return {
        state: outcome.state,
        responseArtifactId: (await journal.find(scope.tenantId, scope.projectId, settled.attemptId))?.responseArtifactId ?? null,
        usage: terminal.usage,
        reservationRetained: outcome.reservationRetained,
        blockedOnReconciliation: outcome.state === 'unknown',
        // Tools are released only for a complete, already-journalled batch.
        releasedToolCalls: outcome.state === 'completed' && terminal.complete ? terminal.toolCalls.map((call) => call.callId) : [],
      };
    },

    async authorizeTool(intent: ToolIntent): Promise<ToolAuthorization> {
      const released = releasedTools.get(intent.callId);
      if (!released || released.toolName !== intent.toolName || released.argumentsJson !== intent.argumentsJson)
        throw new ThreadlineError('authority_conflict', 'This tool intent was not released by a complete durable batch.');
      await verifyReleaseAuthority();
      const toolCallsUsed = await countToolCallsFor(db, scope);
      if (toolCallsUsed >= limits.maxToolCalls) {
        throw new ThreadlineError('authority_conflict', 'The run has reached its tool call limit.', {
          reason: 'max_tool_calls',
        });
      }
      const inputBytes = Buffer.from(
        JSON.stringify({ toolName: intent.toolName, arguments: intent.argumentsJson }),
        'utf8',
      );
      const artifact = await artifacts.publish({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        kind: 'tool_input',
        bytes: inputBytes,
        id: randomUUID(),
      });
      const toolExecutionId = randomUUID();
      const now = clock();

      // One capture boundary: the store allocates the position safely, hashes
      // the canonical payload, and commits the outbox entry with the row.
      const appended = await capture.append({
        correlation: {
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          agentSessionId: scope.sessionId,
          runId: scope.runId,
          taskId: scope.taskId,
          graphEpoch: scope.graphEpoch,
          acceptedRevision: claim.revision,
          requirementRevision: claim.requirementRevision,
          callId: intent.callId,
        },
        kind: 'tool.intent',
        origin: 'tool',
        sourceKey: `tool:${intent.callId}`,
        observedAt: now,
        payload: { callId: intent.callId, toolName: intent.toolName },
        references: { inputArtifactId: artifact.id },
      });
      if (appended.kind === 'conflict') {
        throw new ThreadlineError(
          'authority_conflict',
          'This tool call was already captured with different content.',
          { reason: 'capture_conflict', sourceKey: appended.sourceKey },
        );
      }
      const captureEventId = appended.envelope.id;

      await withProjectAdmissionLock(db, scope.tenantId, scope.projectId, async (tx) => {
        await verifyReleaseAuthority();
        await tx.rows(
          `INSERT INTO threadline.tool_executions
             (tenant_id, project_id, id, agent_session_id, capture_event_id, runtime_call_id,
              tool_name, input_digest, input_artifact_id, output_artifact_id, status,
              exit_code, candidate_digest, started_at, finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'running', NULL, NULL, $10, NULL)`,
          [
            scope.tenantId,
            scope.projectId,
            toolExecutionId,
            scope.sessionId,
            captureEventId,
            intent.callId,
            intent.toolName,
            artifact.contentDigest,
            artifact.id,
            now,
          ],
        );
      });
      releasedTools.delete(intent.callId);
      return { toolExecutionId, inputArtifactId: artifact.id, inputDigest: artifact.contentDigest };
    },

    async recordToolResult(intent: ToolIntent, result: ToolResultRecord): Promise<void> {
      const outputArtifact = await artifacts.publish({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        kind: 'tool_output',
        bytes: Buffer.from(result.outputJson, 'utf8'),
        id: randomUUID(),
      });
      await db.withTenantTransaction(scope.tenantId, async (tx) => {
        await tx.rows(
          `UPDATE threadline.tool_executions
              SET output_artifact_id = $1, status = $2, exit_code = NULL,
                  candidate_digest = $3, finished_at = $4
            WHERE tenant_id = $5 AND project_id = $6 AND agent_session_id = $7
              AND runtime_call_id = $8`,
          [
            outputArtifact.id,
            result.status,
            result.candidateDigest,
            clock(),
            scope.tenantId,
            scope.projectId,
            scope.sessionId,
            intent.callId,
          ],
        );
      });
      const captured = await capture.append({
        correlation: { tenantId: scope.tenantId, projectId: scope.projectId, agentSessionId: scope.sessionId,
          runId: scope.runId, taskId: scope.taskId, graphEpoch: scope.graphEpoch,
          acceptedRevision: claim.revision, requirementRevision: claim.requirementRevision, callId: intent.callId },
        kind: 'tool.result', origin: 'tool', sourceKey: `tool:${intent.callId}:result`, observedAt: clock(),
        payload: { callId: intent.callId, toolName: intent.toolName, status: result.status,
          candidateDigest: result.candidateDigest, outputArtifactId: outputArtifact.id },
        references: { outputArtifactId: outputArtifact.id },
      });
      if (captured.kind === 'conflict') throw new ThreadlineError('authority_conflict', 'Tool result capture conflicts.');
    },

    async heartbeat(): Promise<ClaimState> {
      await verifyReleaseAuthority();
      const graph = graphs.graph(await currentGraphKey(db, scope));
      const renewed = await graph.query<{ revision: number; fence: number }>(RENEW_CLAIM_CYPHER, {
        params: {
          project_id: scope.projectId,
          graph_epoch: scope.graphEpoch,
          task_id: scope.taskId,
          session_id: scope.sessionId,
          fence: liveFence,
          now_ms: clock().getTime(), lease_expires_ms: clock().getTime() + limits.claimLeaseMs,
          state_id: randomUUID(), state_edge_id: randomUUID(),
          new_status: 'running',
        },
      });
      const row = renewed.data?.[0];
      if (row === undefined) {
        throw new ThreadlineError('authority_conflict', 'The claim is no longer held.', {
          reason: 'stale_fence',
        });
      }
      liveFence = row.fence;
      liveRevision = row.revision;
      leaseExpiresMs = clock().getTime() + limits.claimLeaseMs;
      return {
        fence: liveFence,
        revision: liveRevision,
        requirementRevision: claim.requirementRevision,
        leaseExpiresMs,
      };
    },

    async releaseClaim(): Promise<void> {
      await withTaskCheckpointLock(db,scope.tenantId,scope.projectId,scope.taskId,async(db)=>{
      const graph = graphs.graph(await currentGraphKey(db, scope));
      const checkpoint=await graph.roQuery<{source_id:string}>(
        'MATCH (t:Task {id:$id}) WHERE t.checkpoint_source_id IS NOT NULL RETURN t.checkpoint_source_id AS source_id',
        {params:{id:scope.taskId}});
      const sourceId=checkpoint.data?.[0]?.source_id;
      await graph.query(sourceId?RELEASE_CHECKPOINTED_CLAIM_CYPHER:RELEASE_CLAIM_CYPHER, {
        params: {
          run_id: scope.runId,
          project_id: scope.projectId,
          graph_epoch: scope.graphEpoch,
          task_id: scope.taskId,
          session_id: scope.sessionId,
          fence: liveFence,
          now_ms: clock().getTime(), lease_expires_ms: clock().getTime(),
          state_id: randomUUID(), state_edge_id: randomUUID(),
          new_status: 'ready',
          checkpoint_source_id:sourceId??'',checkpoint_edge_id:randomUUID(),
        },
      });
      await db.withTenantTransaction(scope.tenantId, (tx) =>
        tx.rows(
          `UPDATE threadline.agent_sessions SET runtime_status = 'stopped', ended_at = $1
            WHERE tenant_id = $2 AND project_id = $3 AND id = $4`,
          [clock(), scope.tenantId, scope.projectId, scope.sessionId],
        ),
      );
      }, 'release');
    },
  };
}

/**
 * Every lifecycle variant carries its attempt identity on a different member.
 * Reading it from the wrong place produced an observation that was silently
 * dropped, so the lookup is explicit about each shape.
 */
function lifecycleAttemptId(event: ProviderLifecycle): string {
  switch (event.phase) {
    case 'prepared':
      return event.prepared.attemptId;
    case 'journaled':
    case 'dispatched':
      return event.attempt.attemptId;
    case 'response_observed':
      return event.observed.attemptId;
    case 'stream_observed':
      return event.observed.attemptId;
    case 'settled':
      return event.settled.attemptId;
    default:
      throw new ThreadlineError('internal_error', 'A lifecycle observation carried no attempt identity.');
  }
}

async function countToolCallsFor(db: SqlDatabase, scope: RunContext): Promise<number> {
  return countToolCalls(db, scope);
}

async function currentGraphKey(db: SqlDatabase, scope: RunContext): Promise<string> {
  const rows = await db.withTenantTransaction(scope.tenantId, (tx) =>
    tx.rows<{ graph_key: string }>(
      `SELECT graph_key FROM threadline.projects WHERE tenant_id = $1 AND id = $2`,
      [scope.tenantId, scope.projectId],
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    throw new ThreadlineError('not_found', 'The project record is missing.');
  }
  return row.graph_key;
}

export { deriveGraphKey } from '../storage/identity.js';
interface RequiredSource {
  readonly sourceId: string;
  /** The `project_messages` row this graph Source stands for. */
  readonly sourceSqlId: string;
  readonly availability: string;
  readonly contentDigest: string;
}

/**
 * Reads the Sources the accepted authority depends on.
 *
 * Resolved from the graph on every release rather than cached, because an
 * artifact can become unavailable while a run is live.
 */
async function requiredSourcesFor(
  graphs: GraphStore,
  graphKey: string,
): Promise<readonly RequiredSource[]> {
  const reply = await graphs
    .graph(graphKey)
    .query<{ source_id: string; source_sql_id: string; availability: string; content_digest: string }>(
      READ_REQUIRED_SOURCES_CYPHER,
      { params: {} },
    );
  return (reply.data ?? [])
    .filter((row) => typeof row.source_sql_id === 'string' && row.source_sql_id.length > 0)
    .map((row) => ({
      sourceId: row.source_id,
      sourceSqlId: row.source_sql_id,
      availability: row.availability,
      contentDigest: row.content_digest,
    }));
}

/**
 * Refuses a release when the Sources it was authorized against are no longer
 * readable.
 *
 * Two independent stores matter here: the SQL row that carries the message and
 * the artifact that carries its bytes. Either can disappear mid-run, and
 * silently continuing would mean the work is no longer traceable to the
 * authority that admitted it.
 */
async function requireSourcesReadable(
  db: SqlDatabase,
  scope: RunContext,
  sources: readonly RequiredSource[],
): Promise<void> {
  for (const source of sources) {
    if (source.availability !== 'available') {
      throw new ThreadlineError(
        'authority_conflict',
        'An original source is no longer available in the graph.',
        { reason: 'source_unavailable', sourceId: source.sourceId },
      );
    }
    const rows = await db.withTenantTransaction(scope.tenantId, (tx) =>
      tx.rows<{ id: string; body: string | null; body_digest: string }>(
        `SELECT m.id, m.body, trim(m.body_digest) AS body_digest
           FROM threadline.project_messages m
          WHERE m.tenant_id = $1 AND m.project_id = $2 AND m.id = $3`,
        [scope.tenantId, scope.projectId, source.sourceSqlId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ThreadlineError(
        'authority_conflict',
        'An original source for this authority is no longer present.',
        { reason: 'source_missing', sourceId: source.sourceSqlId },
      );
    }
    // The row carries its own bytes, so readability means the body is really
    // there and really is what both digests claim.
    if (typeof row.body !== 'string' || row.body.length === 0) {
      throw new ThreadlineError(
        'authority_conflict',
        'An original source for this authority no longer carries its text.',
        { reason: 'source_body_unreadable', sourceId: source.sourceSqlId },
      );
    }
    const sqlDigest = createHash('sha256').update(row.body, 'utf8').digest('hex');
    if (sqlDigest !== row.body_digest) {
      throw new ThreadlineError(
        'authority_conflict',
        'An original source no longer matches the digest recorded for it.',
        { reason: 'source_body_digest_mismatch', sourceId: source.sourceSqlId },
      );
    }
    if (typeof source.contentDigest === 'string' && source.contentDigest !== sqlDigest) {
      throw new ThreadlineError(
        'authority_conflict',
        'An original source disagrees with the digest the graph recorded for it.',
        { reason: 'source_graph_digest_mismatch', sourceId: source.sourceId },
      );
    }
  }
}
