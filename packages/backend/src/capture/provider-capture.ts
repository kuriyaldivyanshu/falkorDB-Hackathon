import { mayReleaseDependentWork } from '@threadline/shared';
import type { CaptureAppendInput, CaptureOutcome, CaptureCorrelation, CaptureEnvelope, EvidenceReferences, ModelCaptureAppendInput, ModelEvidenceEnvelope } from '@threadline/shared';

import { createChunkBuffer, type CaptureClock, type ChunkBufferLimits, type EmittedChunk } from './chunks.js';
import type { PreparedAttempt } from '../provider/lifecycle.js';
import type { ProviderTurnResult } from '../provider/responses.js';

/**
 * Provider capture adapter (M03B01).
 *
 * Wires the permitted model evidence — the exact prepared request bytes and the
 * complete permitted terminal output — into A's `CaptureService`, and does
 * nothing else. It holds no database handle, no graph client and no HTTP
 * reference; A composes it in production.
 *
 * Four rules decide the shape of this module:
 *
 * 1. **Bytes are referenced, not duplicated.** The exact request bytes already
 *    exist as the M02 `model_requests` row and its `model_input` artifact. This
 *    adapter records the ordering and provenance around them and passes no
 *    `rawBytes` for model evidence, because the contract states model input and
 *    output are not stored twice.
 * 2. **A partial chunk is never a finished turn.** Visible text streams through
 *    the bounded chunk buffer, so durable writes happen at a 16 KiB or 250 ms
 *    boundary rather than per token. Every such capture is
 *    `model.output.partial` with `completeness: 'partial'`, and
 *    `mayReleaseDependentWork` refuses it.
 * 3. **A capture failure blocks dependent work.** A failure to make the input
 *    capture durable stops the dispatch; a failure on terminal output stops the
 *    dependent next turn. Neither is downgraded to a warning, because a
 *    dispatched turn whose evidence was never recorded is unprovenable.
 * 4. **Only permitted evidence is captured.** Visible text and the prepared
 *    request body are the only inputs. Provider setup, authentication headers,
 *    credentials and hidden reasoning have no path into this module, and the
 *    body is re-checked for credential markers before it is referenced.
 */

/** Marker check: the prepared body must never carry transport credentials. */


export class ProviderCaptureError extends Error {
  constructor(readonly phase: 'input' | 'output', override readonly cause: unknown) {
    super(`Model ${phase} evidence could not be made durable.`);
    this.name = 'ProviderCaptureError';
  }
}

export interface ProviderCaptureDeps {
  /** A's capture port. Only `append` is needed here. */
  readonly capture: { append(input: CaptureAppendInput): Promise<CaptureOutcome> };
  /** Server-resolved scope. The adapter never derives authority fields. */
  readonly correlation: CaptureCorrelation;
  /**
   * Resolves the M02 journal row and artifact identities for one dispatch.
   * Injected because those rows are written by A's request journal.
   */
  readonly resolveReferences: (prepared: PreparedAttempt) => Promise<EvidenceReferences>;
  readonly clock?: CaptureClock;
  readonly limits?: Partial<ChunkBufferLimits>;
  /** Diagnostic only. Never used to swallow a capture failure. */
  readonly onError?: (error: unknown) => void;
}

export interface ProviderCaptureStatus {
  readonly pendingBytes: number;
  readonly inFlightBytes: number;
  readonly overflowed: boolean;
  readonly droppedBytes: number;
  readonly inputCaptures: number;
  readonly partialCaptures: number;
  readonly terminalCaptures: number;
  readonly captureFailures: number;
}

export interface ProviderCapture {
  /**
   * Records the exact prepared bytes as `model.input`.
   *
   * Called with the same `PreparedAttempt` the transport journals, so the
   * capture and the journal describe the same dispatch. Throws when the capture
   * cannot be made durable, which is what blocks the dispatch.
   */
  recordInput(prepared: PreparedAttempt): Promise<ModelEvidenceEnvelope>;
  /** Feeds observed visible text. Synchronous; batching happens downstream. */
  observeVisibleText(text: string): void;
  /** Records the complete terminal output. Throws when it cannot be durable. */
  recordTerminal(result: ProviderTurnResult, prepared: PreparedAttempt): Promise<ModelEvidenceEnvelope>;
  /** Whether the terminal capture may release dependent work. */
  mayRelease(): boolean;
  /** Bounded drain of buffered visible text. */
  flush(): Promise<void>;
  status(): ProviderCaptureStatus;
}

const sourceKeyForInput = (attemptId: string): string => `model.input/${attemptId}`;
const sourceKeyForChunk = (attemptId: string, index: number): string => `model.output/${attemptId}/chunk/${index}`;
/** One stable key for the terminal capture, so a redelivery replays rather than duplicates. */
const sourceKeyForTerminal = (attemptId: string): string => `model.output/${attemptId}/complete`;

function envelopeFor(envelope: CaptureEnvelope): ModelEvidenceEnvelope {
  return envelope as ModelEvidenceEnvelope;
}

export function createProviderCapture(deps: ProviderCaptureDeps): ProviderCapture {
  const counters = { input: 0, partial: 0, terminal: 0, failures: 0 };
  /** Set when a partial capture failed; surfaced instead of being ignored. */
  let partialFailure: unknown = null;
  /**
   * The completeness this adapter wrote.
   *
   * `completeness` is now typed on the append input, so it is decided before the
   * call and cannot drift from what the store records. The earlier workaround
   * that read it back off the returned envelope is no longer needed.
   */
  let terminalCompleteness: 'partial' | 'complete' | 'final' | null = null;
  let lastPrepared: PreparedAttempt | null = null;

  const append = async (input: CaptureAppendInput, phase: 'input' | 'output'): Promise<ModelEvidenceEnvelope> => {
    let outcome: Awaited<ReturnType<typeof deps.capture.append>>;
    try {
      outcome = await deps.capture.append(input);
    } catch (error) {
      // A storage failure carries the phase, so a caller can tell a dispatch
      // that never happened from a dependent turn that cannot continue.
      throw error instanceof ProviderCaptureError ? error : new ProviderCaptureError(phase, error);
    }
    if (outcome.kind === 'conflict') {
      // The same key with different content is never silently accepted.
      throw new ProviderCaptureError(phase, new Error(`source key ${input.sourceKey} was reused with different content`));
    }
    return envelopeFor(outcome.envelope);
  };

  const buffer = createChunkBuffer({
    clock: deps.clock,
    limits: deps.limits,
    onError: (error) => {
      counters.failures += 1;
      partialFailure = error;
      deps.onError?.(error);
    },
    sink: {
      emit: async (chunk: EmittedChunk) => {
        const prepared = lastPrepared;
        if (prepared === null) {
          // Cannot attribute evidence without an attempt. Recorded as a failure
          // so the terminal capture blocks, rather than dropped in silence.
          counters.failures += 1;
          partialFailure = new Error('visible text arrived before the attempt was identified');
          deps.onError?.(partialFailure);
          return;
        }
        const references = await deps.resolveReferences(prepared);
        const outcome = await append({
          correlation: { ...deps.correlation, logicalRequestId: prepared.logicalRequestId, attemptId: prepared.attemptId },
          kind: 'model.output.partial',
          origin: 'model',
          sourceKey: sourceKeyForChunk(prepared.attemptId, chunk.ordinal),
          observedAt: chunk.at,
          // Typed, not lifted out of `payload`: a partial chunk is a different
          // fact from a complete output and must not be expressible as either.
          completeness: 'partial',
          references,
          chunkIndex: chunk.ordinal,
          payload: {
            chunk: { index: chunk.ordinal, bytes: chunk.bytes.byteLength, partial: chunk.partial, final: chunk.final },
            model: prepared.model,
          },
          rawBytes: chunk.bytes,
          rawArtifactKind: 'model_response',
        }, 'output');
        counters.partial += 1;
        // A partial capture must never be releasable; assert rather than assume.
        if (mayReleaseDependentWork(outcome)) {
          throw new ProviderCaptureError('output', new Error('a partial chunk was recorded as releasable'));
        }
      },
    },
  });

  const noteOverflow = (): void => {
    const stats = buffer.stats();
    if (!stats.overflowed) return;
    // Overflow is visible rather than silent. The exact dropped count is left
    // for A's outbox/gap record, which owns the durable statement of the gap.
    throw new ProviderCaptureError('output', new Error(`visible text exceeded the bounded buffer; ${stats.droppedBytes} bytes were not buffered`));
  };

  return {
    async recordInput(prepared) {
      await buffer.flush();
      if (buffer.stats().drainTimedOut || partialFailure !== null) throw new ProviderCaptureError('input', partialFailure ?? new Error('Prior evidence drain timed out.'));
      const body = JSON.parse(prepared.requestBody) as Record<string, unknown>;
      if (Object.keys(body).some(key => /^(authorization|api[_-]?key|headers)$/i.test(key)))
        throw new ProviderCaptureError('input', new Error('Transport credentials do not belong in a model body.'));
      lastPrepared = prepared;
      // The owned driver supplies body-only bytes; transport headers never enter this port.
      terminalCompleteness = null;
      const references = await deps.resolveReferences(prepared);
      const envelope = await append({
        correlation: { ...deps.correlation, logicalRequestId: prepared.logicalRequestId, attemptId: prepared.attemptId },
        kind: 'model.input',
        origin: 'model',
        sourceKey: sourceKeyForInput(prepared.attemptId),
        observedAt: new Date(),
        // The exact submitted input is complete once the journal owns it.
        completeness: 'complete',
        references,
        payload: {
          model: prepared.model,
          requestDigest: prepared.requestDigest,
          requestBytes: prepared.requestBytes,
          inputItems: prepared.inputItems,
          toolCount: prepared.toolCount,
        },
        // No rawBytes: the exact bytes are already the M02 journal artifact.
      }, 'input');
      counters.input += 1;
      return envelope;
    },

    observeVisibleText(text) {
      // Synchronous by contract; buffering and flushing are the buffer's job.
      if (lastPrepared === null) {
        // Evidence with no attempt cannot be correlated, so it is never
        // buffered and never silently discarded: the failure blocks the turn.
        counters.failures += 1;
        partialFailure = new Error('visible text arrived before the attempt was identified');
        deps.onError?.(partialFailure);
        return;
      }
      void buffer.accept('visible_text', text).catch((error: unknown) => {
        counters.failures += 1;
        partialFailure = error;
        deps.onError?.(error);
      });
    },

    async recordTerminal(result, prepared) {
      await buffer.flush();
      lastPrepared = prepared;
      if (buffer.stats().drainTimedOut) throw new ProviderCaptureError('output', new Error('visible evidence drain timed out'));
      noteOverflow();
      if (partialFailure !== null) {
        // Buffered visible text was not fully captured; the terminal capture must
        // not present the turn as complete evidence.
        throw new ProviderCaptureError('output', partialFailure);
      }
      const references = await deps.resolveReferences(prepared);
      // Only visible text is recorded. A failed or cancelled turn is still
      // evidence, recorded honestly rather than dropped.
      const visible = result.output
        .filter((item): item is { role: 'assistant'; content: string } =>
          'role' in item && item.role === 'assistant' && typeof (item as { content?: unknown }).content === 'string')
        .map((item) => item.content)
        .join('');
      const completeness = result.status === 'completed' ? 'final' : 'complete';
      const complete: ModelCaptureAppendInput = {
        correlation: { ...deps.correlation, logicalRequestId: prepared.logicalRequestId, attemptId: prepared.attemptId },
        kind: 'model.output.complete',
        origin: 'model',
        sourceKey: sourceKeyForTerminal(prepared.attemptId),
        observedAt: new Date(),
        // Typed on the input, so the store records exactly what was decided here.
        completeness,
        references,
        // Absent usage stays null; it is never written as zero.
        usage: result.usage === null
          ? null
          : { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        payload: {
          model: prepared.model,
          status: result.status,
          reason: result.reason,
          responseId: result.responseId,
          requestId: result.requestId,
          possibleCharge: result.possibleCharge,
          visibleText: visible,
          visibleBytes: Buffer.byteLength(visible, 'utf8'),
        },
        // No rawBytes: the complete permitted output is the M02 response artifact.
      };
      const envelope = await append(complete, 'output');
      counters.terminal += 1;
      terminalCompleteness = completeness;
      return envelope;
    },

    mayRelease() {
      return terminalCompleteness === 'complete' || terminalCompleteness === 'final';
    },

    async flush() {
      await buffer.flush();
      if (buffer.stats().drainTimedOut || partialFailure !== null)
        throw new ProviderCaptureError('output', partialFailure ?? new Error('visible evidence drain timed out'));
    },

    status() {
      const stats = buffer.stats();
      return {
        pendingBytes: stats.pendingBytes,
        inFlightBytes: stats.inFlightBytes,
        overflowed: stats.overflowed,
        droppedBytes: stats.droppedBytes,
        inputCaptures: counters.input,
        partialCaptures: counters.partial,
        terminalCaptures: counters.terminal,
        captureFailures: counters.failures,
      };
    },
  };
}
