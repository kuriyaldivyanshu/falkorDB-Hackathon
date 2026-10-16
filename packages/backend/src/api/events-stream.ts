import type { ServerResponse } from 'node:http';

import type { ThreadlineEvent } from '@threadline/shared';
import type { EventPublisher, EventSubscription } from '../events/publisher.js';

/**
 * Server-sent-events transport for development status events.
 *
 * Deliberate limitations, all visible to the client:
 * - the stream starts empty, because the publisher keeps no replay buffer;
 * - a connection that stops reading is closed once it has accumulated more
 *   than `maxBacklogBytes` of undelivered bytes, instead of growing the
 *   process heap without limit;
 * - nothing on this stream is durable.
 */

export type EventStreamCloseReason = 'client-disconnected' | 'backlog-exceeded' | 'server-closing';

export interface EventStream {
  send(event: ThreadlineEvent): void;
  /** Idempotent. */
  close(reason: EventStreamCloseReason): void;
  readonly closed: boolean;
  readonly closeReason: EventStreamCloseReason | null;
}

export interface EventStreamManager {
  open(raw: ServerResponse, authorize?: (event: ThreadlineEvent) => Promise<boolean>): EventStream;
  /** Ends every open stream. Returns how many were still open. */
  closeAll(): number;
  readonly openCount: number;
}

export interface EventStreamManagerDeps {
  readonly publisher: EventPublisher;
  readonly maxBacklogBytes: number;
}

const PREAMBLE = ': threadline development events; process-local, no replay, no persistence\n\n';

export function createEventStreamManager(deps: EventStreamManagerDeps): EventStreamManager {
  const streams = new Set<SseStream>();

  return {
    open(raw: ServerResponse, authorize?: (event: ThreadlineEvent) => Promise<boolean>): EventStream {
      const stream = new SseStream(
        raw,
        {
          maxBacklogBytes: deps.maxBacklogBytes,
          subscribe: (deliver) => {
            let pending = Promise.resolve();
            let count = 0;
            return deps.publisher.subscribe((event) => {
              if (event.name !== 'run.activity') { deliver(event); return; }
              if (!authorize) return;
              // Bound pending authorization work as well as socket output.
              if (++count > 64) { stream.close('backlog-exceeded'); count--; return; }
              pending = pending.then(async () => {
                if (!stream.closed && await authorize(event)) deliver(event);
              }).catch(() => { stream.close('client-disconnected'); }).finally(() => { count--; });
            });
          },
        },
        (closed) => {
          streams.delete(closed);
        },
      );
      streams.add(stream);
      return stream;
    },

    closeAll(): number {
      const openStreams = [...streams];
      for (const stream of openStreams) {
        stream.close('server-closing');
      }
      return openStreams.length;
    },

    get openCount() {
      return streams.size;
    },
  };
}

interface SseStreamOptions {
  readonly maxBacklogBytes: number;
  readonly subscribe: (deliver: (event: ThreadlineEvent) => void) => EventSubscription;
}

class SseStream implements EventStream {
  private readonly raw: ServerResponse;
  private readonly options: SseStreamOptions;
  private readonly onClosed: (stream: SseStream) => void;
  private readonly subscription: EventSubscription;
  private isClosed = false;
  private reason: EventStreamCloseReason | null = null;
  private backlogBytes = 0;

  constructor(
    raw: ServerResponse,
    options: SseStreamOptions,
    onClosed: (stream: SseStream) => void,
  ) {
    this.raw = raw;
    this.options = options;
    this.onClosed = onClosed;

    // Reserve capacity before sending headers. A full publisher must leave
    // the response untouched so the route can return an ordinary 503.
    this.subscription = options.subscribe((event) => this.send(event));
    try {
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      raw.socket?.setNoDelay(true);
      raw.write(PREAMBLE);
      raw.on('drain', this.handleDrain);
      raw.once('close', this.handleRawClose);
    } catch (error) {
      this.subscription.close();
      raw.off('drain', this.handleDrain);
      raw.off('close', this.handleRawClose);
      throw error;
    }
  }

  send(event: ThreadlineEvent): void {
    if (this.isClosed) {
      return;
    }
    const frame = formatEvent(event);
    const size = Buffer.byteLength(frame);
    if (this.backlogBytes + size > this.options.maxBacklogBytes) {
      this.finish('backlog-exceeded');
      return;
    }
    const flushed = this.raw.write(frame);
    this.backlogBytes = flushed ? 0 : this.backlogBytes + size;
  }

  close(reason: EventStreamCloseReason): void {
    this.finish(reason);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get closeReason(): EventStreamCloseReason | null {
    return this.reason;
  }

  private readonly handleDrain = (): void => {
    this.backlogBytes = 0;
  };

  private readonly handleRawClose = (): void => {
    this.finish('client-disconnected');
  };

  private finish(reason: EventStreamCloseReason): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.reason = reason;
    this.backlogBytes = 0;
    this.raw.off('drain', this.handleDrain);
    this.raw.off('close', this.handleRawClose);
    this.subscription.close();
    this.onClosed(this);
    if (reason === 'backlog-exceeded') {
      this.raw.destroy();
      return;
    }
    this.raw.end();
  }
}

function formatEvent(event: ThreadlineEvent): string {
  return `id: ${event.sequence}\nevent: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`;
}