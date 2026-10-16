import type {
  CancelRunOutcome,
  RunInspectView,
  RunLaunchView,
  RunStartOutcome,
} from '@threadline/shared';

/**
 * Run rendering.
 *
 * Every line is derived from a backend answer. Acceptance, admission, replay and
 * rejection are four different states and are never collapsed into "started".
 * No formatter produces the word "completed" for anything except a state the
 * backend itself reported.
 */

export function formatRunLaunch(run: RunLaunchView): string[] {
  return [
    `run ${run.runId} state=${run.state} session=${run.sessionState} model=${run.model}`,
    `  session ${run.sessionId} task ${run.taskId} profile ${run.profileId} workspace ${run.workspaceId}`,
    `  claim ${run.claim.taskClaimState} fence=${run.claim.fence} revision=${run.claim.revision}` +
      ` requirement=${run.claim.requirementRevision} lease=${run.claim.leaseExpiresAt}` +
      ` owner=${run.claim.ownerSessionId ?? 'none'}`,
    `  budget attempts=${run.budget.attemptsUsed}/${run.budget.maxAttempts}` +
      ` tools=${run.budget.toolCallsUsed}/${run.budget.maxToolCalls}` +
      ` observed=${run.budget.observedTokens} reserved=${run.budget.reservedTokens}` +
      ` deadline=${run.budget.deadlineAt}`,
    `  epoch ${run.graphEpoch} correlation ${run.correlationId}`,
    run.budget.blockedOnReconciliation
      ? '  BLOCKED: an earlier attempt is unresolved; the run will not start another turn.'
      : '  no unresolved attempts reported',
  ];
}

export function formatRunStartOutcome(outcome: RunStartOutcome): string[] {
  switch (outcome.kind) {
    case 'admitted':
      return ['admitted:', ...formatRunLaunch(outcome.run)];
    case 'replayed':
      return [
        'replayed: an earlier request with this id already produced this run. No new run was created.',
        ...formatRunLaunch(outcome.run),
      ];
    case 'accepted':
      return [
        `accepted (not admitted): run ${outcome.runId} session ${outcome.sessionId}`,
        `  pending: ${outcome.pendingReason}`,
        '  This is an acknowledgement only. Inspect the run for the authoritative state.',
      ];
    case 'rejected':
      return [
        `rejected: ${outcome.code}`,
        `  reason: ${outcome.reason}`,
        `  correlation: ${outcome.correlationId}`,
      ];
  }
}

export function formatRunInspect(view: RunInspectView): string[] {
  const lines = [...formatRunLaunch(view.run), `  unresolved attempts: ${view.unresolvedAttempts}`];
  if (view.attempts.length === 0) {
    lines.push('  no provider attempt has been recorded.');
    return lines;
  }
  lines.push('  attempts (durable records):');
  for (const attempt of view.attempts) {
    lines.push(
      `    #${attempt.attemptNo} ${attempt.logicalRequestId}/${attempt.attemptId} state=${attempt.state}` +
        ` possibleCharge=${attempt.possibleCharge}` +
        ` providerRequest=${attempt.providerRequestId ?? 'none'}` +
        ` finished=${attempt.finishedAt ?? 'unfinished'}`,
    );
  }
  if (view.unresolvedAttempts > 0) {
    lines.push('  usage for an unresolved attempt is uncertain; its reservation is retained.');
  }
  return lines;
}

export function formatCancelOutcome(outcome: CancelRunOutcome): string[] {
  const lines = [
    `cancel ${outcome.acknowledged ? 'acknowledged' : 'NOT acknowledged'} for run ${outcome.runId}`,
    `  run state=${outcome.state} session=${outcome.sessionState}`,
    `  reason: ${outcome.reason}`,
  ];
  if (outcome.usageUncertain) {
    lines.push('  usage is uncertain: the provider may have accepted work before cancellation.');
  }
  if (outcome.acknowledged) {
    lines.push('  An acknowledgement is not proof that provider compute stopped.');
  }
  return lines;
}