import assert from 'node:assert/strict';
import test from 'node:test';
import { createResponsesDriver } from '../src/provider/responses.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';

const key = 'synthetic-provider-test-key';
const call = { type: 'function_call', status: 'completed', call_id: 'call-1', name: 'workspace_read', arguments: '{"path":"src/exporter.mjs","offset":null,"maxBytes":null}' };
const terminal = (output: unknown[] = [call], status = 'completed') => ({ type: `response.${status}`, response: { id: 'resp-1', status, output, usage: { input_tokens: 20, output_tokens: 10 } } });
const created = { type: 'response.created', response: { id: 'resp-1' } };
function stream(events: unknown[], width = 11): Response {
  const bytes = new TextEncoder().encode(events.map((event, sequence_number) => `event: fixture\r\ndata: ${JSON.stringify({ ...event as object, sequence_number })}\r\n\r\n`).join(''));
  let position = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (position >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(position, position + width)); position += width;
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-1' } });
}
function request(overrides: Partial<Parameters<ReturnType<typeof createResponsesDriver>['turn']>[0]> = {}) {
  return { model: 'explicit-test-model', input: [{ role: 'user' as const, content: 'Inspect the candidate' }], tools: READ_ONLY_FUNCTIONS,
    maxOutputTokens: 100, signal: new AbortController().signal,
    identity: { logicalRequestId: 'logical-1', attemptId: 'attempt-1' },
    authorizeAndJournal: async () => {}, onVisibleText: () => {}, ...overrides };
}

test('construction is inert; dispatch follows successful journaling and uses caller-owned history', async () => {
  let calls = 0, journaled = false;
  const driver = createResponsesDriver({ apiKey: key, fetchImpl: async (url, init) => {
    calls += 1; assert.equal(journaled, true); assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body)) as { model: string; store: boolean; stream: boolean; parallel_tool_calls: boolean; tools: unknown[]; input: unknown[] };
    assert.equal(body.model, 'explicit-test-model'); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tools.length, 3); assert.equal(body.input.length, 1);
    return stream([created, terminal()], 1);
  } });
  assert.equal(calls, 0);
  const result = await driver.turn(request({ authorizeAndJournal: async () => { journaled = true; } }));
  assert.equal(calls, 1); assert.equal(result.status, 'completed'); assert.equal(result.requestId, 'request-1');
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
  assert.deepEqual(result.output, [{ type: 'function_call', call_id: 'call-1', name: 'workspace_read', arguments: call.arguments }]);
});

test('authorization/journal failure prevents all network dispatch', async () => {
  let calls = 0;
  const driver = createResponsesDriver({ apiKey: key, fetchImpl: async () => { calls += 1; throw new Error('must not dispatch'); } });
  await assert.rejects(() => driver.turn(request({ authorizeAndJournal: async () => { throw new Error('journal unavailable'); } })), /journal unavailable/);
  assert.equal(calls, 0);
});

test('pre-dispatch cancellation is uncharged; post-dispatch cancellation remains unknown', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const before = await createResponsesDriver({ apiKey: key, fetchImpl: async () => { calls += 1; throw new Error('not called'); } }).turn(request({ signal: controller.signal }));
  assert.equal(before.status, 'cancelled'); assert.equal(before.possibleCharge, false); assert.equal(calls, 0);
  const afterController = new AbortController();
  const after = await createResponsesDriver({ apiKey: key, fetchImpl: async () => { afterController.abort(); throw new Error('aborted'); } }).turn(request({ signal: afterController.signal }));
  assert.equal(after.status, 'unknown'); assert.equal(after.possibleCharge, true); assert.equal(after.usage, null); assert.deepEqual(after.output, []);
});

test('visible deltas stream but partial function arguments never become executable output', async () => {
  const text: string[] = [];
  const events = [created, { type: 'response.output_text.delta', delta: 'partial visible text' },
    { type: 'response.function_call_arguments.done', item_id: 'item-1', arguments: '{}' }];
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream(events) }).turn(request({ onVisibleText: delta => text.push(delta) }));
  assert.deepEqual(text, ['partial visible text']); assert.equal(result.status, 'unknown'); assert.deepEqual(result.output, []); assert.equal(result.usage, null);
});

test('terminal malformed arguments, duplicate call IDs and hidden reasoning fail closed', async () => {
  for (const output of [[{ ...call, arguments: '{' }], [call, call], [{ type: 'reasoning', summary: [{ text: 'private' }] }]]) {
    const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal(output)]) }).turn(request());
    assert.equal(result.status, 'failed'); assert.deepEqual(result.output, []); assert.equal(result.possibleCharge, true);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
  }
});

test('incomplete/failed terminal responses preserve observed usage and never release calls', async () => {
  for (const status of ['incomplete', 'failed']) {
    const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal([call], status)]) }).turn(request());
    assert.equal(result.status, 'failed'); assert.deepEqual(result.output, []); assert.equal(result.usage?.outputTokens, 10);
  }
});

test('API errors and disconnects are never automatically retried', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => { calls += 1; return new Response('secret provider details', { status }); } }).turn(request());
    assert.equal(calls, 1); assert.equal(result.status, status === 500 ? 'unknown' : 'failed'); assert.equal(result.usage, null); assert.deepEqual(result.output, []);
  }
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => { throw new Error(key); } }).turn(request());
  assert.equal(result.status, 'unknown'); assert.ok(!JSON.stringify(result).includes(key));
});

test('API keys are removed from returned visible text', async () => {
  const message = { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `visible ${key}` }] };
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, terminal([message])]) }).turn(request());
  assert.equal(result.status, 'completed'); assert.ok(!JSON.stringify(result).includes(key));
});

test('API keys split across visible deltas are redacted before callbacks', async () => {
  const text: string[] = [];
  const events = [created, { type: 'response.output_text.delta', delta: `before ${key.slice(0, 10)}` },
    { type: 'response.output_text.delta', delta: `${key.slice(10)} after` }, terminal([])];
  const result = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream(events) }).turn(request({ onVisibleText: value => text.push(value) }));
  assert.equal(result.status, 'completed'); assert.equal(text.join(''), 'before <redacted> after');
});

test('sequence gaps and mismatched terminal response IDs fail closed', async () => {
  const badSequence = `data: ${JSON.stringify({ ...created, sequence_number: 0 })}\n\ndata: ${JSON.stringify({ ...terminal(), sequence_number: 2 })}\n\n`;
  const gap = await createResponsesDriver({ apiKey: key, fetchImpl: async () => new Response(badSequence, { headers: { 'content-type': 'text/event-stream' } }) }).turn(request());
  assert.equal(gap.status, 'unknown'); assert.equal(gap.reason, 'stream_sequence_gap');
  const ending = terminal(); ending.response.id = 'other-response';
  const mismatch = await createResponsesDriver({ apiKey: key, fetchImpl: async () => stream([created, ending]) }).turn(request());
  assert.equal(mismatch.status, 'unknown'); assert.deepEqual(mismatch.output, []);
});
