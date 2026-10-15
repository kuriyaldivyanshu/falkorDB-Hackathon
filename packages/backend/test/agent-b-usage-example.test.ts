import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHealthReport,
  isThreadlineEvent,
  newCommandId,
  newEchoId,
  type CommandResponse,
  type HealthReport,
} from '@threadline/shared';

/**
 * Consumer-side contract check.
 *
 * This file imports only the published `@threadline/shared` entry point and
 * uses it exactly the way the terminal client will. It exists so that the
 * exported shapes are verified from the consumer's direction, not just from the
 * backend that produces them. Agent B's client code should mirror the patterns
 * below rather than importing backend internals.
 */

const EVENT_STREAM_SAMPLE = [
  ': threadline development events; process-local, no replay, no persistence',
  'id: 7',
  'event: development.echo.accepted',
  'data: {"protocolVersion":1,"sequence":7,"eventId":"evt_5f0b9e6a-2f0e-4a6a-9c2b-8f0e2b7c4d11","name":"development.echo.accepted","occurredAt":"2026-10-15T00:00:00.000Z","payload":{"commandId":"cmd_0b6a1a54-1b1a-4d18-9b40-1f2f2a7d9a10","echoId":"echo_1b1c9d2e-2b3c-4a5d-8e9f-0a1b2c3d4e5f","text":"streamed","acceptedAt":"2026-10-15T00:00:00.000Z","durability":"development-only"}}',
  '',
].join('\n');

test('a client can parse and narrow a stream frame using only the shared package', () => {
  const dataLine = EVENT_STREAM_SAMPLE.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'the sampled frame must carry a data line');

  const decoded: unknown = JSON.parse(dataLine.slice('data: '.length));
  assert.ok(isThreadlineEvent(decoded), 'isThreadlineEvent must accept a well-formed frame');

  if (decoded.name === 'development.echo.accepted') {
    assert.equal(decoded.payload.text, 'streamed');
    assert.equal(decoded.payload.durability, 'development-only');
  } else {
    assert.fail('the sampled frame must narrow to development.echo.accepted');
  }
});

test('a client can narrow a status frame without casting', () => {
  const decoded: unknown = JSON.parse(
    '{"protocolVersion":1,"sequence":1,"eventId":"evt_1","name":"backend.status","occurredAt":"2026-10-15T00:00:00.000Z","payload":{"state":"ready","since":"2026-10-15T00:00:00.000Z","detail":"ready"}}',
  );
  assert.ok(isThreadlineEvent(decoded));

  const states: string[] = [];
  if (decoded.name === 'backend.status') {
    states.push(decoded.payload.state);
    assert.equal(decoded.payload.detail, 'ready');
  }

  assert.deepEqual(states, ['ready']);
});

test('a client can branch on a command response without casting', () => {
  const success: CommandResponse = {
    ok: true,
    protocolVersion: 1,
    commandId: newCommandId(),
    receivedAt: '2026-10-15T00:00:00.000Z',
    result: {
      echoId: newEchoId(),
      text: 'hi',
      acceptedAt: '2026-10-15T00:00:00.000Z',
      durability: 'development-only',
    },
  };

  if (success.ok) {
    assert.equal(success.result.durability, 'development-only');
  }

  const failure: CommandResponse = {
    ok: false,
    protocolVersion: 1,
    commandId: null,
    receivedAt: '2026-10-15T00:00:00.000Z',
    error: { code: 'unknown_command', message: 'nope' },
  };

  assert.equal(failure.ok, false);
  if (!failure.ok) {
    assert.equal(failure.error.code, 'unknown_command');
  }
});

test('a client can validate a health response', () => {
  const decoded: unknown = JSON.parse(
    '{"protocolVersion":1,"backendVersion":"0.0.0-m00","state":"ready","uptimeMs":10,"components":[],"guarantees":{"durable":false,"replayable":false,"multiSession":false,"note":"test"}}',
  );

  assert.ok(isHealthReport(decoded));
  const report = decoded as HealthReport;
  assert.equal(report.state, 'ready');
  assert.equal(report.guarantees.durable, false);
});