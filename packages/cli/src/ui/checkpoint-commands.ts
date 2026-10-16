import { unlink } from 'node:fs/promises';
import { EXIT_FAILURE, EXIT_OK, type LineSink } from '../one-shot.js';
import { describeCause } from '../transport/errors.js';
import { ThreadlineError } from '@threadline/shared';

import {
  CheckpointPayloadConflictError,
  CheckpointRecordError,
  resolveCheckpointOperationId,
  type CheckpointSubmissionBody,
} from '../admission/checkpoint-record.js';
import { checkpointRoutes, type TacticalHttp } from '../transport/checkpoint-http.js';
import type { CliInvocation } from '../options.js';
import { formatCheckpointResult, formatTacticalState } from './tactical-format.js';

/**
 * Checkpoint and plan commands.
 *
 * These render what the backend answered. Two things they deliberately do not
 * do: mint a replacement request record when one already exists, and present a
 * pending or ambiguous submission as accepted.
 *
 * The durable operation identity comes from the request record, so a retry after
 * a crash or a restart resubmits under the same id and the backend replays the
 * original outcome.
 */

const REQUIRE_TARGET =
  'A --project <uuid> and --task <uuid> are required so the backend can resolve scope.';

function requireTarget(invocation: CliInvocation): { projectId: string; taskId: string } | string {
  if (invocation.projectId === null) return 'A --project <uuid> is required.';
  if (invocation.checkpointTaskId === null) return REQUIRE_TARGET;
  return { projectId: invocation.projectId, taskId: invocation.checkpointTaskId };
}

/** `tactical:inspect` — current pointer, manifest, freshness and coverage. */
export async function checkpointInspectCommand(
  http: TacticalHttp,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const target = requireTarget(invocation);
  if (typeof target === 'string') { out(target); return EXIT_FAILURE; }
  try {
    const view = await http.readState(checkpointRoutes(target.projectId, target.taskId));
    for (const line of formatTacticalState(view)) out(line);
    return EXIT_OK;
  } catch (error) {
    return reportUnavailable(error, out, 'checkpoint inspection');
  }
}

/**
 * `tactical:checkpoint` — record progress and the next action.
 *
 * An existing record for a different submission is a conflict, not a licence to
 * write a second one.
 */
export async function checkpointWriteCommand(
  http: TacticalHttp,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const target = requireTarget(invocation);
  if (typeof target === 'string') { out(target); return EXIT_FAILURE; }
  if (invocation.checkpointProgress === null && invocation.checkpointNextAction === null) {
    out('Provide --progress, --next-action, or both.');
    return EXIT_FAILURE;
  }

  const body: CheckpointSubmissionBody = {
    projectId: target.projectId,
    taskId: target.taskId,
    ...(invocation.checkpointRunId === null ? {} : { runId: invocation.checkpointRunId }),
    ...(invocation.checkpointProgress === null ? {} : { progress: invocation.checkpointProgress }),
    ...(invocation.checkpointNextAction === null ? {} : { nextAction: invocation.checkpointNextAction }),
    ...(invocation.checkpointBaseRevision === null ? {} : { baseRevision: invocation.checkpointBaseRevision }),
  };

  let record: Awaited<ReturnType<typeof resolveCheckpointOperationId>>;
  try {
    record = await resolveCheckpointOperationId(invocation.requestRecordPath, body);
  } catch (error) {
    if (error instanceof CheckpointPayloadConflictError) {
      out(error.message);
      return EXIT_FAILURE;
    }
    out(`checkpoint request record failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }

  try {
    const result = await http.submit(checkpointRoutes(target.projectId, target.taskId), {
      operationId: record.operationId,
      ...(invocation.checkpointRunId === null ? {} : { runId: invocation.checkpointRunId }),
      proposed: {
        ...(invocation.checkpointProgress === null ? {} : { progress: invocation.checkpointProgress }),
        ...(invocation.checkpointNextAction === null ? {} : { next_action: invocation.checkpointNextAction }),
      },
      ...(invocation.checkpointBaseRevision === null ? {} : { baseRevision: invocation.checkpointBaseRevision }),
    });
    if (result.state === 'committed' || (result.state === 'rejected' && result.rejection?.kind !== 'payload_conflict')) {
      try { await unlink(invocation.requestRecordPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const line of formatCheckpointResult(result)) out(line);
    // A record is only retired once the submission reached a terminal answer.
    if (result.state === 'rejected' && result.rejection?.kind === 'payload_conflict') {
      out('  the record still holds this operation id; resolve it before resubmitting different content.');
    }
    return result.state === 'committed' ? EXIT_OK : EXIT_FAILURE;
  } catch (error) {
    return reportUnavailable(error, out, 'checkpoint submission');
  }
}

/** `tactical:plan` — patch plan steps by stable id. */
export async function planUpdateCommand(
  http: TacticalHttp,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const target = requireTarget(invocation);
  if (typeof target === 'string') { out(target); return EXIT_FAILURE; }
  const steps = parseSteps(invocation.checkpointSteps ?? []);
  if (steps.length === 0) {
    out('Provide at least one --step <stepId>[:<status>][=<text>] entry.');
    return EXIT_FAILURE;
  }

  const body: CheckpointSubmissionBody = {
    projectId: target.projectId,
    taskId: target.taskId,
    ...(invocation.checkpointRunId === null ? {} : { runId: invocation.checkpointRunId }),
    steps,
    ...(invocation.checkpointBaseRevision === null ? {} : { baseRevision: invocation.checkpointBaseRevision }),
  };

  let record: Awaited<ReturnType<typeof resolveCheckpointOperationId>>;
  try {
    record = await resolveCheckpointOperationId(invocation.requestRecordPath, body);
  } catch (error) {
    if (error instanceof CheckpointPayloadConflictError) { out(error.message); return EXIT_FAILURE; }
    out(`plan request record failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }

  try {
    const result = await http.submit(checkpointRoutes(target.projectId, target.taskId), {
      operationId: record.operationId,
      ...(invocation.checkpointRunId === null ? {} : { runId: invocation.checkpointRunId }),
      planPatch: steps.map((step) => ({
        step_id: step.stepId,
        ...(step.text === undefined ? {} : { text: step.text }),
        ...(step.status === undefined ? {} : { status: step.status }),
      })),
      ...(invocation.checkpointBaseRevision === null ? {} : { baseRevision: invocation.checkpointBaseRevision }),
    });
    if (result.state === 'committed' || (result.state === 'rejected' && result.rejection?.kind !== 'payload_conflict')) {
      try { await unlink(invocation.requestRecordPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const line of formatCheckpointResult(result)) out(line);
    return result.state === 'committed' ? EXIT_OK : EXIT_FAILURE;
  } catch (error) {
    return reportUnavailable(error, out, 'plan update');
  }
}

/**
 * Parses `stepId[:status][=text]`.
 *
 * The step id is required and stable; status and text are optional so a patch
 * can move one field without rewriting another.
 */
export function parseSteps(raw: readonly string[]): { stepId: string; status?: string; text?: string }[] {
  const STATUSES = ['pending', 'in_progress', 'completed'];
  const parsed: { stepId: string; status?: string; text?: string }[] = [];
  for (const entry of raw) {
    const equals = entry.indexOf('=');
    const head = equals === -1 ? entry : entry.slice(0, equals);
    const text = equals === -1 ? undefined : entry.slice(equals + 1);
    const colon = head.indexOf(':');
    const stepId = colon === -1 ? head : head.slice(0, colon);
    const status = colon === -1 ? undefined : head.slice(colon + 1);
    if (stepId.length === 0 || stepId.length > 128) return [];
    if (status !== undefined && !STATUSES.includes(status)) return [];
    if (text !== undefined && text.length > 300) return [];
    parsed.push({ stepId, ...(status === undefined ? {} : { status }), ...(text === undefined ? {} : { text }) });
  }
  return parsed;
}

function reportUnavailable(error: unknown, out: LineSink, what: string): number {
  if (error instanceof ThreadlineError && (error.code === 'service_unavailable' || error.code === 'storage_unavailable')) {
    out(`unavailable: ${error.message}`);
    out('  No checkpoint state is being reported. This is not an empty result.');
    return EXIT_FAILURE;
  }
  if (error instanceof ThreadlineError && error.code === 'invalid_request') {
    out(`refused: ${error.message}`);
    return EXIT_FAILURE;
  }
  if (error instanceof CheckpointRecordError) {
    out(`request record: ${error.message}`);
    return EXIT_FAILURE;
  }
  out(`${what} failed: ${describeCause(error)}`);
  return EXIT_FAILURE;
}