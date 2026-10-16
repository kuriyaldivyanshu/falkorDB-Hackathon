import type { CaptureEnvelope, CaptureOutcome, ReplayCursor, ReplayPage, SourceMetadata } from '@threadline/shared';

/**
 * Honest presentation state for durable capture and replay.
 *
 * This module reduces backend facts into what the terminal may *say*. It holds
 * no transport and no task truth, and it is deliberately unable to invent an
 * accepted state: every rendering below is reachable only from a fact the
 * backend reported.
 *
 * The distinctions it exists to preserve:
 *
 * - **Capture admission is not tool success.** A tool call can succeed while its
 *   evidence is still pending, and a capture can fail admission while the tool
 *   result is perfectly durable. They are separate lines in the interface.
 * - **A digest is not availability.** Bytes are available only when something
 *   proved the bytes are readable, so a row plus a digest stays `pending`.
 * - **Partial is not complete.** A partial chunk is a boundary, never proof that
 *   a result finished, and never a tool argument.
 * - **Pending is not available.** Graph admission may legitimately remain
 *   pending behind an outbox, and presenting that as sourced memory is exactly
 *   the failure this milestone exists to prevent.
 * - **A replay gap is shown, not smoothed.** Ordered evidence that is missing
 *   produces explicit refresh guidance rather than a silent skip.
 */

/* ------------------------------------------------------------------ */
/* Capture evidence                                                    */
/* ------------------------------------------------------------------ */

export type CaptureState =
  | { readonly kind: 'pending'; readonly reason: CapturePendingReason; readonly detail: string }
  | { readonly kind: 'available'; readonly byteSize: number; readonly contentDigest: string }
  | { readonly kind: 'partial'; readonly returnedBytes: number; readonly totalBytes: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly code: string; readonly detail: string };

export type CapturePendingReason = 'not_admitted' | 'outbox_pending' | 'outbox_leased' | 'bytes_unproven';

/** What the backend reported about delivery of one capture's graph evidence. */
export type OutboxState = 'delivered' | 'pending' | 'leased' | 'quarantined' | 'unknown';

export interface CaptureFact {
  /** Present once the backend has allocated a durable position. */
  readonly envelope?: CaptureEnvelope | null;
  readonly outbox: OutboxState;
  /** Absent when no artifact backs this evidence, e.g. a bare intent row. */
  readonly artifact?: SourceMetadata | null;
  /** Truncation reported for the most recent range read. */
  readonly partialRead?: { readonly returnedBytes: number; readonly totalBytes: number } | null;
  readonly failure?: { readonly code: string; readonly message: string } | null;
}

const pending = (reason: CapturePendingReason, detail: string): CaptureState => ({ kind: 'pending', reason, detail });

/**
 * Folds one piece of evidence into its honest state.
 *
 * Order matters. A failure is reported first because a failed admission is a
 * fact about this attempt; availability is only ever concluded from proven
 * bytes; and everything unproven stays `pending` rather than being upgraded.
 */
export function reduceCapture(fact: CaptureFact): CaptureState {
  if (fact.failure) return { kind: 'failed', code: fact.failure.code, detail: fact.failure.message };

  if (!fact.envelope) {
    return pending(
      fact.outbox === 'unknown' ? 'not_admitted' : 'not_admitted',
      'the backend has not allocated a durable position for this evidence yet',
    );
  }

  if (fact.outbox === 'quarantined') {
    return pending('outbox_pending', 'graph delivery is quarantined after repeated failures');
  }
  if (fact.outbox === 'leased' || fact.outbox === 'pending') {
    return pending(
      fact.outbox === 'leased' ? 'outbox_leased' : 'outbox_pending',
      'SQL capture is durable; graph admission is still pending',
    );
  }

  // A truncated read is a boundary, so it outranks a full-availability claim.
  if (fact.partialRead) {
    return {
      kind: 'partial',
      returnedBytes: fact.partialRead.returnedBytes,
      totalBytes: fact.partialRead.totalBytes,
    };
  }

  if (!fact.artifact) {
    return pending('bytes_unproven', 'no readable bytes have been proven for this evidence');
  }
  const { identity, available } = fact.artifact;
  if (!available || identity.status !== 'available') {
    return fact.artifact.state === 'pending'
      ? pending('outbox_leased', 'the artifact is not published yet')
      : { kind: 'missing' };
  }
  if (!Number.isSafeInteger(identity.byteSize) || identity.byteSize < 0) {
    return { kind: 'failed', code: 'corrupt_metadata', detail: 'the backend reported an unusable artifact size' };
  }
  return { kind: 'available', byteSize: identity.byteSize, contentDigest: identity.contentDigest };
}

/** A replayed append is not a new position; the interface must not imply one. */
export function describeCaptureOutcome(outcome: CaptureOutcome): string {
  switch (outcome.kind) {
    case 'appended':
      return `capture ${outcome.envelope.captureSeq} appended`;
    case 'replayed':
      return `capture ${outcome.envelope.captureSeq} replayed (same identity, no new position)`;
    case 'conflict':
      return `capture refused: source key ${outcome.sourceKey} was reused with different content`;
  }
}

export function formatCaptureState(label: string, state: CaptureState): string[] {
  switch (state.kind) {
    case 'available':
      return [`${label}: available bytes=${state.byteSize} digest=${state.contentDigest.slice(0, 12)}`];
    case 'partial':
      return [
        `${label}: partial ${state.returnedBytes}/${state.totalBytes} bytes read`,
        `  a partial read is a boundary, not a completed result`,
      ];
    case 'pending':
      return [`${label}: pending (${state.reason})`, `  ${state.detail}`];
    case 'missing':
      return [`${label}: missing`, '  the bytes are not available; a digest is not recovered content'];
    case 'failed':
      return [`${label}: capture failed (${state.code})`, `  ${state.detail}`];
  }
}

/* ------------------------------------------------------------------ */
/* Source inspection                                                   */
/* ------------------------------------------------------------------ */

/** Mirrors the backend's typed inspection states for one Source. */
export function formatSourceInspection(sourceId: string, state: string, detail: string): string[] {
  switch (state) {
    case 'available':
      return [`source ${sourceId}: available ${detail}`];
    case 'pending':
      return [`source ${sourceId}: pending`, `  ${detail}`, '  pending is not available memory'];
    case 'missing':
      return [`source ${sourceId}: missing`, '  absent or unauthorized; the two are not distinguishable'];
    case 'denied':
      return [`source ${sourceId}: denied`, `  ${detail}`];
    case 'corrupt':
      return [`source ${sourceId}: corrupt`, `  ${detail}`, '  the stored bytes did not match the declared range'];
    default:
      return [`source ${sourceId}: ${state}`, `  ${detail}`];
  }
}

/** Renders an exact range read without implying the Source was fully read. */
export function formatSourceRange(sourceId: string, range: { offset: number; returnedBytes: number; totalBytes: number; truncated: boolean }): string[] {
  return [
    `source ${sourceId}: bytes ${range.offset}..${range.offset + range.returnedBytes} of ${range.totalBytes}`,
    `  truncated=${range.truncated}${range.truncated ? ' (more bytes exist beyond this range)' : ' (read to the end)'}`,
  ];
}

/* ------------------------------------------------------------------ */
/* Replay and reconnect                                                */
/* ------------------------------------------------------------------ */

export type ReplayStatus =
  | { readonly kind: 'admission_pending'; readonly pending:number; readonly quarantined:number; readonly cursor:ReplayCursor }
  | { readonly kind: 'live'; readonly cursor: ReplayCursor }
  | { readonly kind: 'catching_up'; readonly cursor: ReplayCursor; readonly hasMore: boolean }
  | { readonly kind: 'gap'; readonly fromSeq: number; readonly toSeq: number }
  | { readonly kind: 'stale_epoch'; readonly expected: string; readonly received: string }
  | { readonly kind: 'invalid_cursor'; readonly detail: string }
  | { readonly kind: 'unauthorized'; readonly detail: string }
  | { readonly kind: 'history_missing'; readonly detail: string };

/**
 * Reduces one catch-up page into what the interface may report.
 *
 * A gap outranks a page that also arrived, because silently delivering the
 * frames around missing ordered evidence is exactly the silent skip this
 * milestone forbids.
 */
export function reduceReplayPage(page: ReplayPage): ReplayStatus {
  if (page.gap && page.gap.toSeq >= page.gap.fromSeq) {
    return { kind: 'gap', fromSeq: page.gap.fromSeq, toSeq: page.gap.toSeq };
  }
  if (page.admission && (page.admission.pending > 0 || page.admission.quarantined > 0))
    return {kind:'admission_pending',pending:page.admission.pending,quarantined:page.admission.quarantined,cursor:page.cursor};
  if (page.hasMore) return { kind: 'catching_up', cursor: page.cursor, hasMore: true };
  return { kind: 'live', cursor: page.cursor };
}

/** Cursor rejection is distinguished so refresh guidance can be specific. */
export function reduceCursorError(error: unknown): ReplayStatus {
  const detail = error instanceof Error ? error.message : String(error);
  if (/unauthor|forbidden|permission|credential|token|revoked/i.test(detail)) {
    return { kind: 'unauthorized', detail };
  }
  if (/epoch/i.test(detail)) {
    const [expected = 'unknown', received = 'unknown'] = detail.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/g) ?? [];
    return { kind: 'stale_epoch', expected, received };
  }
  if (/not found|no history|retain|pruned|purged|expired/i.test(detail)) {
    return { kind: 'history_missing', detail };
  }
  return { kind: 'invalid_cursor', detail };
}

export function formatReplayStatus(status: ReplayStatus): string[] {
  switch (status.kind) {
    case 'admission_pending': return [`replay: graph admission pending=${status.pending} quarantined=${status.quarantined} afterSeq=${status.cursor.afterSeq}`, '  captured SQL evidence has not all reached the durable projection'];
    case 'live':
      return [`replay: live from epoch=${status.cursor.graphEpoch} afterSeq=${status.cursor.afterSeq}`];
    case 'catching_up':
      return [
        `replay: catching up, afterSeq=${status.cursor.afterSeq} hasMore=${status.hasMore}`,
        '  catch-up has not reached live delivery yet',
      ];
    case 'gap':
      return [
        `REPLAY GAP: ordered evidence ${status.fromSeq}..${status.toSeq} is missing`,
        '  frames around the gap were not delivered as if they were contiguous.',
        '  refresh from the last known-good cursor to recover the handoff.',
      ];
    case 'stale_epoch':
      return [
        `replay: stale epoch (expected=${status.expected} received=${status.received})`,
        '  refresh from a cursor in the current epoch; the old one cannot be resumed.',
      ];
    case 'invalid_cursor':
      return ['replay: invalid cursor', `  ${status.detail}`, '  refresh to obtain a current cursor.'];
    case 'unauthorized':
      return [
        'replay: delivery refused',
        `  ${status.detail}`,
        '  reconnecting does not resume private delivery; re-authenticate first.',
      ];
    case 'history_missing':
      return ['replay: history is no longer retained', `  ${status.detail}`, '  refresh to continue from live delivery.'];
  }
}
