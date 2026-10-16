/**
 * Bounded chunk plumbing for M03.
 *
 * This module assembles incremental visible evidence into bounded chunks. It is
 * deliberately *not* a durable position allocator: the session capture sequence
 * is allocated by the server through A's `CaptureService`, so the ordinals below
 * are local emission ordinals only and are never presented as `captureSeq`.
 *
 * It creates no executable command or shell tool and performs no persistence,
 * transport, database or model work. A caller supplies the sink.
 *
 * Byte semantics are exact and stated rather than implied:
 *
 * - The buffer counts **bytes**, never characters. A chunk boundary may split a
 *   multi-byte UTF-8 sequence. This matches `SourceRange` in the shared capture
 *   contract, which explicitly allows a range to split a character and returns
 *   base64 for that reason. A consumer must concatenate chunks before decoding;
 *   `reassemble` does exactly that.
 * - A chunk is never larger than `maxChunkBytes`, including when a single
 *   incoming write is larger than the cap.
 * - A timer flush emits whatever is pending and is marked `partial`, so a
 *   truncated emission is always distinguishable from a completed boundary.
 * - Overflow is *visible*. Bytes that do not fit are rejected and counted
 *   rather than dropped silently, so the adapter can record a gap. No claim of
 *   zero loss is made for bytes this module refused.
 */

export const CAPTURE_CHUNK_DEFAULTS = Object.freeze({
  /** `capture_policy.log_chunk_max_bytes` in the development profile. */
  maxChunkBytes: 16_384,
  /** `capture_policy.log_flush_interval_ms` in the development profile. */
  flushIntervalMs: 250,
  /**
   * Bounded total pending bytes. The profile does not name a pending-buffer
   * size, so this is the largest bounded stream M03 captures
   * (`tool_limits.command_stdout_stderr_max_bytes`) used as the default ceiling
   * and is overridable per stream.
   */
  maxPendingBytes: 1_048_576,
  /**
   * Upper bound on how long a flush or shutdown waits for the sink.
   *
   * A sink that has stalled must not turn a bounded shutdown into an unbounded
   * wait, so draining gives up after this and reports it rather than hanging.
   * Measured on the wall clock, not the injected scheduler, because the thing
   * being bounded is a real dependency misbehaving.
   */
  drainTimeoutMs: 5_000,
});

export type ChunkBufferErrorCode = 'closed' | 'limit_exceeded' | 'unusable_stream';

export class ChunkBufferError extends Error {
  constructor(readonly code: ChunkBufferErrorCode, message: string) {
    super(message);
    this.name = 'ChunkBufferError';
  }
}

export interface EmittedChunk {
  /** Logical stream this chunk belongs to, e.g. `stdout` or `visible_text`. */
  readonly stream: string;
  /**
   * Local emission ordinal, starting at 1 and increasing by 1 per stream.
   * This is not a durable position: the server allocates `captureSeq`.
   */
  readonly ordinal: number;
  readonly bytes: Buffer;
  /** True when emitted on a timer or shutdown rather than a full-chunk boundary. */
  readonly partial: boolean;
  /** True only for the final emission of a closed stream. */
  readonly final: boolean;
  readonly at: Date;
}

export interface AcceptResult {
  readonly accepted: number;
  /** Bytes refused because the bounded pending budget was exhausted. */
  readonly rejected: number;
  /** True when this accept refused at least one byte. */
  readonly overflowed: boolean;
}

export interface FlushResult {
  readonly chunks: readonly EmittedChunk[];
  readonly pendingBytes: number;
  readonly overflowed: boolean;
  /** Bytes refused so far on this stream since it was opened. */
  readonly droppedBytes: number;
  /** True when a sink overran the drain bound, leaving evidence unacknowledged. */
  readonly drainTimedOut?: boolean;
}

export interface StreamStatus {
  readonly stream: string;
  readonly pendingBytes: number;
  readonly nextOrdinal: number;
  readonly overflowed: boolean;
  readonly droppedBytes: number;
  readonly closed: boolean;
}

export interface ChunkSink {
  /** Receives chunks in ordinal order; slow or failing sinks are tolerated. */
  emit(chunk: EmittedChunk): Promise<void>;
}

export interface ChunkBufferLimits {
  readonly maxChunkBytes: number;
  readonly flushIntervalMs: number;
  readonly maxPendingBytes: number;
  readonly drainTimeoutMs: number;
}

/**
 * Deterministic clock/scheduler seam. Tests inject a manual clock so no test
 * sleeps on real time; production wires `systemClock`.
 */
export interface CaptureClock {
  now(): Date;
  setTimer(fn: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: CaptureClock = {
  now: () => new Date(),
  setTimer: (fn, delayMs) => {
    const handle = setTimeout(fn, delayMs);
    handle.unref?.();
    return handle;
  },
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** A clock whose timers only advance when the test says so. */
export function createManualClock(start = new Date(0)): CaptureClock & { advance(ms: number): Promise<void> } {
  let current = start.getTime();
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => new Date(current),
    setTimer(fn, delayMs) {
      const id = nextId++;
      timers.set(id, { at: current + Math.max(0, delayMs), fn });
      return id;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    async advance(ms: number) {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        const next = due[0];
        if (!next) break;
        timers.delete(next[0]);
        current = next[1].at;
        next[1].fn();
        await Promise.resolve();
      }
      current = target;
      await Promise.resolve();
    },
  };
}

interface StreamState {
  pending: Buffer[];
  pendingBytes: number;
  nextOrdinal: number;
  overflowed: boolean;
  droppedBytes: number;
  closed: boolean;
  timer: unknown;
}

export interface ChunkBuffer {
  accept(stream: string, bytes: Uint8Array | string): Promise<AcceptResult>;
  /** Emits every pending stream as partial chunks without closing them. */
  flush(): Promise<FlushResult>;
  /** Closes a stream and emits its final partial chunk. */
  close(stream: string): Promise<FlushResult>;
  /** Closes every stream and bounds drain to what is already pending. */
  stop(): Promise<FlushResult[]>;
  status(stream: string): StreamStatus;
  listStreams(): readonly string[];
  /** Buffer-wide accounting; pending and in-flight share one bounded budget. */
  stats(): ChunkBufferStats;
}

export interface ChunkBufferStats {
  readonly pendingBytes: number;
  readonly inFlightBytes: number;
  readonly budgetBytes: number;
  readonly overflowed: boolean;
  readonly droppedBytes: number;
  /** True when a sink overran the drain bound, leaving evidence unacknowledged. */
  readonly drainTimedOut: boolean;
}

function usableStream(stream: string): boolean {
  return typeof stream === 'string' && stream.length > 0 && stream.length <= 128 && !/[\x00-\x1f\x7f]/.test(stream);
}

/**
 * Concatenates chunks in ordinal order. Multi-byte sequences are only complete
 * after concatenation, which is why callers must not decode a partial chunk.
 */
export function reassemble(chunks: readonly EmittedChunk[]): Buffer {
  return Buffer.concat(chunks.map((chunk) => chunk.bytes));
}

export function createChunkBuffer(options: {
  sink: ChunkSink;
  clock?: CaptureClock;
  limits?: Partial<ChunkBufferLimits>;
  onError?: (error: unknown) => void;
}): ChunkBuffer {
  const clock = options.clock ?? systemClock;
  const limits: ChunkBufferLimits = { ...CAPTURE_CHUNK_DEFAULTS, ...options.limits };
  if (limits.maxChunkBytes <= 0 || limits.flushIntervalMs < 0 || limits.drainTimeoutMs < 0 || limits.maxPendingBytes < limits.maxChunkBytes) {
    throw new ChunkBufferError('limit_exceeded', 'Chunk buffer limits are not usable.');
  }

  const streams = new Map<string, StreamState>();
  /**
   * Emission is serialized per buffer so ordinal order survives a slow or
   * out-of-order sink. Without this a fast stream could interleave chunks.
   */
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  /**
   * Bytes handed to the sink but not yet acknowledged. This is the queue a
   * slow persistence path actually accumulates, so it counts against the same
   * budget as the pending tail; otherwise a stalled sink would grow unbounded
   * behind an eager drain.
   */
  let inFlightBytes = 0;
  let drainTimedOut = false;

  const stateFor = (stream: string): StreamState => {
    let state = streams.get(stream);
    if (!state) {
      if (streams.size >= 16) throw new ChunkBufferError('limit_exceeded','Too many capture streams.');
      state = { pending: [], pendingBytes: 0, nextOrdinal: 1, overflowed: false, droppedBytes: 0, closed: false, timer: undefined };
      streams.set(stream, state);
    }
    return state;
  };

  const emit = (chunks: readonly EmittedChunk[]): void => {
    if (chunks.length === 0) return;
    for (const chunk of chunks) inFlightBytes += chunk.bytes.length;
    chain = chain.then(async () => {
      for (const chunk of chunks) {
        try {
          await options.sink.emit(chunk);
        } catch (error) {
          options.onError?.(error);
        } finally {
          inFlightBytes -= chunk.bytes.length;
        }
      }
    });
  };

  /**
   * Splits pending bytes into bounded chunks.
   *
   * A chunk is `partial` exactly when it was cut short by the end of the
   * available data rather than by the byte cap, which makes the flag a fact
   * about the boundary instead of a guess about why the drain ran. `final`
   * marks the last emission of a closed stream.
   */
  const drain = (stream: string, state: StreamState, final: boolean, fullOnly = false): EmittedChunk[] => {
    const chunks: EmittedChunk[] = [];
    // In `fullOnly` mode the sub-cap tail stays pending for the flush timer, so
    // an eager drain never spends the tail and pendingBytes tracks real assembly.
    while (state.pendingBytes > (fullOnly ? limits.maxChunkBytes - 1 : 0)) {
      const available = Math.min(limits.maxChunkBytes, state.pendingBytes);
      if (fullOnly && available < limits.maxChunkBytes) break;
      const take = Buffer.allocUnsafe(available);
      let copied = 0;
      while (copied < available) {
        const head = state.pending[0];
        if (!head) {
          // pendingBytes and the queue are updated together; disagreeing means
          // a defect, and emitting a zero-filled chunk would be corrupt evidence.
          throw new ChunkBufferError('limit_exceeded', 'Pending byte accounting is inconsistent.');
        }
        const wanted = available - copied;
        if (head.length <= wanted) {
          head.copy(take, copied);
          copied += head.length;
          state.pending.shift();
        } else {
          head.copy(take, copied, 0, wanted);
          state.pending[0] = head.subarray(wanted);
          copied += wanted;
        }
      }
      state.pendingBytes -= available;
      chunks.push({
        stream,
        ordinal: state.nextOrdinal++,
        bytes: take,
        partial: available < limits.maxChunkBytes,
        final,
        at: clock.now(),
      });
    }
    return chunks;
  };

  /**
   * Waits for the sink chain, giving up after the bound.
   *
   * Resolving on timeout is deliberate: the evidence still pending is
   * unacknowledged, and `drainTimedOut` says so. Silently waiting forever would
   * turn a stalled dependency into a hung process.
   */
  const drainBounded = async (): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<'timeout'>((resolve) => {
      // Deliberately not unref'd: this timer is the only thing that will settle
      // a flush against a stalled sink, so it must keep the loop alive.
      timer = setTimeout(() => resolve('timeout'), limits.drainTimeoutMs);
    });
    try {
      const outcome = await Promise.race([chain.then(() => 'settled' as const), bound]);
      return outcome === 'settled';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const disarm = (state: StreamState): void => {
    if (state.timer !== undefined) {
      clock.clearTimer(state.timer);
      state.timer = undefined;
    }
  };

  const arm = (stream: string, state: StreamState): void => {
    if (state.timer !== undefined || state.closed || stopped || state.pendingBytes === 0) return;
    state.timer = clock.setTimer(() => {
      state.timer = undefined;
      if (state.closed || stopped || state.pendingBytes === 0) return;
      emit(drain(stream, state, false));
    }, limits.flushIntervalMs);
  };

  const buffer: ChunkBuffer = {
    async accept(stream, bytes) {
      if (stopped) throw new ChunkBufferError('closed', 'Chunk buffer is stopped.');
      if (!usableStream(stream)) throw new ChunkBufferError('unusable_stream', 'Stream name is not usable.');
      const input = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const state = stateFor(stream);
      if (state.closed) throw new ChunkBufferError('closed', `Stream ${stream} is closed.`);
      if (input.length === 0) return { accepted: 0, rejected: 0, overflowed: false };

      const capacity = limits.maxPendingBytes - [...streams.values()].reduce((total,item)=>total+item.pendingBytes,0) - inFlightBytes;
      const accepted = Math.max(0, Math.min(input.length, capacity));
      const rejected = input.length - accepted;
      if (accepted > 0) state.pending.push(Buffer.from(input.subarray(0, accepted)));
      state.pendingBytes += accepted;

      // Emit full chunks eagerly so the timer only ever carries a partial tail.
      const full = drain(stream, state, false, true);
      emit(full);

      if (rejected > 0) {
        state.overflowed = true;
        state.droppedBytes += rejected;
      }
      arm(stream, state);
      return { accepted, rejected, overflowed: rejected > 0 };
    },

    async flush() {
      let overflowed = false;
      let droppedBytes = 0;
      let pendingBytes = 0;
      for (const [stream, state] of streams) {
        disarm(state);
        const chunks = state.pendingBytes > 0 ? drain(stream, state, false) : [];
        emit(chunks);
        pendingBytes += state.pendingBytes;
        overflowed ||= state.overflowed;
        droppedBytes += state.droppedBytes;
      }
      // Awaited so a caller may treat a resolved flush as "the sink has these".
      // A sink that overran the bound is reported rather than waited on forever.
      if (!(await drainBounded())) drainTimedOut = true;
      return { chunks: [], pendingBytes, overflowed, droppedBytes, drainTimedOut };
    },

    async close(stream) {
      if (!usableStream(stream)) throw new ChunkBufferError('unusable_stream', 'Stream name is not usable.');
      const state = stateFor(stream);
      if (state.closed) return { chunks: [], pendingBytes: 0, overflowed: state.overflowed, droppedBytes: state.droppedBytes };
      state.closed = true;
      disarm(state);
      const chunks = drain(stream, state, true);
      emit(chunks);
      return { chunks, pendingBytes: 0, overflowed: state.overflowed, droppedBytes: state.droppedBytes };
    },

    async stop() {
      if (stopped) return [];
      stopped = true;
      const results: FlushResult[] = [];
      for (const [stream, state] of streams) {
        state.closed = true;
        disarm(state);
        const chunks = state.pendingBytes > 0 ? drain(stream, state, true) : [];
        emit(chunks);
        results.push({ chunks, pendingBytes: 0, overflowed: state.overflowed, droppedBytes: state.droppedBytes });
      }
      // Bounded drain: the buffer never holds more than maxPendingBytes, and
      // the wait itself is bounded, so shutdown always terminates.
      if (!(await drainBounded())) drainTimedOut = true;
      return results;
    },

    status(stream) {
      const state = stateFor(stream);
      return {
        stream,
        pendingBytes: state.pendingBytes,
        nextOrdinal: state.nextOrdinal,
        overflowed: state.overflowed,
        droppedBytes: state.droppedBytes,
        closed: state.closed,
      };
    },

    listStreams() {
      return [...streams.keys()];
    },

    stats() {
      let pendingBytes = 0;
      let overflowed = false;
      let droppedBytes = 0;
      for (const state of streams.values()) {
        pendingBytes += state.pendingBytes;
        overflowed ||= state.overflowed;
        droppedBytes += state.droppedBytes;
      }
      return { pendingBytes, inFlightBytes, budgetBytes: limits.maxPendingBytes, overflowed, droppedBytes, drainTimedOut };
    },
  };

  return buffer;
}
