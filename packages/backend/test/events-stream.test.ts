import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import test from 'node:test';
import { EventCapacityError } from '@threadline/shared';
import { createEventStreamManager } from '../src/api/events-stream.js';
import { createEventPublisher } from '../src/events/publisher.js';

function response(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

test('SSE listener capacity is rejected before any response headers are sent', () => {
  const publisher = createEventPublisher({ maxListeners: 1 });
  const held = publisher.subscribe(() => {});
  const manager = createEventStreamManager({ publisher, maxBacklogBytes: 4096 });
  const raw = response();
  assert.throws(() => manager.open(raw), EventCapacityError);
  assert.equal(raw.headersSent, false);
  assert.equal(manager.openCount, 0);
  held.close();
});

test('multiple small blocked SSE writes hit the accumulated backlog bound', (t) => {
  const publisher = createEventPublisher({ maxListeners: 1 });
  const manager = createEventStreamManager({ publisher, maxBacklogBytes: 1024 });
  const raw = response();
  t.mock.method(raw, 'write', () => false);
  const destroyed = t.mock.method(raw, 'destroy', () => raw);
  const stream = manager.open(raw);
  for (let i = 0; i < 20; i += 1) {
    publisher.publish('backend.status', { state: 'ready', since: '2026-10-15T00:00:00.000Z', detail: 'small' });
  }
  assert.equal(stream.closeReason, 'backlog-exceeded');
  assert.equal(publisher.listenerCount, 0);
  assert.equal(manager.openCount, 0);
  assert.equal(destroyed.mock.calls.length, 1);
});
