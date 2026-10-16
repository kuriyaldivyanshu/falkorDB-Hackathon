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

test('streamed text bursts are coalesced without stale authorization or event reordering', async t => {
  const publisher = createEventPublisher({ maxListeners: 1 });
  const manager = createEventStreamManager({ publisher, maxBacklogBytes: 64 * 1024 });
  const raw = response(), writes: string[] = [];
  t.mock.method(raw, 'write', (chunk: unknown) => { writes.push(String(chunk)); return true; });
  let release!: (allowed: boolean) => void, calls = 0, permitted = true;
  const stream = manager.open(raw, async () => { calls++; if (calls === 1) return new Promise<boolean>(r => { release = r; }); return permitted; });
  const payload = { tenantId: 'tenant', projectId: 'project', sessionId: 'session', runId: 'run', kind: 'visible_text' as const, state: '', detail: 'x' };
  for (let n = 0; n < 200; n++) publisher.publish('run.activity', payload);
  publisher.publish('backend.status', { state: 'ready', since: '2026-10-16T00:00:00Z', detail: 'after-text' });
  assert.equal(stream.closed, false, 'ordinary text burst must not hit the authorization queue limit');
  await Promise.resolve(); release(true);
  await new Promise(r => setImmediate(r));
  const delivered = writes.join('');
  const frames = delivered.split('\n\n').flatMap(frame => { const data = frame.split('\n').find(line => line.startsWith('data:')); return data ? [JSON.parse(data.slice(5))] : []; });
  assert.equal(frames.filter(e => e.name === 'run.activity').map(e => e.payload.detail).join(''), 'x'.repeat(200));
  assert.equal(frames.at(-1).name, 'backend.status');
  assert.ok(calls < 10, 'authorization scales with coalesced deliveries');
  permitted = false;
  publisher.publish('run.activity', { ...payload, detail: 'revoked-private-text' });
  await new Promise(r => setImmediate(r));
  assert.ok(!writes.join('').includes('revoked-private-text'), 'next delivery must recheck revocation');
  manager.closeAll();
});
