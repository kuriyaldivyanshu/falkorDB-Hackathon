import type {
  CheckpointFreshness,
  CheckpointRejection,
  CheckpointResult,
  PublicationState,
  TacticalPlanStep,
  TacticalStateView,
} from '@threadline/shared';

/**
 * Rendering for checkpoint and tactical state.
 *
 * Every line is derived from an Agent A view. This module holds no state and
 * makes no decision: it cannot advance a revision, mark a task complete, or
 * smooth over a conflict. In particular a plan whose steps are all completed
 * is rendered as a completed checklist, never as a finished task, because that
 * is exactly the inference the milestone exists to prevent.
 */

/** Ink colour per step status, used by the panel; the formatter stays plain text. */
export const PLAN_STATUS_COLOR: Record<TacticalPlanStep['status'], string | undefined> = {
  pending: undefined,
  in_progress: 'yellow',
  completed: 'green',
};

const STATUS_MARK: Record<TacticalPlanStep['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

export const FRESHNESS_LINE: Record<CheckpointFreshness, string> = {
  ready: 'checkpoint state is current',
  stale: 'checkpoint is STALE: accepted requirements moved past it',
  blocked: 'checkpoint advancement is BLOCKED by a durable gap',
  capture_pending: 'new evidence exists that no checkpoint covers yet',
};

/** Renders the current plan with stable step ids and statuses. */
export function formatPlan(steps: readonly TacticalPlanStep[]): string[] {
  if (steps.length === 0) return ['  no plan steps recorded'];
  return steps.map((step) => `  ${STATUS_MARK[step.status]} ${step.step_id}  ${step.text}`);
}

/** An all-completed plan is still only a checklist. */
export function planIsComplete(steps: readonly TacticalPlanStep[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === 'completed');
}

export function formatFreshness(freshness: CheckpointFreshness): string[] {
  return [FRESHNESS_LINE[freshness]];
}

/**
 * Renders the whole current state.
 *
 * `awaitingRunBinding` is shown explicitly: until a run exists there is no
 * durable run-bound manifest, and saying "ready" then would be a claim the
 * backend has not made.
 */
export function formatTacticalState(view: TacticalStateView): string[] {
  const lines: string[] = ['Tactical state'];
  lines.push(...formatFreshness(view.freshness));
  if (view.awaitingRunBinding) lines.push('  awaiting a run binding; no checkpoint can be published yet');

  if (view.pointer === null) {
    lines.push('  no checkpoint has been accepted yet');
  } else {
    lines.push(`  checkpoint revision ${view.pointer.checkpointRevision}`);
    lines.push(`  checkpoint Source   ${view.pointer.checkpointSourceId}`);
    if (view.pointer.manifestArtifactId) lines.push(`  manifest artifact   ${view.pointer.manifestArtifactId}`);
  }

  if (view.pendingCoverage.length > 0) {
    lines.push('  pending coverage (not covered by the current checkpoint):');
    for (const entry of view.pendingCoverage) {
      lines.push(`    session ${entry.session_id} capture ${entry.capture_seq} (admitted ${entry.graph_admitted_capture_seq})`);
    }
  }

  if (view.blockingGap !== null && view.blockingGap !== undefined) {
    lines.push(`  BLOCKING GAP in session ${view.blockingGap.sessionId}: ${view.blockingGap.fromSeq}..${view.blockingGap.toSeq}`);
    lines.push('  safe advancement is refused until this gap is reconciled.');
  }

  const plan = view.manifest?.tactical_plan ?? [];
  lines.push('Plan');
  lines.push(...formatPlan(plan));
  if (planIsComplete(plan)) {
    lines.push('  every step is completed; this is a checklist, not verified task completion.');
  }

  const unresolved = view.manifest?.unresolved_effects ?? [];
  if (unresolved.length > 0) {
    lines.push(`Unresolved effects (${unresolved.length})`);
    for (const effect of unresolved) lines.push(`  ${effect.execution_id} ${effect.status}`);
  }

  lines.push(`Episodes derived: ${view.episodes.length}`);
  return lines;
}

const REJECTION_LINE: Record<CheckpointRejection['kind'], string> = {
  stale_revision: 'stale revision: the submitted base revision is behind the current one',
  payload_conflict: 'the same operation id was reused with a different payload; nothing was mutated',
  invalid: 'the manifest failed validation',
  sources_unavailable: 'required Sources are missing, unauthorized or not yet admitted',
  coverage_beyond_frontier: 'coverage would exceed what has actually been admitted',
  stream_limit: 'too many distinct session streams were offered',
  blocked_by_gap: 'a durable gap makes safe advancement impossible',
  awaiting_run_binding: 'no run binding exists yet, so a run-bound manifest cannot be published',
  unauthorized: 'the caller is not authorized for this project',
};

/**
 * Renders a submission result.
 *
 * The durability state is never upgraded: `pending` and `ambiguous` are shown as
 * such, and the previous accepted checkpoint is named when one is retained, so a
 * refused write never looks like a lost task.
 */
export function formatCheckpointResult(result: CheckpointResult): string[] {
  const lines: string[] = [`operation ${result.operationId}`];
  const state: PublicationState = result.state;

  if (state === 'rejected') {
    const rejection = result.rejection;
    lines.push('  rejected — nothing was written');
    if (rejection !== undefined) {
      lines.push(`  ${REJECTION_LINE[rejection.kind] ?? rejection.kind}`);
      if (rejection.kind === 'stale_revision') {
        lines.push(`  you submitted ${rejection.submittedRevision}; current is ${rejection.currentRevision}`);
        lines.push('  re-read the state and resubmit against the current revision.');
      }
      if (rejection.kind === 'payload_conflict') {
        lines.push(`  operation id ${rejection.operationId} is bound to different content.`);
        lines.push('  retrying the same id is refused; inspect the current state before continuing.');
      }
    }
    if (result.previous) lines.push(`  the previous accepted checkpoint ${result.previous.checkpointRevision} is retained`);
    return lines;
  }

  lines.push(`  ${state === 'committed' ? 'committed' : state === 'pending' ? 'pending: bytes are durable, publication is outstanding' : 'ambiguous: reconcile against the receipt before continuing'}`);
  if (result.revision) lines.push(`  revision ${result.revision}`);
  if (result.checkpointSourceId) lines.push(`  checkpoint Source ${result.checkpointSourceId}`);
  if (!result.checkpointSourceId) lines.push('  no checkpoint Source is available yet; publication is not complete');
  if (result.previous) lines.push(`  the previous accepted checkpoint ${result.previous.checkpointRevision} is retained until this one is durable`);
  lines.push('  this does not complete or verify the task');
  return lines;
}

export const TACTICAL_PANEL_HINT =
  'Use /tactical for the current checkpoint and plan, and /refresh for freshness and coverage.';