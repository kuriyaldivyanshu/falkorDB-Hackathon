/**
 * M02 execution contracts: runs, logical Builder sessions, claims and budgets.
 *
 * These describe what a client can see and request. They carry no database
 * handles, no credentials and no provider specifics.
 *
 * Identity rules, repeated here because they are the most commonly confused:
 *
 * - `requestId` is the caller's durable idempotency key for starting a run.
 * - `logicalRequestId` identifies one logical provider turn across retries.
 * - `attemptNo` counts physical dispatches of that logical request. Attempts
 *   are never reused and an unknown attempt is never replayed under a new id.
 * - the M00 `commandId` remains a per-delivery transport id with no durability.
 */

export const RUN_STATES = [
  'admitted',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const SESSION_STATES = ['reserved', 'live', 'stopping', 'stopped', 'unknown'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const TASK_CLAIM_STATES = [
  'ready',
  'claimed',
  'released',
  'expired',
  'unknown',
] as const;
export type TaskClaimState = (typeof TASK_CLAIM_STATES)[number];

export interface StartRunInput {
  /** Requested target. Membership and ownership are rechecked server-side. */
  readonly projectId: string;
  /** Durable idempotency key. Reuse it on retry. */
  readonly requestId: string;
  /** The accepted task to work on, from current authority. */
  readonly taskId: string;
  /** Provider profile to bind. Its owner must equal the initiating human. */
  readonly profileId: string;
  /** Registered candidate workspace. The model never chooses a filesystem root. */
  readonly workspaceId: string;
  /** Optimistic concurrency: must match current authority or it is refused. */
  readonly expectedRevision: number;
  readonly expectedRequirementRevision: number;
}

export interface RunClaimView {
  readonly taskId: string;
  readonly taskClaimState: TaskClaimState;
  readonly ownerSessionId: string | null;
  readonly fence: number;
  readonly revision: number;
  readonly requirementRevision: number;
  readonly leaseExpiresAt: string;
}

export interface RunBudgetView {
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly maxToolCalls: number;
  readonly toolCallsUsed: number;
  readonly maxTotalTokens: number;
  readonly reservedTokens: number;
  readonly observedTokens: number;
  readonly deadlineAt: string;
  /** Blocks new attempts until an explicit reconciliation resolves it. */
  readonly blockedOnReconciliation: boolean;
}

export interface RunLaunchView {
  readonly runId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly model: string;
  readonly graphEpoch: string;
  readonly state: RunState;
  readonly sessionState: SessionState;
  readonly claim: RunClaimView;
  readonly budget: RunBudgetView;
  /**
   * Digest of the immutable run policy.
   *
   * Carried separately from `profileConfigDigest` and from any per-attempt
   * input digest: an audit that cannot tell them apart cannot say which policy,
   * profile and request actually produced a turn.
   */
  readonly policyDigest: string;
  /** Digest of the admitted provider profile's immutable configuration. */
  readonly profileConfigDigest: string;
  readonly correlationId: string;
}

export type RunStartOutcome =
  | { readonly kind: 'admitted'; readonly run: RunLaunchView }
  | {
      readonly kind: 'accepted';
      readonly runId: string;
      readonly sessionId: string;
      readonly pendingReason: string;
    }
  | { readonly kind: 'replayed'; readonly run: RunLaunchView }
  | {
      readonly kind: 'rejected';
      readonly code: string;
      readonly reason: string;
      readonly correlationId: string;
    };

export interface AttemptView {
  readonly logicalRequestId: string;
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly state: string;
  readonly providerRequestId: string | null;
  readonly possibleCharge: boolean;
  /** SHA-256 over the exact bytes this attempt sent. */
  readonly inputDigest: string;
  /** SHA-256 over the admitted profile configuration. Never the input digest. */
  readonly profileDigest: string;
  readonly inputArtifactId: string;
  readonly responseArtifactId: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface RunInspectView {
  readonly run: RunLaunchView;
  readonly attempts: readonly AttemptView[];
  /** Set when any attempt is unresolved; the run will not start another turn. */
  readonly unresolvedAttempts: number;
}

export interface CancelRunInput {
  readonly runId: string;
  readonly reason: string;
}

export interface CancelRunOutcome {
  /** Acknowledged. Not proof that provider compute stopped. */
  readonly acknowledged: boolean;
  readonly runId: string;
  readonly state: RunState;
  readonly sessionState: SessionState;
  readonly usageUncertain: boolean;
  readonly reason: string;
}

export interface RunEventPayload {
  readonly runId: string;
  readonly sessionId: string;
  readonly state: RunState;
  readonly sessionState: SessionState;
  readonly detail: string;
}