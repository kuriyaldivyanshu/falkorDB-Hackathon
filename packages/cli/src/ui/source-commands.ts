import { ThreadlineError } from '@threadline/shared';

import { EXIT_FAILURE, EXIT_OK, type LineSink } from '../one-shot.js';
import { describeCause } from '../transport/errors.js';
import type { CliInvocation } from '../options.js';
import {
  inspectSourceView,
  readSourceRange,
  replayPage,
  type SourceClientDeps,
} from '../transport/source-client.js';
import {
  formatReplayStatus,
  formatSourceRange,
  reduceCursorError,
  reduceReplayPage,
} from './capture-state.js';

/**
 * Source inspection and replay commands.
 *
 * These report what the backend answered and nothing more. In particular a
 * Source that is absent, a Source the caller may not see, and a backend that
 * cannot answer are three different outputs, because collapsing them would let
 * the terminal claim "nothing is there" when the truth is "you may not know".
 *
 * No command here retries, resumes or infers. A gap produces refresh guidance;
 * nothing in this module decides that evidence exists.
 */

const REQUIRE_PROJECT = 'A --project <uuid> is required so the backend can resolve scope.';

function guard(invocation: CliInvocation): { projectId: string } | string {
  if (invocation.projectId === null) return REQUIRE_PROJECT;
  return { projectId: invocation.projectId };
}

function reportFailure(error: unknown, out: LineSink): number {
  if (error instanceof ThreadlineError && error.code === 'service_unavailable') {
    // Never dressed up as an empty result.
    out(`unavailable: ${error.message}`);
    out('  No Source or history state is being reported. This is not an empty result.');
    return EXIT_FAILURE;
  }
  out(`failed: ${describeCause(error)}`);
  return EXIT_FAILURE;
}

export async function sourceInspectCommand(
  client: SourceClientDeps,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const scope = guard(invocation);
  if (typeof scope === 'string') { out(scope); return EXIT_FAILURE; }
  if (invocation.sourceId === null) { out('A source id is required.'); return EXIT_FAILURE; }
  try {
    const view = await inspectSourceView(client, scope.projectId, invocation.sourceId);
    out(`source ${view.sourceId}: ${view.state}`);
    if (view.state === 'available') {
      out(`  bytes=${view.byteSize} digest=${view.contentDigest?.slice(0, 12)} kind=${view.artifactKind} visibility=${view.visibility}`);
    } else {
      out(`  ${view.reason ?? 'the backend gave no further detail'}`);
      if (view.state === 'pending') out('  pending is not available memory.');
      if (view.state === 'missing') out('  absent and unauthorized are not distinguishable from outside.');
    }
    return EXIT_OK;
  } catch (error) {
    return reportFailure(error, out);
  }
}

export async function sourceReadCommand(
  client: SourceClientDeps,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const scope = guard(invocation);
  if (typeof scope === 'string') { out(scope); return EXIT_FAILURE; }
  if (invocation.sourceId === null) { out('A source id is required.'); return EXIT_FAILURE; }
  const offset = invocation.sourceOffset ?? 0;
  const maxBytes = invocation.sourceMaxBytes ?? 32_768;
  try {
    const range = await readSourceRange(client, scope.projectId, invocation.sourceId, offset, maxBytes);
    for (const line of formatSourceRange(range.sourceId, range)) out(line);
    // The budget is charged for the encoded size, which is the larger number.
    out(`  digest=${range.contentDigest.slice(0, 12)} encodedBytes=${range.encodedBytes}`);
    if (Buffer.byteLength(range.base64, 'utf8') !== Math.ceil(range.returnedBytes / 3) * 4) {
      out('  the returned range did not match its declared size; treating it as unavailable.');
      return EXIT_FAILURE;
    }
    out(`  base64=${range.base64}`);
    return EXIT_OK;
  } catch (error) {
    return reportFailure(error, out);
  }
}

export async function historyReplayCommand(
  client: SourceClientDeps,
  invocation: CliInvocation,
  out: LineSink,
): Promise<number> {
  const scope = guard(invocation);
  if (typeof scope === 'string') { out(scope); return EXIT_FAILURE; }
  if (invocation.replayEpoch === null || invocation.replayAfterSeq === null) {
    out('A durable cursor is required: --epoch <uuid> --after-seq <n>.');
    return EXIT_FAILURE;
  }
  try {
    const page = await replayPage(client, scope.projectId, {
      graphEpoch: invocation.replayEpoch,
      afterSeq: invocation.replayAfterSeq,
      limit: invocation.replayLimit ?? undefined,
    });
    const status = reduceReplayPage(page);
    for (const line of formatReplayStatus(status)) out(line);
    for (const frame of page.frames) {
      out(`  seq=${frame.seq} kind=${frame.kind} aggregate=${frame.aggregateId} sourceId=${String(frame.payload['sourceId'] ?? '')} committed=${frame.committedAt}`);
    }
    if (status.kind === 'gap') {
      out('  Run history:replay again with the last known-good cursor after a refresh.');
      return EXIT_FAILURE;
    }
    return EXIT_OK;
  } catch (error) {
    for (const line of formatReplayStatus(reduceCursorError(error))) out(line);
    return EXIT_FAILURE;
  }
}
