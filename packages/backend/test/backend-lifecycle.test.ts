import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { BackendStateError, type ComponentName, type ComponentStatus, type ThreadlineEvent } from '@threadline/shared';

import { parseBackendConfig, type ConfigSource } from '../src/config.js';
import { createBackend, type Backend } from '../src/index.js';

function testConfigSource(overrides: Record<string, string> = {}): ConfigSource {
  return {
    env: {
      THREADLINE_HOST: '127.0.0.1',
      THREADLINE_PORT: '0',
      ...overrides,
    },
    cwd: process.cwd(),
  };
}

async function startTestBackend(
  overrides: Record<string, string> = {},
): Promise<{ backend: Backend; url: string }> {
  const backend = createBackend({ config: parseBackendConfig(testConfigSource(overrides)) });
  const address = await backend.start();
  return { backend, url: address.url };
}

test('createBackend binds nothing and reports state created', () => {
  const backend = createBackend({ config: parseBackendConfig(testConfigSource()) });

  assert.equal(backend.state, 'created');
  assert.equal(backend.address, null);
  assert.equal(backend.events.closed, false);
  assert.equal(backend.health().state, 'created');
});

test('start binds an ephemeral port and reports ready with honest components', async (t) => {
  const { backend } = await startTestBackend();
  t.after(async () => {
    await backend.stop();
  });

  assert.equal(backend.state, 'ready');
  assert.ok((backend.address?.port ?? 0) > 0);

  const health = backend.health();
  assert.equal(health.state, 'ready');
  assert.equal(health.guarantees.durable, false);
  assert.equal(health.guarantees.replayable, false);

  const byName = new Map<ComponentName, ComponentStatus>(
    health.components.map((component): [ComponentName, ComponentStatus] => [component.name, component]),
  );
  assert.equal(byName.get('api')?.ready, true);
  assert.equal(byName.get('eventPublisher')?.ready, true);
  for (const absent of ['postgres', 'falkordb', 'provider', 'checker'] as const) {
    const component = byName.get(absent);
    assert.equal(component?.present, false, `${absent} must not claim to be present`);
    assert.equal(component?.ready, false, `${absent} must not claim readiness`);
    assert.ok((component?.detail.length ?? 0) > 0);
  }
});

test('health reports not-ready before the transport is bound', () => {
  const backend = createBackend({ config: parseBackendConfig(testConfigSource()) });
  const api = backend.health().components.find((component) => component.name === 'api');

  assert.equal(api?.present, true);
  assert.equal(api?.ready, false);
  assert.equal(backend.health().uptimeMs, 0);
});

test('start publishes status transitions that a subscriber can observe', async (t) => {
  const { backend } = await startTestBackend();
  t.after(async () => {
    await backend.stop();
  });

  const states: string[] = [];
  backend.events.subscribe((event: ThreadlineEvent) => {
    if (event.name === 'backend.status') {
      states.push(event.payload.state);
    }
  });

  await backend.stop();

  assert.deepEqual(states, ['stopping', 'stopped']);
});

test('stop closes the transport, releases listeners and refuses new commands', async () => {
  const { backend } = await startTestBackend();
  backend.events.subscribe(() => {});
  assert.equal(backend.events.listenerCount, 1);

  await backend.stop();

  assert.equal(backend.state, 'stopped');
  assert.equal(backend.address, null);
  assert.equal(backend.events.closed, true);
  assert.equal(backend.events.listenerCount, 0);
  assert.equal(
    backend.health().components.find((component) => component.name === 'api')?.ready,
    false,
  );

  const outcome = await backend.dispatch({
    protocolVersion: 1,
    command: 'development.echo',
    input: { text: 'after stop' },
  });
  assert.equal(outcome.status, 503);
  assert.equal(outcome.body.ok, false);
  if (!outcome.body.ok) {
    assert.equal(outcome.body.error.code, 'service_unavailable');
  }
});

test('stop is idempotent and start cannot be repeated', async () => {
  const { backend } = await startTestBackend();

  await backend.stop();
  await backend.stop();
  assert.equal(backend.state, 'stopped');

  assert.throws(() => backend.start(), BackendStateError);
});

test('start rejects a second call while already running', async (t) => {
  const { backend } = await startTestBackend();
  t.after(async () => {
    await backend.stop();
  });

  assert.throws(() => backend.start(), BackendStateError);
  assert.equal(backend.state, 'ready');
});

test('a failed bind stops the backend instead of pretending to be ready', async () => {
  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const address = blocker.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  assert.ok(port > 0);

  const backend = createBackend({
    config: parseBackendConfig(testConfigSource({ THREADLINE_PORT: String(port) })),
  });

  try {
    await assert.rejects(() => backend.start(), /EADDRINUSE/);
    assert.equal(backend.state, 'stopped');
    assert.equal(backend.events.closed, true);
    assert.equal(backend.address, null);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('stopping a backend that never started is still clean', async () => {
  const backend = createBackend({ config: parseBackendConfig(testConfigSource()) });

  await backend.stop();

  assert.equal(backend.state, 'stopped');
  assert.equal(backend.events.closed, true);
});
test('stop during asynchronous startup never returns the backend to ready',async()=>{
 const backend=createBackend({config:parseBackendConfig(testConfigSource())});
 const starting=backend.start();
 const rejected=assert.rejects(starting,BackendStateError);
 await backend.stop();await rejected;
 assert.equal(backend.state,'stopped');assert.equal(backend.address,null);assert.equal(backend.events.closed,true);
});
