import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EventCapacityError,
  PublisherClosedError,
  type ThreadlineEvent,
} from '@threadline/shared';

import {
  createEventPublisher,
  type EventPublisher,
  type EventSubscription,
} from '../src/events/publisher.js';

function statusPayload(detail: string) {
  return { state: 'ready' as const, since: '2026-10-15T00:00:00.000Z', detail };
}

/** Mirrors how a real consumer narrows a stream it does not own. */
function collectDetails(
  publisher: EventPublisher,
  sink: (detail: string, event: ThreadlineEvent) => void,
): EventSubscription {
  return publisher.subscribe((event) => {
    if (event.name === 'backend.status') {
      sink(event.payload.detail, event);
    }
  });
}

test('sequence starts at 1 and increases monotonically', () => {
  const publisher = createEventPublisher({
    maxListeners: 2,
    clock: () => new Date('2026-10-15T00:00:00.000Z'),
  });
  assert.equal(publisher.sequence, 0);

  const first = publisher.publish('backend.status', statusPayload('one'));
  const second = publisher.publish('backend.status', statusPayload('two'));

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(publisher.sequence, 2);
  assert.notEqual(first.eventId, second.eventId);
  assert.equal(first.protocolVersion, 1);
  assert.equal(first.occurredAt, '2026-10-15T00:00:00.000Z');
});

test('subscribers receive events in publication order', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  const details: string[] = [];
  collectDetails(publisher, (detail) => details.push(detail));

  publisher.publish('backend.status', statusPayload('one'));
  publisher.publish('backend.status', statusPayload('two'));

  assert.deepEqual(details, ['one', 'two']);
});

test('a late subscriber sees no earlier event because there is no replay buffer', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  publisher.publish('backend.status', statusPayload('before subscribe'));

  const sequences: number[] = [];
  collectDetails(publisher, (_detail, event) => sequences.push(event.sequence));
  publisher.publish('backend.status', statusPayload('after subscribe'));

  assert.deepEqual(sequences, [2]);
});

test('closing a subscription stops delivery and is idempotent', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  const details: string[] = [];
  const subscription = collectDetails(publisher, (detail) => details.push(detail));

  publisher.publish('backend.status', statusPayload('first'));
  subscription.close();
  subscription.close();
  publisher.publish('backend.status', statusPayload('second'));

  assert.equal(subscription.closed, true);
  assert.deepEqual(details, ['first']);
  assert.equal(publisher.listenerCount, 0);
});

test('refuses a subscriber beyond the declared listener bound', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  publisher.subscribe(() => {});
  publisher.subscribe(() => {});

  assert.throws(() => publisher.subscribe(() => {}), EventCapacityError);
  assert.equal(publisher.listenerCount, 2);
});

test('one throwing listener does not stop the others', () => {
  const publisher = createEventPublisher({ maxListeners: 3 });
  const details: string[] = [];
  publisher.subscribe(() => {
    throw new Error('listener exploded');
  });
  collectDetails(publisher, (detail) => details.push(detail));

  publisher.publish('backend.status', statusPayload('still delivered'));

  assert.deepEqual(details, ['still delivered']);
  assert.equal(publisher.sequence, 1);
});

test('onListenerError receives the failure instead of it escaping publish', () => {
  const publisher = createEventPublisher({ maxListeners: 3 });
  const failures: unknown[] = [];
  const details: string[] = [];

  publisher.subscribe(
    () => {
      throw new Error('first listener failed');
    },
    {
      onListenerError: (error) => {
        failures.push(error);
      },
    },
  );
  collectDetails(publisher, (detail) => details.push(detail));

  publisher.publish('backend.status', statusPayload('body'));

  assert.equal(failures.length, 1);
  assert.match(String((failures[0] as Error).message), /first listener failed/);
  assert.deepEqual(details, ['body']);
});

test('an unsubscribing listener does not skip the next one', () => {
  const publisher = createEventPublisher({ maxListeners: 3 });
  const delivered: string[] = [];
  const first = publisher.subscribe(() => {
    delivered.push('first');
    first.close();
  });
  publisher.subscribe(() => {
    delivered.push('second');
  });

  publisher.publish('backend.status', statusPayload('body'));
  publisher.publish('backend.status', statusPayload('body'));

  assert.deepEqual(delivered, ['first', 'second', 'second']);
  assert.equal(publisher.listenerCount, 1);
});

test('close releases listeners and further use is refused loudly', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  publisher.subscribe(() => {});

  publisher.close();

  assert.equal(publisher.closed, true);
  assert.equal(publisher.listenerCount, 0);
  assert.throws(() => publisher.publish('backend.status', statusPayload('body')), PublisherClosedError);
  assert.throws(() => publisher.subscribe(() => {}), PublisherClosedError);
});

test('a non-function listener is rejected at the boundary', () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  assert.throws(() => publisher.subscribe('not a function' as unknown as () => void), TypeError);
});

test('maxListeners must be a positive integer', () => {
  assert.throws(() => createEventPublisher({ maxListeners: 0 }), RangeError);
  assert.throws(() => createEventPublisher({ maxListeners: 1.5 }), RangeError);
});