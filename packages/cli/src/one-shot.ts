import type { ThreadlineEvent } from '@threadline/shared';

import type { BackendClient } from './transport/backend-client.js';
import { redactingSink } from './transport/auth.js';
import { describeCause } from './transport/errors.js';
import {
  formatDevelopmentEchoResult,
  formatErrorPayload,
  formatEvent,
  formatHealth,
} from './ui/format.js';
import { describeStoreState, formatStoreReadiness } from './ui/store-readiness.js';

/**
 * Scriptable, non-interactive entry points.
 *
 * These exist so the same round trip the interface performs can be observed
 * without a terminal, which is how the scaffold is verified. They read backend
 * answers and print them; they decide nothing.
 */

export type LineSink = (line: string) => void;

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;

/** How long an echo waits for its backend event before reporting no event. */
const EVENT_WAIT_MS = 5_000;
/** Events held while the command answer is still in flight. */
const MAX_BUFFERED_EVENTS = 64;

export async function runHealth(
  client: BackendClient,
  out: LineSink,
  showStoreReadiness = false,
  token: string | null = null,
): Promise<number> {
  try {
    const health = await client.health();
    out(formatHealth(health));
    if (showStoreReadiness) {
      const sink = redactingSink(out, [token]);
      for (const line of formatStoreReadiness(health)) {
        sink(line);
      }
      sink(`  store state: ${describeStoreState(health)}`);
    }
    // Readiness is reported, never reinterpreted: a report that is not ready is
    // a successful health read, not a failure.
    return EXIT_OK;
  } catch (error) {
    out(`health failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * Sends one `development.echo` and prints both the acknowledgement and the
 * matching backend event.
 *
 * The event stream is opened first: the backend keeps no replay buffer, so an
 * event published before this client subscribed is gone. Events arriving while
 * the command answer is still in flight are buffered and matched afterwards.
 */
export async function runEcho(client: BackendClient, text: string, out: LineSink): Promise<number> {
  let commandId: string | null = null;
  const collector = new EventCollector(
    (event) =>
      event.name === 'development.echo.accepted' &&
      commandId !== null &&
      event.payload.commandId === commandId,
  );

  const stream = client.openEventStream({
    onEvent: (event) => collector.push(event),
    onFrameError: (error) => out(`event stream frame ignored: ${error.message}`),
    onError: (error) => collector.fail(error),
    onEnd: (reason) => {
      if (reason !== 'closed-by-client') {
        collector.fail(new Error(`the event stream ended before the command event arrived (${reason})`));
      }
    },
  });

  try {
    if (!(await stream.ready)) {
      throw collector.streamFailure ?? new Error('The event stream did not become ready.');
    }
    const response = await client.sendCommand('development.echo', { text });
    if (!response.ok) {
      out(`rejected ${response.commandId ?? '(no id)'} ${formatErrorPayload(response.error)}`);
      return EXIT_FAILURE;
    }
    commandId = response.commandId;
    out(`command  ${response.commandId} ${formatDevelopmentEchoResult(response.result)}`);

    const event = await collector.waitFor(EVENT_WAIT_MS);
    out(`event    ${formatEvent(event)}`);
    return EXIT_OK;
  } catch (error) {
    out(`echo failed: ${describeCause(error)}`);
    // The stream is opened first, so it can fail independently of the command.
    // Reporting only the command failure would hide that.
    const streamFailure = collector.streamFailure;
    if (streamFailure !== null && streamFailure.message !== describeCause(error)) {
      out(`event stream failed: ${streamFailure.message}`);
    }
    return EXIT_FAILURE;
  } finally {
    stream.close();
  }
}

type WaitResult = { readonly ok: true; readonly event: ThreadlineEvent } | { readonly ok: false; readonly error: Error };

/**
 * Buffers events until one matches.
 *
 * The backend publishes the event around the same moment it answers the
 * command, so the event can arrive before this client has learned the command
 * id it needs to match on. Buffering a bounded window is what makes the
 * correlation reliable without asking the backend for replay it does not have.
 */
class EventCollector {
  private readonly buffered: ThreadlineEvent[] = [];
  private readonly predicate: (event: ThreadlineEvent) => boolean;
  private failure: Error | null = null;
  private waiter: ((result: WaitResult) => void) | null = null;

  settled = false;

  /** The stream-level failure, once one has happened. */
  get streamFailure(): Error | null {
    return this.failure;
  }

  constructor(predicate: (event: ThreadlineEvent) => boolean) {
    this.predicate = predicate;
  }

  push(event: ThreadlineEvent): void {
    if (this.settled) {
      return;
    }
    this.buffered.push(event);
    if (this.buffered.length > MAX_BUFFERED_EVENTS) {
      this.buffered.shift();
    }
    const waiter = this.waiter;
    if (waiter !== null && this.predicate(event)) {
      this.waiter = null;
      waiter({ ok: true, event });
    }
  }

  fail(error: Error): void {
    if (this.settled) {
      return;
    }
    if (this.failure === null) {
      this.failure = error;
    }
    const waiter = this.waiter;
    if (waiter !== null) {
      this.waiter = null;
      waiter({ ok: false, error: this.failure });
    }
  }

  async waitFor(timeoutMs: number): Promise<ThreadlineEvent> {
    const buffered = this.buffered.find((candidate) => this.predicate(candidate));
    if (buffered !== undefined) {
      this.settled = true;
      return buffered;
    }
    if (this.failure !== null) {
      this.settled = true;
      throw this.failure;
    }

    return new Promise<ThreadlineEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.settled = true;
        reject(new Error(`no matching backend event within ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();

      this.waiter = (result) => {
        clearTimeout(timer);
        this.settled = true;
        if (result.ok) {
          resolve(result.event);
        } else {
          reject(result.error);
        }
      };
    });
  }
}
