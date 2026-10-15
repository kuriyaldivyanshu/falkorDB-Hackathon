import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { newCommandId, newEchoId, newEventId } from '@threadline/shared';
import { createBackendClient } from '../dist/transport/backend-client.js';
import { runEcho } from '../dist/one-shot.js';

// A normal no-replay server can accept POST before the slower SSE handshake.
// The client must await subscription, not merely start the fetch first.
test('echo waits for a delayed event subscription before dispatching', async () => {
  let subscribed = false;
  let controller;
  const commandId = newCommandId();
  const result = { echoId: newEchoId(), text: 'hello', acceptedAt: new Date().toISOString(), durability: 'development-only' };
  const body = new ReadableStream({ start(value) { controller = value; } });
  const client = createBackendClient({
    baseUrl: 'http://fixture.invalid', requestTimeoutMs: 1000,
    fetchImpl: async (url) => {
      if (url.endsWith('/events')) {
        await delay(25);
        subscribed = true;
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }
      assert.ok(subscribed, 'command dispatched before stream subscription');
      const event = { protocolVersion: 1, sequence: 1, eventId: newEventId(), name: 'development.echo.accepted', occurredAt: new Date().toISOString(), payload: { ...result, commandId } };
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      return Response.json({ ok: true, protocolVersion: 1, commandId, receivedAt: result.acceptedAt, result });
    },
  });
  const lines = [];
  try {
    assert.equal(await runEcho(client, 'hello', (line) => lines.push(line)), 0, lines.join('\n'));
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.includes(commandId)));
  } finally {
    await delay(30);
    controller.close();
  }
});
