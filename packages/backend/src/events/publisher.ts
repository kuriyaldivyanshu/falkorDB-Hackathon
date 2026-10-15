import {
  EventCapacityError,
  PROTOCOL_VERSION,
  PublisherClosedError,
  newEventId,
  type EventMap,
  type EventName,
  type ThreadlineEvent,
  type ThreadlineEventOf,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';

/**
 * A process-local, bounded event publisher.
 *
 * Explicit non-capabilities at this milestone:
 * - no persistence, so an event published before a crash is simply gone;
 * - no replay, so a late subscriber sees only events published after it
 *   subscribed;
 * - no cross-instance or cross-restart sequence, so `sequence` is a monotonic
 *   counter for one running backend instance only.
 *
 * A subscriber that falls behind is dropped rather than allowed to grow the
 * process heap without limit.
 */
export type EventListener = (event: ThreadlineEvent) => void;

export interface SubscribeOptions {
  /** Called when one listener throws. The publisher never rethrows from it. */
  readonly onListenerError?: (error: unknown, event: ThreadlineEvent) => void;
}

export interface EventSubscription {
  readonly closed: boolean;
  /** Idempotent. */
  close(): void;
}

export interface EventPublisher {
  publish<E extends EventName>(name: E, payload: EventMap[E]): ThreadlineEventOf<E>;
  subscribe(listener: EventListener, options?: SubscribeOptions): EventSubscription;
  readonly listenerCount: number;
  /** Sequence number of the most recently published event, 0 before any. */
  readonly sequence: number;
  readonly closed: boolean;
  close(): void;
}

export interface EventPublisherDeps {
  readonly maxListeners: number;
  readonly clock?: () => Date;
  readonly generateEventId?: () => ThreadlineEvent['eventId'];
  readonly logger?: Logger;
}

export function createEventPublisher(deps: EventPublisherDeps): EventPublisher {
  if (!Number.isInteger(deps.maxListeners) || deps.maxListeners < 1) {
    throw new RangeError('maxListeners must be a positive integer.');
  }
  const clock = deps.clock ?? (() => new Date());
  const generateEventId = deps.generateEventId ?? newEventId;
  const logger = deps.logger ?? silentLogger;

  const listeners = new Set<{ fn: EventListener; options: SubscribeOptions }>();
  let sequence = 0;
  let closed = false;

  const publisher: EventPublisher = {
    publish<E extends EventName>(name: E, payload: EventMap[E]): ThreadlineEventOf<E> {
      if (closed) {
        throw new PublisherClosedError('publish');
      }
      sequence += 1;
      const event: ThreadlineEventOf<E> = {
        protocolVersion: PROTOCOL_VERSION,
        sequence,
        eventId: generateEventId(),
        name,
        occurredAt: clock().toISOString(),
        payload,
      };
      // Copy first: a listener may unsubscribe itself during delivery.
      for (const entry of [...listeners]) {
        const delivered = asDeliveredEvent(event);
        try {
          entry.fn(delivered);
        } catch (error) {
          const report = entry.options.onListenerError;
          if (report) {
            try {
              report(error, delivered);
            } catch (reportingError) {
              logger.log({
                level: 'error',
                message: 'onListenerError threw; the listener failure is still swallowed.',
                fields: { listenerErrorName: describeError(reportingError) },
              });
            }
          } else {
            logger.log({
              level: 'error',
              message: 'Event listener threw; other listeners were still notified.',
              fields: { listenerErrorName: describeError(error), eventName: name },
            });
          }
        }
      }
      return event;
    },

    subscribe(listener: EventListener, options: SubscribeOptions = {}): EventSubscription {
      if (closed) {
        throw new PublisherClosedError('subscribe');
      }
      if (typeof listener !== 'function') {
        throw new TypeError('Event listener must be a function.');
      }
      if (listeners.size >= deps.maxListeners) {
        throw new EventCapacityError(deps.maxListeners);
      }
      const entry = { fn: listener, options };
      listeners.add(entry);
      let subscriptionClosed = false;
      return {
        get closed() {
          return subscriptionClosed;
        },
        close() {
          if (subscriptionClosed) {
            return;
          }
          subscriptionClosed = true;
          listeners.delete(entry);
        },
      };
    },

    get listenerCount() {
      return listeners.size;
    },

    get sequence() {
      return sequence;
    },

    get closed() {
      return closed;
    },

    close() {
      closed = true;
      listeners.clear();
    },
  };

  return publisher;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Subscribers register without knowing one event name, so they receive the
 * whole discriminated union. Every `ThreadlineEventOf<E>` for `E` in `EventMap`
 * is by construction a member of that union, but TypeScript cannot prove it for
 * an unresolved type parameter. The widening is therefore confined to this one
 * function instead of being repeated at each call site.
 */
function asDeliveredEvent<E extends EventName>(event: ThreadlineEventOf<E>): ThreadlineEvent {
  return event as ThreadlineEvent;
}