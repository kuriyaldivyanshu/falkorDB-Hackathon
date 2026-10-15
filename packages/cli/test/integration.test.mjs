import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createBackend, parseBackendConfig, ROUTES } from '../../backend/dist/src/index.js';
import { BACKEND_ROUTES } from '../dist/transport/routes.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
async function eventually(predicate) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('event listener was not released');
}

test('actual CLI health, correlated echo, rejection, connection failure and bounded subscriber cleanup', { timeout: 30000 }, async () => {
  assert.deepEqual(BACKEND_ROUTES, ROUTES);
  const backend = createBackend({ config: parseBackendConfig({ env: { THREADLINE_PORT: '0', THREADLINE_MAX_EVENT_LISTENERS: '1' }, cwd: process.cwd() }) });
  const address = await backend.start();
  try {
    const health = await exec(process.execPath, [cli, 'health', '--backend', address.url], { timeout: 5000 });
    assert.match(health.stdout, /state=ready/);
    assert.match(health.stdout, /durable=false replayable=false/);
    for (let i = 0; i < 25; i += 1) {
      const result = await exec(process.execPath, [cli, 'echo', `integration-${i}`, '--backend', address.url], { timeout: 8000 });
      const ids = [...result.stdout.matchAll(/(?:command  |commandId=)(cmd_[\da-f-]+)/g)].map((match) => match[1]);
      assert.equal(ids.length, 2, result.stdout);
      assert.equal(ids[0], ids[1]);
      assert.equal((result.stdout.match(/durability=development-only/g) ?? []).length, 2);
      await eventually(() => backend.events.listenerCount === 0);
    }
    await assert.rejects(exec(process.execPath, [cli, 'echo', '', '--backend', address.url], { timeout: 5000 }), (error) => error.code === 1 && /invalid_request/.test(error.stdout));
    const stream = await fetch(`${address.url}/events`);
    assert.equal(stream.status, 200);
    try {
      const full = await fetch(`${address.url}/events`, { signal: AbortSignal.timeout(1000) });
      assert.equal(full.status, 503);
      assert.equal((await full.json()).error.code, 'service_unavailable');
    } finally {
      await stream.body.cancel();
    }
  } finally {
    await backend.stop();
  }
  await assert.rejects(exec(process.execPath, [cli, 'health', '--backend', address.url, '--timeout', '1000'], { timeout: 3000 }), (error) => error.code === 1 && /ECONNREFUSED/.test(error.stdout));
});
