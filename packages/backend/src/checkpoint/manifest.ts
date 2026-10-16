import {
  CHECKPOINT_SCHEMA_VERSION,
  MAX_PLAN_STEPS,
  ThreadlineError,
  parseSequence,
  isDecimalSequence,
  type CheckpointManifest,
  type CoveredPosition,
  type DecimalSequence,
  type PlanPatch,
  type TacticalPlanStep,
} from '@threadline/shared';

/**
 * Deterministic manifest construction and patch merge.
 *
 * Two rules decide everything here.
 *
 * **The service owns every fact that is not a proposal.** Task, run, session,
 * epoch, revisions, candidate/environment identity, coverage and Source
 * identities are read from trusted rows. A proposal supplies progress, a next
 * action and a plan patch — nothing else. There is no code path by which a
 * proposal can set coverage or clear an unresolved effect.
 *
 * **A patch is a patch.** An accepted plan patch merges into the existing plan
 * and leaves unrelated steps, progress, evidence and unresolved effects exactly
 * as they were. An accepted progress patch leaves the plan alone. Neither
 * replaces a whole snapshot, because a snapshot replacement is how a model
 * silently erases recorded work.
 */

export interface AuthorityFacts {
  readonly taskId: string;
  readonly runId: string;
  readonly graphEpoch: string;
  /** The accepted requirement revision. Moves only on accepted human change. */
  readonly requirementRevision: DecimalSequence;
  /** The task revision the authority currently reports. */
  readonly taskRevision: DecimalSequence;
  readonly fence: number;
  readonly candidateDigest: string | null;
  readonly environmentDigest: string | null;
  readonly producerSessionId: string;
  readonly producerKind: 'service' | 'agent_proposal';
  readonly visibility: CheckpointManifest['visibility'];
}

export interface UnresolvedEffectFacts {
  readonly execution_id: string;
  readonly status: 'running' | 'unknown';
  readonly source_id: string;
}

export interface BuildManifestInput {
  readonly authority: AuthorityFacts;
  /** Coverage, already checked against the frontier by the caller. */
  readonly coverage: readonly CoveredPosition[];
  /** Service-owned. A proposal can never contribute here. */
  readonly unresolvedEffects: readonly UnresolvedEffectFacts[];
  readonly episodeSourceIds: readonly string[];
  readonly pendingQuestionId: string | null;
  /** Carried from the previous manifest unless a proposal replaces it. */
  readonly progress: string;
  readonly nextAction: string;
  readonly plan: readonly TacticalPlanStep[];
  /** The checkpoint's own revision, distinct from the requirement revision. */
  readonly checkpointRevision: DecimalSequence;
}

export function buildManifest(input: BuildManifestInput): CheckpointManifest {
  return {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    task_id: input.authority.taskId,
    run_id: input.authority.runId,
    graph_epoch: input.authority.graphEpoch,
    // The checkpoint revision and the requirement revision are different facts
    // and are filled from different sources on purpose.
    task_revision: input.authority.taskRevision,
    requirement_revision: input.authority.requirementRevision,
    candidate_digest: input.authority.candidateDigest,
    environment_digest: input.authority.environmentDigest,
    covered_capture_positions: input.coverage,
    progress: input.progress,
    next_action: input.nextAction,
    tactical_plan: input.plan,
    unresolved_effects: input.unresolvedEffects,
    pending_question_id: input.pendingQuestionId,
    episode_source_ids: input.episodeSourceIds,
    visibility: input.authority.visibility,
    producer_kind: input.authority.producerKind,
  };
}

/* ------------------------------------------------------------------ */
/* Patch merge                                                         */
/* ------------------------------------------------------------------ */

export type PatchRejection =
  | { readonly kind: 'unknown_step'; readonly stepId: string }
  | { readonly kind: 'too_many_steps'; readonly count: number }
  | { readonly kind: 'no_change' }
  | { readonly kind: 'duplicate_step'; readonly stepId:string }
  | { readonly kind: 'illegal_transition'; readonly stepId: string; readonly from: string; readonly to: string };

export type PatchMerge =
  | { readonly ok: true; readonly plan: readonly TacticalPlanStep[]; readonly changed: boolean }
  | { readonly ok: false; readonly rejection: PatchRejection };

const transitions = {
  pending: ['pending', 'in_progress', 'completed'],
  in_progress: ['pending', 'in_progress', 'completed'],
  completed: ['completed'],
} as const satisfies Record<TacticalPlanStep['status'], readonly string[]>;

function mayTransition(from: TacticalPlanStep['status'], to: TacticalPlanStep['status']): boolean {
  return (transitions[from] as readonly string[]).includes(to);
}

/**
 * Merges a plan patch into the current plan.
 *
 * Steps are addressed by `step_id` and never by position, so two patches that
 * touch different steps are non-conflicting regardless of ordering. A patch may
 * add a step, change its text, or move its status; it may not delete one, because
 * deleting a step would discard the record that it existed.
 */
export function mergePlanPatch(
  current: readonly TacticalPlanStep[],
  patch: readonly PlanPatch[],
): PatchMerge {
  if (patch.length === 0) {
    return { ok: false, rejection: { kind: 'no_change' } };
  }

  const seen=new Set<string>();
  for(const entry of patch){if(seen.has(entry.step_id))return {ok:false,rejection:{kind:'duplicate_step',stepId:entry.step_id}};seen.add(entry.step_id);}
  const byId = new Map(current.map((step) => [step.step_id, step]));
  let changed = false;

  for (const entry of patch) {
    const before = byId.get(entry.step_id);
    if (before === undefined) {
      // Adding a step is allowed; the eight-step bound still applies.
      if (current.length + 1 > MAX_PLAN_STEPS) {
        return { ok: false, rejection: { kind: 'too_many_steps', count: current.length + 1 } };
      }
      byId.set(entry.step_id, {
        step_id: entry.step_id,
        text: entry.text ?? '',
        status: entry.status ?? 'pending',
      });
      changed = true;
      continue;
    }
    if (entry.status !== undefined && entry.status !== before.status) {
      if (!mayTransition(before.status, entry.status)) {
        return {
          ok: false,
          rejection: {
            kind: 'illegal_transition',
            stepId: entry.step_id,
            from: before.status,
            to: entry.status,
          },
        };
      }
    }
    const text = entry.text ?? before.text;
    const status = entry.status ?? before.status;
    if (text !== before.text || status !== before.status) {
      byId.set(entry.step_id, { step_id: entry.step_id, text, status });
      changed = true;
    }
  }

  const plan = [...byId.values()];
  if (plan.length > MAX_PLAN_STEPS) {
    return { ok: false, rejection: { kind: 'too_many_steps', count: plan.length } };
  }

  // At most one step in progress. If a patch would create a second, the merge is
  // refused rather than silently demoting one of them.
  const inProgress = plan.filter((step) => step.status === 'in_progress');
  if (inProgress.length > 1) {
    return {
      ok: false,
      rejection: { kind: 'too_many_steps', count: inProgress.length },
    };
  }

  return { ok: true, plan, changed };
}

/**
 * Derives coverage from stored frontiers.
 *
 * `graph_admitted_capture_seq` is the admitted position, which can lag capture.
 * Coverage reports the admitted position rather than the captured one so it can
 * never claim admission that has not happened.
 */
export function coverageFromFrontier(
  sessions: readonly { sessionId: string; captured: DecimalSequence; admitted: DecimalSequence }[],
): CoveredPosition[] {
  return sessions.map((entry) => ({
    session_id: entry.sessionId,
    capture_seq: entry.admitted,
    graph_admitted_capture_seq: entry.admitted,
  }));
}

/** Parses a caller-supplied expected revision, refusing unsafe numbers. */
export function safeExpectedRevision(value: unknown): DecimalSequence | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (isDecimalSequence(value)) {
    return value;
  }
  throw new ThreadlineError('invalid_request', 'A revision must be a non-negative integer or decimal string.', {
    reason: 'revision_shape',
  });
}

export { parseSequence };
