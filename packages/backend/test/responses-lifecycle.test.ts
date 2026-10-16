import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createResponsesDriver, type PreparedAttempt } from '../src/provider/responses.js';
import type { ProviderLifecycle } from '../src/provider/lifecycle.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';

const key = 'synthetic-lifecycle-test-key';
const identity = { logicalRequestId: 'logical-9', attemptId: 'attempt-9' };
const call = { type: 'function_call', status: 'completed', call_id: 'call-1', name: 'workspace_read', arguments: '{"path":"src/exporter.mjs"}' };
const terminal = { type: 'response.completed', response: { id: 'resp-9', status: 'completed', output: [call], usage: { input_tokens: 11, output_tokens: 7 } } };
const created = { type: 'response.created', response: { id: 'resp-9' } };

function stream(events: unknown[], width = 13): Response {
  const bytes = new TextEncoder().encode(events.map((event, sequence_number) => `event: fixture\r\ndata: ${JSON.stringify({ ...event as object, sequence_number })}\r\n\r\n`).join(''));
  let position = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (position >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(position, position + width)); position += width;
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'provider-request-9' } });
}

type TurnRequest = Parameters<ReturnType<typeof createResponsesDriver>['turn']>[0];
function request(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return { model: 'explicit-lifecycle-model', input: [{ role: 'user' as const, content: 'Read the candidate' }], tools: READ_ONLY_FUNCTIONS,
    maxOutputTokens: 100, signal: new AbortController().signal, identity,
    authorizeAndJournal: async () => {}, onVisibleText: () => {}, ...overrides };
}

const phases = (events: ProviderLifecycle[]): string[] => events.map(event => event.phase);

test('a successful turn reports prepared, journaled, dispatched, response, stream and settled in order', async () => {
  const events: ProviderLifecycle[] = [];
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal]) })
    .turn(request({ onLifecycle: event => events.push(event) }));

  assert.equal(result.status, 'completed');
  assert.deepEqual(phases(events), ['prepared', 'journaled', 'dispatched', 'response_observed', 'stream_observed', 'settled']);

  const prepared = events[0] as { prepared: { requestDigest: string; requestBytes: number; inputItems: number; toolCount: number; logicalRequestId: string; attemptId: string } };
  assert.equal(prepared.prepared.logicalRequestId, 'logical-9');
  assert.equal(prepared.prepared.attemptId, 'attempt-9');
  assert.equal(prepared.prepared.inputItems, 1);
  assert.equal(prepared.prepared.toolCount, 3);
  assert.match(prepared.prepared.requestDigest, /^[0-9a-f]{64}$/);
  assert.ok(prepared.prepared.requestBytes > 0);

  const settled = events.at(-1) as { settled: { status: string; possibleCharge: boolean; usage: { inputTokens: number; outputTokens: number } | null; providerRequestId: string | null } };
  assert.equal(settled.settled.status, 'completed');
  assert.equal(settled.settled.possibleCharge, true);
  assert.deepEqual(settled.settled.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(settled.settled.providerRequestId, 'provider-request-9');
});

test('caller ids, provider response id and provider request id stay distinct', async () => {
  const events: ProviderLifecycle[] = [];
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal]) })
    .turn(request({ onLifecycle: event => events.push(event) }));

  assert.equal(result.requestId, 'provider-request-9');
  assert.equal(result.responseId, 'resp-9');
  const observed = events.find(event => event.phase === 'response_observed') as { observed: { providerRequestId: string; status: number } };
  assert.equal(observed.observed.providerRequestId, 'provider-request-9');
  assert.equal(observed.observed.status, 200);
  for (const event of events) {
    const record = 'prepared' in event ? event.prepared : 'attempt' in event ? event.attempt : 'observed' in event ? event.observed : event.settled;
    assert.notEqual(record.attemptId, 'provider-request-9');
    assert.notEqual(record.attemptId, 'resp-9');
  }
});

test('the prepared requestBody is byte-identical to what the transport transmits', async () => {
  let sentBody = '';
  let preparedBody: string | null = null;
  await createResponsesDriver({ apiKey: key, fetchImpl: async (_url, init) => {
    sentBody = String(init?.body);
    return stream([created, terminal]);
  } }).turn(request({
    authorizeAndJournal: async (p) => { preparedBody = p.requestBody; },
  }));

  assert.ok(preparedBody !== null, 'the journal barrier must receive the exact body');
  assert.equal(preparedBody, sentBody,
    'the bytes handed to the durable journal must be the identical bytes that are transmitted');
  assert.equal(createHash('sha256').update(preparedBody).digest('hex'),
    createHash('sha256').update(sentBody).digest('hex'));
  // The stored body carries the request, never the credential or headers.
  assert.ok(!JSON.stringify(preparedBody).includes(key), 'no credential may enter a stored artifact');
  const parsed = JSON.parse(preparedBody) as Record<string, unknown>;
  assert.equal(parsed['store'], false);
  assert.equal(parsed['stream'], true);
  assert.equal(parsed['parallel_tool_calls'], false);
});

test('the prepared digest is the digest of the exact bytes the transport sends', async () => {
  let sentBody = '';
  const events: ProviderLifecycle[] = [];
  await createResponsesDriver({ apiKey: key, fetchImpl: async (_url, init) => {
    sentBody = String(init?.body);
    return stream([created, terminal]);
  } }).turn(request({ onLifecycle: event => events.push(event) }));

  const prepared = events[0] as { prepared: { requestDigest: string; requestBytes: number } };
  assert.equal(prepared.prepared.requestDigest, createHash('sha256').update(sentBody).digest('hex'));
  assert.equal(prepared.prepared.requestBytes, Buffer.byteLength(sentBody));

  const parsed = JSON.parse(sentBody) as Record<string, unknown>;
  assert.equal(parsed['store'], false);
  assert.equal(parsed['stream'], true);
  assert.equal(parsed['parallel_tool_calls'], false);
  assert.equal((parsed['tools'] as unknown[]).length, 3);
});

test('the journal barrier receives the prepared identity and runs before dispatch', async () => {
  const order: string[] = [];
  await createResponsesDriver({ apiKey: key, fetchImpl: async () => { order.push('fetch'); return stream([created, terminal]); } })
    .turn(request({ onLifecycle: event => order.push(event.phase),
      authorizeAndJournal: async (prepared: PreparedAttempt) => { order.push(`journal:${prepared.attemptId}:${prepared.requestDigest.slice(0, 8)}`); } }));

  assert.equal(order[0], 'prepared');
  assert.match(order[1] as string, /^journal:attempt-9:[0-9a-f]{8}$/);
  assert.equal(order[2], 'journaled');
  assert.equal(order[3], 'dispatched');
  assert.equal(order[4], 'fetch', 'the transport is invoked only after the journal barrier returns');
  assert.equal(order.at(-1), 'settled');
});

test('a journal failure emits prepared only, and never dispatches', async () => {
  let dispatched = 0;
  const events: ProviderLifecycle[] = [];
  await assert.rejects(
    () => createResponsesDriver({ apiKey: key, fetchImpl: async () => { dispatched += 1; return stream([created, terminal]); } })
      .turn(request({ onLifecycle: event => events.push(event),
        authorizeAndJournal: async () => { throw new Error('reservation refused'); } })),
    /reservation refused/,
  );
  assert.equal(dispatched, 0);
  assert.deepEqual(phases(events), ['prepared']);
});

test('pre-dispatch cancellation settles as uncharged and emits no dispatch', async () => {
  const controller = new AbortController(); controller.abort();
  const events: ProviderLifecycle[] = [];
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => { throw new Error('must not run'); } })
    .turn(request({ signal: controller.signal, onLifecycle: event => events.push(event) }));

  assert.equal(result.status, 'cancelled');
  assert.equal(result.possibleCharge, false);
  assert.ok(!phases(events).includes('dispatched'));
  const settled = events.at(-1) as { settled: { possibleCharge: boolean; reason: string } };
  assert.equal(settled.settled.possibleCharge, false);
  assert.equal(settled.settled.reason, 'cancelled_before_dispatch');
});

test('a known rejection settles as failed and uncharged; an unknown one keeps possible charge', async () => {
  for (const [status, expected, charge] of [[401, 'failed', false], [500, 'unknown', true]] as const) {
    const events: ProviderLifecycle[] = [];
    const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => new Response('provider detail', { status }) })
      .turn(request({ onLifecycle: event => events.push(event) }));
    assert.equal(result.status, expected);
    const settled = events.at(-1) as { settled: { possibleCharge: boolean } };
    assert.equal(settled.settled.possibleCharge, charge);
    assert.deepEqual(phases(events), ['prepared', 'journaled', 'dispatched', 'response_observed', 'settled']);
  }
});

test('a missing caller identity is refused before any request', async () => {
  let dispatched = 0;
  for (const bad of [undefined, { logicalRequestId: '', attemptId: 'a' }, { logicalRequestId: 'l', attemptId: '' }]) {
    await assert.rejects(
      () => createResponsesDriver({ apiKey: key, fetchImpl: async () => { dispatched += 1; return stream([created, terminal]); } })
        .turn(request({ identity: bad })),
      /logicalRequestId and attemptId are required/,
    );
  }
  assert.equal(dispatched, 0);
});

test('a throwing observer never changes the turn outcome', async () => {
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal]) })
    .turn(request({ onLifecycle: () => { throw new Error('observer exploded'); } }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
});

test('no lifecycle observation ever contains the API key', async () => {
  const events: ProviderLifecycle[] = [];
  await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal]) })
    .turn(request({ onLifecycle: event => events.push(event) }));
  assert.ok(!JSON.stringify(events).includes(key));
});