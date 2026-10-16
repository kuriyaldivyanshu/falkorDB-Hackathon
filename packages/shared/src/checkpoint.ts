/**
 * M04 structured checkpoint and tactical state contracts.
 *
 * This is the frozen integration seam. It declares the shapes, the results and
 * the service ports Agent B consumes. It contains no storage logic.
 *
 * Five distinctions run through everything here, and most checkpoint bugs come
 * from collapsing one of them into another.
 *
 * **Proposed vs trusted.** A model may *propose* progress, a next action and a
 * plan. It may never supply the task, run, session, revision, coverage or
 * Source identities, and its prose never becomes verified state. `producer_kind`
 * records who authored a manifest.
 *
 * **SQL capture, graph admission, checkpoint coverage.** Three separate
 * positions. A capture row exists once it is committed to SQL. Graph admission
 * is later and may still be pending. Checkpoint coverage is later still and may
 * only claim what is both. They are never compared across sessions.
 *
 * **Checkpoint revision vs accepted requirement revision.** The first moves when
 * a checkpoint is republished; the second moves only when a human changes the
 * accepted requirements. Conflating them lets a routine checkpoint appear to
 * change the task's obligations.
 *
 **Committed vs pending vs ambiguous.** Publishing manifest bytes, updating the
 * TaskState pointer and admitting to the graph cannot be one atomic commit
 * across two stores. The result says which part happened.
 *
 **Replay vs conflict.** The same operation id with the same payload replays to
 * the original outcome. The same operation id with a different payload is a
 * conflict that mutates nothing.
 */

/* ------------------------------------------------------------------ */
/* Sequences                                                           */
/* ------------------------------------------------------------------ */

/**
 * A capture or revision position.
 *
 * A decimal **string**, never a number. These are `bigint` columns and a
 * checkpoint can legitimately record a position beyond `Number.MAX_SAFE_INTEGER`.
 * Parsing one into a JS number would silently round a coverage frontier, which
 * is exactly the kind of drift that makes a later checkpoint overstate coverage.
 * All arithmetic goes through `BigInt`.
 */
export type DecimalSequence = string;

const DECIMAL_SEQUENCE = /^(0|[1-9][0-9]*)$/;

export function isDecimalSequence(value: unknown): value is DecimalSequence {
  return typeof value === 'string' && value.length <= 40 && DECIMAL_SEQUENCE.test(value);
}

/**
 * Parses a decimal sequence to `bigint`, refusing anything that is not a plain
 * non-negative decimal.
 */
export function parseSequence(value: unknown): bigint {
  if (!isDecimalSequence(value)) {
    throw new TypeError('Expected a non-negative decimal sequence string.');
  }
  return BigInt(value);
}

/** Renders a `bigint` back into the canonical decimal string form. */
export function formatSequence(value: bigint): DecimalSequence {
  if (value < 0n) {
    throw new RangeError('A sequence cannot be negative.');
  }
  return value.toString(10);
}

/** True when `value` is a sequence strictly greater than `floor`. */
export function sequenceExceeds(value: DecimalSequence, floor: DecimalSequence): boolean {
  return parseSequence(value) > parseSequence(floor);
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

export const CHECKPOINT_SCHEMA_VERSION = 1;
export const EPISODE_SCHEMA_VERSION = 1;

/** `checkpoint_policy.tactical_plan_max_steps` equivalent: the schema says 8. */
export const MAX_PLAN_STEPS = 8;

/**
 * `development-profile.json` `max_replacement_sessions_per_run` is 3, so the
 * initial session plus three replacements is the whole admissible coverage set.
 */
export const MAX_COVERAGE_STREAMS = 4;

export const MAX_UNRESOLVED_EFFECTS = 80;
export const MAX_EPISODE_SOURCES = 80;
export const MAX_AFFECTED_PATHS = 100;
export const MAX_PROGRESS_LENGTH = 2000;
export const MAX_NEXT_ACTION_LENGTH = 1000;
export const MAX_STEP_TEXT_LENGTH = 300;
export const MAX_FAILURE_SIGNATURE_LENGTH = 512;

export const PLAN_STEP_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

/**
 * Allowed status transitions for one plan step.
 *
 * A step may not go backwards from `completed`: once recorded complete, that is
 * an observed fact about recorded work, and un-completing it would erase
 * evidence rather than add any.
 */
export const PLAN_STEP_TRANSITIONS: Readonly<Record<PlanStepStatus, readonly PlanStepStatus[]>> = {
  pending: ['pending', 'in_progress', 'completed'],
  in_progress: ['pending', 'in_progress', 'completed'],
  completed: ['completed'],
};

export function isAllowedStepTransition(from: PlanStepStatus, to: PlanStepStatus): boolean {
  return PLAN_STEP_TRANSITIONS[from].includes(to);
}

export interface TacticalPlanStep {
  readonly step_id: string;
  readonly text: string;
  readonly status: PlanStepStatus;
}

/**
 * One session's covered position.
 *
 * `graph_admitted_capture_seq` is the position whose graph admission has been
 * reconciled, which can lag `capture_seq`. Coverage only advances to what is
 * both captured and admitted.
 */
export interface CoveredPosition {
  readonly session_id: string;
  readonly capture_seq: DecimalSequence;
  readonly graph_admitted_capture_seq: DecimalSequence;
}

export interface UnresolvedEffect {
  readonly execution_id: string;
  readonly status: 'running' | 'unknown';
  readonly source_id: string;
}

export interface CheckpointManifest {
  readonly schema_version: 1;
  readonly task_id: string;
  /**
   * Required by the schema. When no run exists yet this is genuinely absent,
   * and the service refuses to publish rather than inventing one -- see
   * `CHECKPOINT_DUE_WITHOUT_RUN`.
   */
  readonly run_id: string;
  readonly graph_epoch: string;
  /** The immutable graph TaskState revision bound by this manifest; checkpointRevision is a separate counter. */
  readonly task_revision: DecimalSequence;
  /** The accepted requirement revision. Moves only on accepted human change. */
  readonly requirement_revision: DecimalSequence;
  readonly candidate_digest: string | null;
  readonly environment_digest: string | null;
  readonly covered_capture_positions: readonly CoveredPosition[];
  readonly progress: string;
  readonly next_action: string;
  readonly tactical_plan: readonly TacticalPlanStep[];
  readonly unresolved_effects: readonly UnresolvedEffect[];
  readonly pending_question_id: string | null;
  readonly episode_source_ids: readonly string[];
  readonly visibility: 'project' | 'user' | 'session';
  readonly producer_kind: 'service' | 'agent_proposal';
}

/* ------------------------------------------------------------------ */
/* Episode                                                             */
/* ------------------------------------------------------------------ */

/**
 * How much causality is claimed for a failure.
 *
 * The default is `not-inferred`. A captured nonzero exit is an observation; it
 * is not a cause, and promoting one without reproduction is the failure this
 * enum exists to prevent.
 */
export type CauseStatus = 'not-inferred' | 'hypothesis' | 'reproduced';

export const OBSERVED_OUTCOMES = ['succeeded', 'failed', 'denied', 'unknown'] as const;
export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export interface MemoryEpisode {
  readonly schema_version: 1;
  readonly task_id: string;
  readonly session_id: string;
  readonly source_id: string;
  readonly capture_seq: DecimalSequence;
  readonly tool_name: string;
  /** Present only for a registered command. Never synthesized. */
  readonly command_id: string | null;
  readonly observed_outcome: ObservedOutcome;
  readonly exit_code: number | null;
  readonly failure_signature: string | null;
  readonly affected_paths: readonly string[];
  readonly candidate_digest: string | null;
  readonly environment_digest: string | null;
  readonly requirement_revision: DecimalSequence;
  readonly cause_status: CauseStatus;
  readonly next_action: string;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/**
 * Why a submission was refused.
 *
 * Each carries the information a caller needs to recover rather than merely
 * being told "no".
 */
export type CheckpointRejection =
  /** The submitted revision is behind the current one. */
  | { readonly kind: 'stale_revision'; readonly currentRevision: DecimalSequence; readonly submittedRevision: DecimalSequence }
  /** Same operation id, different payload. Nothing was mutated. */
  | { readonly kind: 'payload_conflict'; readonly operationId: string }
  /** The manifest failed schema or semantic validation. */
  | { readonly kind: 'invalid'; readonly field: string; readonly reason: string }
  /** Required Sources are missing, unauthorized or not yet admitted. */
  | { readonly kind: 'sources_unavailable'; readonly sourceIds: readonly string[] }
  /** Coverage would exceed what has actually been admitted. */
  | { readonly kind: 'coverage_beyond_frontier'; readonly sessionId: string; readonly claimed: DecimalSequence; readonly frontier: DecimalSequence }
  /** A fifth distinct session stream was offered. */
  | { readonly kind: 'stream_limit'; readonly limit: number }
  /** A critical gap or overflow makes safe advancement impossible. */
  | { readonly kind: 'blocked_by_gap'; readonly fromSeq: DecimalSequence; readonly toSeq: DecimalSequence }
  /** No run binding exists, so a run-bound manifest cannot be published yet. */
  | { readonly kind: 'awaiting_run_binding'; readonly taskId: string }
  /** The caller is not authorized for this project. */
  | { readonly kind: 'unauthorized'; readonly reason: string };

/** How durable the outcome is. */
export type PublicationState =
  /** Bytes, pointer, graph Event and receipt are all committed. */
  | 'committed'
  /** Bytes are durable; the pointer or graph admission is still outstanding. */
  | 'pending'
  /** The outcome is unknown and must be reconciled against its receipt. */
  | 'ambiguous'
  /** Nothing was written. */
  | 'rejected';

export interface CheckpointResult {
  readonly state: PublicationState;
  /** The operation id, stable across retries of the same intent. */
  readonly operationId: string;
  /** The published checkpoint revision, when one was reached. */
  readonly revision?: DecimalSequence;
  /** The immutable manifest artifact, when bytes were published. */
  readonly manifestArtifactId?: string;
  /** Digest of the exact manifest bytes. */
  readonly manifestDigest?: string;
  /** The Source that now backs `TaskState.CHECKPOINT_SOURCE`. */
  readonly checkpointSourceId?: string;
  readonly rejection?: CheckpointRejection;
  /**
   * The previous valid checkpoint, retained when a replacement is pending or
   * ambiguous. A failed republication must not leave the task with no state.
   */
  readonly previous?: CheckpointPointerView | null;
}

/** What the task currently points at. */
export interface CheckpointPointerView {
  readonly checkpointRevision: DecimalSequence;
  readonly manifestArtifactId: string;
  readonly manifestDigest: string;
  readonly checkpointSourceId: string;
  readonly producerSessionId: string;
  readonly coveredCaptureSeq: DecimalSequence;
  readonly publishedAt: string;
}

/* ------------------------------------------------------------------ */
/* Submission and patch inputs                                         */
/* ------------------------------------------------------------------ */

/**
 * The only fields a model may propose.
 *
 * Everything else is supplied by the service from trusted authority. There is
 * deliberately no way to pass `run_id`, `task_id`, coverage or Source
 * identities in model arguments.
 */
export interface ProposedState {
  readonly progress?: string;
  readonly next_action?: string;
}

/** A bounded plan patch. Merged, never a whole-snapshot replacement. */
export interface PlanPatch {
  readonly step_id: string;
  readonly text?: string;
  readonly status?: PlanStepStatus;
}

export interface CheckpointSubmission {
  /**
   * Stable per logical intent. A retry reuses it and replays; a changed payload
   * under the same id conflicts.
   *
   * Must be a UUID: it is the `operation_id` column of the durable checkpoint
   * and graph receipt, so a free-form id would not bind to a row at all.
   */
  readonly operationId: string;
  readonly proposed?: ProposedState;
  /** Present when this is a patch rather than a first submission. */
  readonly baseRevision?: DecimalSequence;
  /** Plan steps to add or update. Unrelated steps are preserved. */
  readonly planPatch?: readonly PlanPatch[];
  readonly pendingQuestionId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Inspection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Whether the current tactical state can be relied on.
 *
 * `stale` means the accepted requirements moved past what is checkpointed.
 * `blocked` means something about coverage makes advancement unsafe.
 * `capture_pending` means new evidence exists that no checkpoint covers yet.
 */
export type CheckpointFreshness = 'ready' | 'stale' | 'blocked' | 'capture_pending';

export interface TacticalStateView {
  readonly freshness: CheckpointFreshness;
  readonly pointer: CheckpointPointerView | null;
  readonly manifest: CheckpointManifest | null;
  /** Coverage not yet covered by the current checkpoint. */
  readonly pendingCoverage: readonly CoveredPosition[];
  /** A durable gap that blocks safe advancement, when one exists. */
  readonly blockingGap?: { readonly sessionId: string; readonly fromSeq: DecimalSequence; readonly toSeq: DecimalSequence } | null;
  /** Episodes derived from durable observations since the checkpoint. */
  readonly episodes: readonly MemoryEpisode[];
  /** True when no valid run binding exists yet. */
  readonly awaitingRunBinding: boolean;
  readonly criticalCapturePending?: boolean;
  readonly unavailableSourceIds?: readonly string[];
  readonly recoveryOverflow?: boolean;
  readonly pendingReplacement?: {readonly revision:string;readonly publicationState:string;readonly operationId:string}|null;
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

/**
 * The lifecycle boundaries that exist today.
 *
 * Registered-command and safe-handoff outcomes are deliberately included so the
 * seam is testable, but their producers are M06 and M07. They are verified with
 * synthetic observations, not advertised as shipped.
 */
export type CheckpointTrigger =
  | 'task_admission'
  | 'accepted_requirement_change'
  | 'mutating_tool_terminal'
  | 'registered_command_terminal'
  | 'diagnostic_nonzero'
  | 'unknown_effect'
  | 'explicit_update'
  | 'planned_handoff'
  | 'uncheckpointed_fallback';

/**
 * How an observation is classified for trigger purposes.
 *
 * Defined once, here, so the policy cannot drift between the capture path and
 * the checkpoint path.
 */
export function isMeaningfulObservation(observation: {
  readonly outcome: ObservedOutcome;
  readonly mutating: boolean;
  readonly registeredCommand: boolean;
  readonly episodeSourceIds: readonly string[];
}): boolean {
  if (observation.outcome === 'unknown') return true;
  if (observation.outcome === 'failed' || observation.outcome === 'denied') return true;
  if (observation.mutating) return true;
  if (observation.registeredCommand) return true;
  // A read/search that produced no episode adds no state worth checkpointing.
  // Its capture record is still durable; only the trigger is suppressed.
  return observation.episodeSourceIds.length > 0;
}

/* ------------------------------------------------------------------ */
/* Service port                                                        */
/* ------------------------------------------------------------------ */

/**
 * One authority for HTTP and model callers.
 *
 * Callers supply only intent. The service resolves task, run, session,
 * revision, coverage and Source identities server-side; a caller that could
 * pass them would be asserting facts rather than stating a request.
 */
export interface CheckpointService {
  submit(
    reader: CheckpointScope,
    submission: CheckpointSubmission,
  ): Promise<CheckpointResult>;

  /** Current pointer, manifest, freshness and derived episodes. */
  inspect(reader: CheckpointScope): Promise<TacticalStateView>;

  /** Refresh the ordered tail without inference. limit is page size; total scan is capped at 1,000 events. */
  recover(reader: CheckpointScope, options?: { readonly limit?: number }): Promise<CheckpointRecoveryReport>;

  /**
   * Evaluates a trigger. Returns `null` when policy decides no checkpoint is due,
   * so a caller can record that the trigger was seen without publishing.
   */
  evaluateTrigger(
    reader: CheckpointScope,
    trigger: CheckpointTrigger,
  ): Promise<CheckpointResult | null>;
}

/** Who is asking, resolved from the authenticated session. */
export interface CheckpointScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly taskId: string;
  /** Present once a run exists. */
  readonly runId?: string | null;
  readonly agentSessionId?: string | null;
}

export interface CheckpointRecoveryReport {
  readonly state: 'recovered' | 'blocked' | 'no_change';
  readonly scanned: number;
  readonly episodes: number;
  readonly published: CheckpointResult | null;
  readonly rejection?: CheckpointRejection;
  /** A gap or overflow that prevents safe advancement. */
  readonly blockedBy?: { readonly fromSeq: DecimalSequence; readonly toSeq: DecimalSequence; readonly reason: string };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The chosen paths, fixed once. B should build a client against exactly these
 * rather than a parallel DTO.
 */
export const CHECKPOINT_ROUTES = {
  /** Submit a checkpoint or apply a patch. */
  submit: '/projects/:projectId/tasks/:taskId/checkpoints',
  /** Current pointer, manifest, freshness and derived episodes. */
  state: '/projects/:projectId/tasks/:taskId/checkpoints/current',
  /** Bounded recovery scan of the post-checkpoint tail. */
  recover: '/projects/:projectId/tasks/:taskId/checkpoints/recover',
} as const;

/** Bound on one recovery scan, from `recovery_tail_scan_batch_events`. */
export const RECOVERY_BATCH_EVENTS = 100;

/** Total scan ceiling, from `recovery_tail_scan_max_events`. */
export const RECOVERY_MAX_EVENTS = 1000;

/** `checkpoint_due_after_meaningful_uncheckpointed_events`. */
export const CHECKPOINT_FALLBACK_AFTER_EVENTS = 5;