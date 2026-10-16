import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAnthropicDriver, fromAnthropicMessages, toAnthropicMessages } from '../src/provider/anthropic.js';
import type { ConversationItem, ResponsesDriver } from '../src/provider/responses.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';
const key = 'synthetic-anthropic-secret';
const request = (overrides: Partial<Parameters<ResponsesDriver['turn']>[0]> = {}): Parameters<ResponsesDriver['turn']>[0] => ({ model: 'claude-test', input: [{ role: 'user', content: 'Inspect demo.' }], tools: READ_ONLY_FUNCTIONS,
 maxOutputTokens: 4096, identity: { logicalRequestId: 'logical-1', attemptId: 'physical-1' }, signal: new AbortController().signal, authorizeAndJournal: async () => {}, onVisibleText: () => {}, ...overrides });
function reply(content: unknown[], reason = 'end_turn', usage: unknown = { input_tokens: 20, output_tokens: 4 }) { return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', content, stop_reason: reason, usage }); }
const instance = (fetchImpl: typeof fetch) => createAnthropicDriver({ apiKey: key, baseUrl: 'https://api.anthropic.com/v1', fetchImpl });

test('native Anthropic headers and exact submitted bytes follow the durable journal barrier', async () => {
 let bytes = '', journaled = false; const phases: string[] = [];
 const result = await instance(async (url, init) => {
  assert.ok(journaled); assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); assert.equal(String(init?.body), bytes);
  assert.equal(new Headers(init?.headers).get('x-api-key'), key); assert.equal(new Headers(init?.headers).get('anthropic-version'), '2023-06-01');
  const body = JSON.parse(bytes); assert.equal(body.stream, false); assert.ok(body.tools[0].input_schema); assert.ok(!bytes.includes(key));
  return reply([{ type: 'text', text: 'Observed candidate.' }]);
 }).turn(request({ authorizeAndJournal: async p => { bytes = p.requestBody; journaled = true; assert.equal(p.requestDigest, createHash('sha256').update(bytes).digest('hex')); }, onLifecycle: e => phases.push(e.phase) }));
 assert.equal(result.status, 'completed'); assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 4 }); assert.deepEqual(result.output, [{ role: 'assistant', content: 'Observed candidate.' }]);
 assert.deepEqual(phases, ['prepared','journaled','dispatched','response_observed','settled']);
});

test('native tool use/result history round trips and cached input is included in reported accounting', async () => {
 const result = await instance(async () => reply([{ type: 'tool_use', id: 'tool_1', name: 'workspace_read', input: { path: 'src/exporter.mjs' } }], 'tool_use', { input_tokens: 20, output_tokens: 4, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 })).turn(request());
 assert.equal(result.status, 'completed'); assert.deepEqual(result.usage, { inputTokens: 35, outputTokens: 4 });
 const history: ConversationItem[] = [...request().input, ...result.output, { type: 'function_call_output', call_id: 'tool_1', output: '{"text":"authored"}' }];
 assert.deepEqual(fromAnthropicMessages(toAnthropicMessages(history)), history);
});

test('partial/hidden/duplicate/mismatched batches release no tools or hidden reasoning', async () => {
 for (const response of [reply([{ type: 'thinking', thinking: 'hidden reasoning' }]), reply([{ type: 'tool_use', id: 't', name: 'workspace_read', input: {} }]), reply([], 'tool_use'), reply([], 'end_turn', null), reply([], 'end_turn', { input_tokens: -1, output_tokens: 2 })]) {
  const result = await instance(async () => response).turn(request()); assert.equal(result.status, 'unknown'); assert.deepEqual(result.output, []); assert.ok(!JSON.stringify(result).includes('hidden reasoning'));
 }
 const limited = await instance(async () => reply([{ type: 'tool_use', id: 't', name: 'workspace_read', input: {} }], 'max_tokens')).turn(request());
 assert.equal(limited.status, 'failed'); assert.deepEqual(limited.output, []); assert.equal(limited.reason, 'output_limit_reached');
});

test('pre-dispatch refusal sends nothing, provider failures never retry, credentials are redacted', async () => {
 let calls = 0; const driver = instance(async () => { calls++; return new Response(key, { status: 401 }); });
 await assert.rejects(driver.turn(request({ authorizeAndJournal: async () => { throw new Error('denied'); } }))); assert.equal(calls, 0);
 const failure = await driver.turn(request()); assert.equal(calls, 1); assert.equal(failure.status, 'failed'); assert.equal(failure.possibleCharge, false);
 const visible: string[] = [];
 const success = await instance(async () => reply([{ type: 'text', text: `never show ${key}` }])).turn(request({ onVisibleText: x => visible.push(x) }));
 assert.ok(!JSON.stringify(success).includes(key)); assert.ok(!visible.join('').includes(key));
});
