import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createChatCompletionsDriver, fromChatMessages, toChatMessages } from '../src/provider/chat-completions.js';
import type { ResponsesDriver } from '../src/provider/responses.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';

const key = 'synthetic-opencode-key';
const baseUrl = 'https://opencode.ai/inference/go/openai/v1';
const chunk = (delta: unknown, finish_reason: unknown = null) => ({ id: 'chat-fixture', choices: [{ index: 0, delta, finish_reason }] });
const usage = { id: 'chat-fixture', choices: [], usage: { prompt_tokens: 174, completion_tokens: 3 } };
function stream(events: unknown[], done = true): Response {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : ''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, ++offset));
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'provider-request-fixture' } });
}
const request = (overrides: Partial<Parameters<ResponsesDriver['turn']>[0]> = {}): Parameters<ResponsesDriver['turn']>[0] => ({
  model: 'space-bunny', input: [{ role: 'user', content: 'Inspect the candidate.' }], tools: READ_ONLY_FUNCTIONS,
  maxOutputTokens: 128, identity: { logicalRequestId: 'logical-1', attemptId: 'attempt-1' },
  signal: new AbortController().signal, authorizeAndJournal: async () => {}, onVisibleText: () => {}, ...overrides,
});
const driver = (fetchImpl: typeof fetch) => createChatCompletionsDriver({ apiKey: key, baseUrl, sessionId: 'conversation-1', fetchImpl });

test('Go chat dispatch follows the exact-byte journal barrier and stable session header', async () => {
  let body = '', authorized = false;
  const phases: string[] = [];
  const result = await driver(async (url, init) => {
    assert.equal(authorized, true);
    assert.equal(url, `${baseUrl}/chat/completions`);
    assert.equal(new Headers(init?.headers).get('x-opencode-session'), 'conversation-1');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
    assert.match(new Headers(init?.headers).get('user-agent')!, /^threadline\//);
    assert.equal(String(init?.body), body);
    const parsed = JSON.parse(body);
    assert.equal(parsed.model, 'space-bunny');
    assert.equal(parsed.max_tokens, 128);
    assert.equal(parsed.tools[0].function.name, 'workspace_read');
    assert.equal(parsed.input, undefined);
    assert.ok(!body.includes(key));
    return stream([chunk({ content: 'number' }), chunk({}, 'stop'), usage]);
  }).turn(request({ onLifecycle: event => phases.push(event.phase), authorizeAndJournal: async p => {
    body = p.requestBody; authorized = true;
    assert.equal(p.requestDigest, createHash('sha256').update(body).digest('hex'));
    assert.equal(p.requestBytes, Buffer.byteLength(body));
  } }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.output, [{ role: 'assistant', content: 'number' }]);
  assert.deepEqual(result.usage, { inputTokens: 174, outputTokens: 3 });
  assert.deepEqual(phases, ['prepared', 'journaled', 'dispatched', 'response_observed', 'stream_observed', 'settled']);
});

test('a complete fragmented tool batch normalizes only after terminal evidence', async () => {
  const result = await driver(async () => stream([
    chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'workspace_read', arguments: '{"path":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"src/exporter.mjs"}' } }] }),
    chunk({}, 'tool_calls'), usage,
  ])).turn(request());
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.output, [{ type: 'function_call', call_id: 'call-1', name: 'workspace_read', arguments: '{"path":"src/exporter.mjs"}' }]);
  const history = [...request().input, ...result.output, { type: 'function_call_output' as const, call_id: 'call-1', output: '{"text":"real file"}' }];
  assert.deepEqual(fromChatMessages(toChatMessages(history)), history);
});

test('partial, truncated, changed-identity and malformed tool streams release no output', async () => {
  const cases = [
    stream([chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'workspace_read', arguments: '{}' } }] })], false),
    stream([chunk({}, 'length')]),
    stream([chunk({ content: 'x' }), { ...chunk({}, 'stop'), id: 'changed' }]),
    stream([chunk({ tool_calls: [{ index: 0, id: 'c', function: { name: 'workspace_read', arguments: '{' } }] }), chunk({}, 'tool_calls')]),
    stream([chunk({}, 'stop')], false),
  ];
  for (const response of cases) {
    const result = await driver(async () => response).turn(request());
    assert.equal(result.status, 'unknown');
    assert.equal(result.possibleCharge, true);
    assert.deepEqual(result.output, []);
  }
});

test('explicit output exhaustion with terminal usage fails without releasing partial tool calls', async () => {
  const result = await driver(async () => stream([
    chunk({ tool_calls: [{ index: 0, id: 'partial', function: { name: 'workspace_read', arguments: '{' } }] }),
    chunk({}, 'length'), usage,
  ])).turn(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'output_limit_reached');
  assert.equal(result.possibleCharge, true);
  assert.deepEqual(result.usage, { inputTokens: 174, outputTokens: 3 });
  assert.deepEqual(result.output, []);
});

test('authorization refusal and pre-cancellation never dispatch', async () => {
  let calls = 0;
  const instance = driver(async () => { calls++; throw new Error('must not run'); });
  await assert.rejects(instance.turn(request({ authorizeAndJournal: async () => { throw new Error('denied'); } })), /denied/);
  const controller = new AbortController(); controller.abort();
  const result = await instance.turn(request({ signal: controller.signal }));
  assert.equal(result.possibleCharge, false);
  assert.equal(calls, 0);
});

test('HTTP refusal and transport uncertainty have no hidden retry or invented usage', async () => {
  for (const status of [401,429,500]) {
    let calls = 0;
    const result = await driver(async () => { calls++; return new Response(key, { status }); }).turn(request());
    assert.equal(calls, 1);
    assert.equal(result.status, status === 500 ? 'unknown' : 'failed');
    assert.equal(result.possibleCharge, status === 500);
    assert.equal(result.usage, null);
    assert.ok(!JSON.stringify(result).includes(key));
  }
});

test('hidden reasoning is dropped and split credential text is redacted before callbacks', async () => {
  const visible: string[] = [];
  const result = await driver(async () => stream([
    chunk({ reasoning_content: 'private model thought', content: key.slice(0, 5) }),
    chunk({ content: key.slice(5) }), chunk({}, 'stop'), usage,
  ])).turn(request({ onVisibleText: text => visible.push(text) }));
  assert.equal(visible.join(''), '<redacted>');
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes('private model thought'));
});

test('unsafe endpoint configuration is refused before authentication or dispatch', () => {
  for (const url of ['http://remote.invalid/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret'])
    assert.throws(() => createChatCompletionsDriver({ apiKey: key, baseUrl: url, sessionId: 's' }));
});
