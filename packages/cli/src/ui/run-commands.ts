import { EXIT_FAILURE, EXIT_OK, type LineSink } from '../one-shot.js';
import { describeCause } from '../transport/errors.js';
import type { RunClient } from '../transport/run-client.js';
import type { CliInvocation } from '../options.js';
import { formatCancelOutcome, formatRunInspect, formatRunStartOutcome } from './run-format.js';

/**
 * Run control commands.
 *
 * These request work the backend has already authorized. They never start
 * inference themselves, never infer an identity, and never report an outcome the
 * backend did not return.
 */

const REQUIRE_SESSION =
  'No local owner session is attached. Create one before run control; run:start and run:inspect require an authenticated client.';

/**
 * `run prepare` — builds a durable run input.
 *
 * The context window is required and never defaulted: the budget decides what
 * the model sees, so guessing it here would silently change the request.
 */
export async function runPrepareCommand(
  client: RunClient,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  if (invocation.projectId === null) { out('A --project <uuid> is required so the backend can resolve scope.'); return EXIT_FAILURE; }
  if (invocation.contextWindowTokens === null) {
    out('An explicit context window is required: /run prepare <tokens>.');
    out('  It is never assumed, because the budget decides what the model sees.');
    return EXIT_FAILURE;
  }
  try {
    const input = await client.prepareRun(invocation.projectId, invocation.contextWindowTokens,invocation.selectedProfileId??undefined);
    out(JSON.stringify(input, null, 2));
    return EXIT_OK;
  } catch (error) {
    out(`prepare failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

export async function runStartCommand(
  client: RunClient,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  if (!client.authenticated) {
    out(REQUIRE_SESSION);
    return EXIT_FAILURE;
  }
  const start = invocation.start;
  if (start === null) {
    out('No run identity was supplied.');
    return EXIT_FAILURE;
  }
  try {
    const outcome = await client.startRun(start);
    for (const line of formatRunStartOutcome(outcome)) out(line);
    // A rejection is a completed answer, so it exits non-zero to be scriptable.
    return outcome.kind === 'rejected' ? EXIT_FAILURE : EXIT_OK;
  } catch (error) {
    out(`run start failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

export async function runInspectCommand(
  client: RunClient,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  if (!client.authenticated) {
    out(REQUIRE_SESSION);
    return EXIT_FAILURE;
  }
  if (invocation.runId === null) {
    out('No run id was supplied.');
    return EXIT_FAILURE;
  }
  try {
    for (const line of formatRunInspect(await client.inspectRun(invocation.runId))) out(line);
    return EXIT_OK;
  } catch (error) {
    out(`run inspect failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

export async function runCancelCommand(
  client: RunClient,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  if (!client.authenticated) {
    out(REQUIRE_SESSION);
    return EXIT_FAILURE;
  }
  if (invocation.runId === null || invocation.cancelReason === null) {
    out('A run id and a reason are required to request cancellation.');
    return EXIT_FAILURE;
  }
  try {
    const outcome = await client.cancelRun(invocation.runId, invocation.cancelReason);
    for (const line of formatCancelOutcome(outcome)) out(line);
    return outcome.acknowledged ? EXIT_OK : EXIT_FAILURE;
  } catch (error) {
    out(`run cancel failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}