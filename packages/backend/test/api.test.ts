import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import {
  errorPayload,
  isHealthReport,
  isThreadlineEvent,
  newCommandId,
  type HealthReport,
} from '@threadline/shared';

import { createHttpServer } from '../src/api/server.js';
import { parseBackendConfig } from '../src/config.js';
import type { CommandDispatcher } from '../src/domain/dispatcher.js';
import { createBackend, type Backend } from '../src/index.js';
import { createEventPublisher } from '../src/events/publisher.js';
import { silentLogger } from '../src/log.js';

function testConfig(overrides: Record<string, string> = {}) {
  return parseBackendConfig({
    env: { THREADLINE_HOST: '127.0.0.1', THREADLINE_PORT: '0', ...overrides },
    cwd: process.cwd(),
  });
}

async function withBackend(
  overrides: Record<string, string>,
  body: (backend: Backend, url: string) => Promise<void>,
): Promise<void> {
  const backend = createBackend({ config: testConfig(overrides) });
  const address = await backend.start();
  try {
    await body(backend, address.url);
  } finally {
    await backend.stop();
  }
}

async function postCommand(
  url: string,
  body: unknown,
  contentType = 'application/json',
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${url}/commands`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test('GET /healthz returns a typed report and is honest about missing components', async () => {
  await withBackend({}, async (_backend, url) => {
    const response = await fetch(`${url}/healthz`);

    assert.equal(response.status, 200);
    const report = (await response.json()) as HealthReport;
    assert.ok(isHealthReport(report));
    assert.equal(report.state, 'ready');
    assert.equal(report.guarantees.durable, false);
    assert.equal(
      report.components.find((component) => component.name === 'postgres')?.ready,
      false,
    );
  });
});

test('GET /healthz answers 503 while the backend is not ready', async () => {
  const publisher = createEventPublisher({ maxListeners: 2 });
  const notReady: HealthReport = {
    protocolVersion: 1,
    backendVersion: 'test',
    state: 'created',
    uptimeMs: 0,
    components: [],
    guarantees: {
      durable: false,
      replayable: false,
      multiSession: false,
      note: 'test double',
    },
  };
  const stubDispatch: CommandDispatcher = async () => ({
    status: 400,
    body: {
      ok: false,
      protocolVersion: 1,
      commandId: newCommandId(),
      receivedAt: new Date().toISOString(),
      error: errorPayload('invalid_request'),
    },
  });

  const server = createHttpServer({
    config: testConfig(),
    dispatch: stubDispatch,
    publisher,
    health: () => notReady,
    logger: silentLogger,
  });
  const address = await server.listen();

  try {
    const response = await fetch(`${address.url}/healthz`);
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as HealthReport).state, 'created');
  } finally {
    await server.close();
    publisher.close();
  }
});

test('POST /commands performs a real round trip labelled development-only', async () => {
  await withBackend({}, async (_backend, url) => {
    const { status, json } = await postCommand(url, {
      protocolVersion: 1,
      command: 'development.echo',
      input: { text: 'hello backend' },
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.result.text, 'hello backend');
    assert.equal(json.result.durability, 'development-only');
    assert.match(json.commandId, /^cmd_/);
    assert.match(json.result.echoId, /^echo_/);
  });
});

test('POST /commands rejects each malformed request with its own typed error', async () => {
  await withBackend({}, async (_backend, url) => {
    const cases: Array<{ body: unknown; code: string }> = [
      {
        body: { protocolVersion: 99, command: 'development.echo', input: { text: 'x' } },
        code: 'invalid_request',
      },
      {
        body: { command: 'development.echo', input: { text: 'x' } },
        code: 'invalid_request',
      },
      {
        body: { protocolVersion: 1, command: 'task.fabricate', input: { text: 'x' } },
        code: 'unknown_command',
      },
      {
        body: { protocolVersion: 1, command: 'development.echo', input: { text: 'x' }, extra: 1 },
        code: 'invalid_request',
      },
      {
        body: { protocolVersion: 1, command: 'development.echo', input: { text: 42 } },
        code: 'invalid_request',
      },
      {
        body: { protocolVersion: 1, command: 'development.echo', input: { text: '   ' } },
        code: 'invalid_request',
      },
      {
        body: { protocolVersion: 1, command: 'development.echo', input: {} },
        code: 'invalid_request',
      },
      { body: ['not', 'an', 'object'], code: 'invalid_request' },
    ];

    for (const testCase of cases) {
      const { status, json } = await postCommand(url, testCase.body);
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(testCase.body)}`);
      assert.equal(json.ok, false);
      assert.equal(json.error.code, testCase.code, `wrong code for ${JSON.stringify(testCase.body)}`);
      assert.equal(typeof json.error.message, 'string');
    }
  });
});

test('POST /commands enforces the declared text limit without echoing the text', async () => {
  await withBackend({ THREADLINE_MAX_COMMAND_TEXT_LENGTH: '16' }, async (_backend, url) => {
    const secretText = 'SENSITIVE-VALUE-THAT-MUST-NOT-BE-REFLECTED';
    const { status, json } = await postCommand(url, {
      protocolVersion: 1,
      command: 'development.echo',
      input: { text: secretText },
    });

    assert.equal(status, 400);
    assert.equal(json.error.code, 'invalid_request');
    assert.equal(json.error.details.limit, 16);
    assert.equal(json.error.details.received, secretText.length);
    assert.ok(!JSON.stringify(json.error).includes(secretText));
  });
});

test('the declared body limit is enforced by the transport', async () => {
  await withBackend(
    {
      THREADLINE_MAX_REQUEST_BODY_BYTES: '1024',
      THREADLINE_MAX_COMMAND_TEXT_LENGTH: '512',
    },
    async (_backend, url) => {
      const { status } = await postCommand(url, {
        protocolVersion: 1,
        command: 'development.echo',
        input: { text: 'x'.repeat(4096) },
      });

      assert.equal(status, 413);
    },
  );
});

test('a non-JSON content type is refused before command validation', async () => {
  await withBackend({}, async (_backend, url) => {
    const { status } = await postCommand(
      url,
      'protocolVersion=1',
      'application/x-www-form-urlencoded',
    );
    assert.equal(status, 415);
  });
});

test('an unknown route is not served', async () => {
  await withBackend({}, async (_backend, url) => {
    const response = await fetch(`${url}/nope`);
    assert.equal(response.status, 404);
  });
});

test('GET /events streams parseable frames and states that there is no replay', async () => {
  await withBackend({}, async (backend, url) => {
    const port = new URL(url).port;
    const stream = await openRawEventStream(Number(port));

    try {
      await waitFor(() => backend.events.listenerCount >= 1);
      await backend.dispatch({
        protocolVersion: 1,
        command: 'development.echo',
        input: { text: 'streamed' },
      });
      await waitFor(() => stream.text().includes('development.echo.accepted'));

      const text = stream.text();
      assert.match(text, /content-type: text\/event-stream/);
      assert.match(text, /cache-control: no-store/);
      assert.match(text, /no replay/);

      const frame = text.slice(text.lastIndexOf('id: '));
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      assert.ok(dataLine, 'expected a data frame');
      const event = JSON.parse(dataLine.slice('data: '.length));
      assert.ok(isThreadlineEvent(event));
      assert.equal(event.name, 'development.echo.accepted');
      if (event.name === 'development.echo.accepted') {
        assert.equal(event.payload.text, 'streamed');
        assert.equal(event.payload.durability, 'development-only');
      }
    } finally {
      stream.socket.destroy();
    }
  });
});

test('a stream is closed rather than buffered without bound when an event will not fit', async () => {
  await withBackend(
    {
      THREADLINE_MAX_EVENT_BACKLOG_BYTES: '4096',
      THREADLINE_MAX_COMMAND_TEXT_LENGTH: '60000',
    },
    async (backend, url) => {
      const port = new URL(url).port;
      const stream = await openRawEventStream(Number(port));

      try {
        await waitFor(() => backend.events.listenerCount >= 1);
        await backend.dispatch({
          protocolVersion: 1,
          command: 'development.echo',
          input: { text: 'x'.repeat(16_000) },
        });

        await stream.closed;
        await waitFor(() => backend.events.listenerCount === 0);
      } finally {
        stream.socket.destroy();
      }
    },
  );
});

test('shutdown closes open event streams', async () => {
  const backend = createBackend({ config: testConfig() });
  const address = await backend.start();
  const stream = await openRawEventStream(address.port);

  await waitFor(() => backend.events.listenerCount >= 1);
  await backend.stop();
  await stream.closed;

  assert.equal(backend.events.listenerCount, 0);
  stream.socket.destroy();
});

interface RawEventStream {
  readonly socket: net.Socket;
  readonly closed: Promise<void>;
  text(): string;
}

async function openRawEventStream(port: number): Promise<RawEventStream> {
  const chunks: string[] = [];
  let markClosed = (): void => {};
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });

  const socket = net.connect({ host: '127.0.0.1', port }, () => {
    socket.write(
      `GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAccept: text/event-stream\r\n\r\n`,
    );
  });
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => chunks.push(chunk));
  socket.on('close', markClosed);
  socket.on('error', markClosed);

  await new Promise<void>((resolve) => {
    socket.once('connect', resolve);
  });

  return { socket, closed, text: () => chunks.join('') };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the backend to reach the expected state');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}