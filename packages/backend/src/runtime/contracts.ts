/**
 * Backend-internal coordinator ports for the M02 runtime loop.
 *
 * Agent A owns this module. Agent B's `ResponsesDriver` is the consumer; its
 * lifecycle vocabulary (`AttemptIdentity`, `PreparedAttempt`,
 * `ProviderLifecycle`, `SettledAttempt`) is the source of truth for what the
 * transport observed, and this module adds only what the coordinator must
 * guarantee around it.
 *
 * The design rule: **the loop cannot reach the network without a coordinator
 * guard that has already re-checked authority and durably journaled the
 * intent.** A resolved promise is the proof; there is no best-effort path.
 *
 * Ordering for one provider turn:
 *
 *   1. `beginTurn`        caller-owned durable identity (logical request +
 *                         attempt), allocated before anything is sent
 *   2. driver builds      `PreparedAttempt` over the exact bytes
 *   3. `authorizeAndJournal`  recheck ownership, claim/fence/revisions, stores,
 *                         source availability and remaining limits; publish the
 *                         input artifact; reserve budget; insert the attempt row
 *                         in state `prepared`
 *   4. driver sends; `observeLifecycle` records observed transport facts
 *   5. `settleAttempt`    store terminal visible output and the full validated
 *                         tool-call batch before any tool runs; settle or retain
 *                         the reservation
 */

import type { RunState, SessionState } from '@threadline/shared';

import type { ConversationItem, FunctionTool } from '../provider/responses.js';
import type {
  AttemptIdentity,
  PreparedAttempt,
  ProviderLifecycle,
  ProviderLifecycleObserver,
  SettledAttempt,
} from '../provider/lifecycle.js';

export type {
  AttemptIdentity,
  ProviderLifecycle,
  ProviderLifecycleObserver,
  PreparedAttempt,
  SettledAttempt,
} from '../provider/lifecycle.js';

// Re-exported so the loop can name a run's state without importing the public
// package directly.
export type { RunState, SessionState };

/** Correlation id attached to every typed error so the CLI can display it. */
export type CorrelationId = string;

/** Durable states one provider attempt can hold in SQL. */
export const ATTEMPT_STATES = [
  'prepared',
  'dispatched',
  'streaming',
  'completed',
  'failed',
  'unknown',
  'cancelled',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * Usage is three different facts, never one number.
 *
 * - `reported`: the provider returned usage for this response.
 * - `reserved`: no usage observed, but the provider may have accepted and
 *   billed the request, so the reservation is retained.
 * - `known-zero`: the provider rejected the request before accepting it, so
 *   zero is observed rather than assumed.
 */
export type UsageObservation =
  | { readonly precision: 'reported'; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly precision: 'reserved'; readonly reason: string }
  | { readonly precision: 'known-zero'; readonly reason: string };

export interface RunContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  /** The logical Builder AgentSession. */
  readonly sessionId: string;
  readonly taskId: string;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly graphEpoch: string;
  readonly model: string;
  readonly correlationId: CorrelationId;
}

/**
 * Facts the coordinator re-resolves from SQL before every release.
 *
 * They are deliberately **not** part of `RunContext`: a launch-time snapshot
 * would be exactly the cached authority this milestone must not rely on. The
 * turn guard reads these again immediately before each provider dispatch and
 * each tool execution.
 */
export interface ReleaseAuthorityFacts {
  /** The authenticated human who initiated the run. */
  readonly initiatorUserId: string;
  /** The human application session used at launch. */
  readonly humanSessionId: string;
  readonly profileOwnerUserId: string;
  readonly providerAccountOwnerUserId: string;
  readonly profileIsFixture: boolean;
  readonly profileConfigDigest: string;
  readonly profileSettings: Readonly<Record<string, unknown>>;
  /** The accepted goal's original Source, which must stay readable. */
  readonly requiredSourceIds: readonly string[];
}

export interface ClaimState {
  readonly fence: number;
  readonly revision: number;
  readonly requirementRevision: number;
  readonly leaseExpiresMs: number;
}

export interface BudgetSnapshot {
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly maxToolCalls: number;
  readonly toolCallsUsed: number;
  readonly maxTotalTokens: number;
  readonly reservedTokens: number;
  readonly observedTokens: number;
  readonly deadlineMs: number;
}

/** The coordinator operations the loop calls. Every one can fail closed. */
export interface TurnGuard {
  /** Rebuild from verified durable input/terminal/result artifacts before another turn. */
  rebuildInput?(): Promise<readonly ConversationItem[]>;
  /** Allocates the caller-owned durable identity for one logical request. */
  beginTurn(): Promise<AttemptIdentity>;

  /**
   * The driver's mandatory pre-dispatch guard.
   *
   * Rechecks ownership, the live claim/fence/expiry, revisions, store
   * readiness, source availability and remaining policy limits; publishes the
   * exact input artifact and verifies its digest; reserves real budget; and
   * inserts the attempt row in state `prepared`.
   *
   * If this rejects, no request has been sent and no usage can exist.
   */
  authorizeAndJournal(prepared: PreparedAttempt): Promise<void>;

  /**
   * Records an observed transport fact. Synchronous by contract, matching the
   * driver's `onLifecycle`; the coordinator serializes it internally so an
   * observation can never reorder or block the transport.
   */
  observeLifecycle(event: ProviderLifecycle): void;

  /**
   * Stores the complete terminal visible output and the full validated
   * tool-call batch **before** any tool may execute, then settles observed
   * usage or retains the reservation.
   */
  settleAttempt(
    settled: SettledAttempt,
    terminal: TerminalRecord,
  ): Promise<TerminalSettlement>;

  /** Rechecks the claim and persists a stable tool invocation intent. */
  authorizeTool(intent: ToolIntent): Promise<ToolAuthorization>;

  /** Persists the real tool result before the next model input is prepared. */
  recordToolResult(intent: ToolIntent, result: ToolResultRecord): Promise<void>;

  /** Refreshes the claim lease. Throws when the claim is no longer held. */
  heartbeat(): Promise<ClaimState>;

  /** Releases the claim. Never implies external execution terminated. */
  releaseClaim(reason: string): Promise<void>;
}

export interface TerminalToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}

export interface TerminalRecord {
  readonly visibleOutput: readonly ConversationItem[];
  readonly toolCalls: readonly TerminalToolCall[];
  readonly responseId: string | null;
  readonly usage: UsageObservation;
  /** True only for a complete, contiguous terminal record. */
  readonly complete: boolean;
}

export interface TerminalSettlement {
  readonly state: AttemptState;
  readonly usage: UsageObservation;
  /** True when the reservation was retained because usage is unknown. */
  readonly reservationRetained: boolean;
  /** True when no further attempt may start without explicit reconciliation. */
  readonly blockedOnReconciliation: boolean;
  /** Tool calls released for execution. Empty unless the batch was complete. */
  readonly releasedToolCalls: readonly string[];
}

export interface ToolIntent {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}

export interface ToolAuthorization {
  readonly toolExecutionId: string;
  readonly inputArtifactId: string;
  readonly inputDigest: string;
}

export interface ToolResultRecord {
  readonly status: 'succeeded' | 'failed' | 'denied' | 'unknown';
  readonly outputJson: string;
  readonly outputDigest: string;
  readonly candidateDigest: string | null;
}

export interface RunPolicy {
  readonly maxAttempts: number;
  readonly maxToolCalls: number;
  readonly maxTotalTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly deadlineMs: number;
  readonly claimLeaseMs: number;
  readonly claimHeartbeatMs: number;
}

/**
 * What the loop receives when a run starts. It carries no database handle: the
 * API key reaches the driver separately and privately.
 */
export interface RunLaunch {
  readonly context: RunContext;
  readonly claim: ClaimState;
  readonly budget: BudgetSnapshot;
  readonly policy: RunPolicy;
  readonly apiKey: string;
}

/**
 * Best-effort activity deltas for the UI. Never a durable record; the
 * durable facts live in SQL and the graph and are readable via GET /runs/:runId.
 */
export type RuntimeActivity =
  | { readonly kind: 'run_state'; readonly runId: string; readonly state: string; readonly detail: string }
  | { readonly kind: 'visible_text'; readonly sessionId: string; readonly text: string }
  | {
      readonly kind: 'attempt_state';
      readonly runId: string;
      readonly logicalRequestId: string;
      readonly attemptNo: number;
      readonly state: AttemptState;
    }
  | {
      readonly kind: 'tool_state';
      readonly callId: string;
      readonly toolName: string;
      readonly state: string;
    };

export type ActivitySink = (activity: RuntimeActivity) => void;

/** Test-only seam: lets the assembled flow run without any paid request. */
export interface FixtureProviderFactory {
  readonly label: string;
  create(options: { apiKey: string; model: string }): {
    turn(request: {
      model: string;
      input: readonly ConversationItem[];
      tools: readonly FunctionTool[];
      signal: AbortSignal;
      maxOutputTokens: number;
      identity: AttemptIdentity;
      authorizeAndJournal: (prepared: PreparedAttempt) => Promise<void>;
      onLifecycle?: ProviderLifecycleObserver;
      onVisibleText: (text: string) => void;
    }): Promise<import('../provider/responses.js').ProviderTurnResult>;
  };
}