import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { HistoryUnavailableError, rebuildNextInput, recordsForTurn, type DurableRecord } from '../src/runtime/history.js';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const message = (ordinal: number, text: string, terminal = false): DurableRecord => ({
  kind: 'assistant_message', ordinal, text, bytes: Buffer.byteLength(text), digest: sha(text), terminal,
});
const authority = (ordinal: number, text: string): DurableRecord => ({
  kind: 'authority', ordinal, text, bytes: Buffer.byteLength(text), digest: sha(text),
});
const user = (ordinal: number, text: string): DurableRecord => ({
  kind: 'user_message', ordinal, text, bytes: Buffer.byteLength(text), digest: sha(text),
});
const call = (ordinal: number, callId: string): DurableRecord => {
  const argumentsJson = JSON.stringify({ path: 'src/exporter.mjs' });
  return { kind: 'tool_call', ordinal, callId, toolName: 'workspace_read', argumentsJson,
    bytes: Buffer.byteLength(JSON.stringify({ callId, name: 'workspace_read', arguments: argumentsJson })),
    digest: sha(JSON.stringify({ callId, name: 'workspace_read', arguments: argumentsJson })) };
};
const result = (ordinal: number, callId: string, outputJson: string): DurableRecord => ({
  kind: 'tool_result', ordinal, callId, outputJson, bytes: Buffer.byteLength(outputJson), digest: sha(outputJson),
});

test('the next input is rebuilt from durable records in ordinal order', () => {
  const rebuilt = rebuildNextInput([
    authority(0, 'Current task: inventory export'),
    user(1, 'Inspect the candidate'),
    message(2, 'Reading the exporter.', false),
    call(3, 'call-1'),
    result(4, 'call-1', '{"kind":"read","text":"source"}'),
  ]);

  assert.equal(rebuilt.recordCount, 5);
  assert.match(rebuilt.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(rebuilt.items, [
    { role: 'user', content: 'Current task: inventory export' },
    { role: 'user', content: 'Inspect the candidate' },
    { role: 'assistant', content: 'Reading the exporter.' },
    { type: 'function_call', call_id: 'call-1', name: 'workspace_read', arguments: JSON.stringify({ path: 'src/exporter.mjs' }) },
    { type: 'function_call_output', call_id: 'call-1', output: '{"kind":"read","text":"source"}' },
  ]);
});

test('the same records in any arrival order rebuild the identical input and digest', () => {
  const records = [authority(0, 'authority'), user(1, 'go'), message(2, 'thinking', false), call(3, 'c'), result(4, 'c', '{"ok":1}')];
  const forward = rebuildNextInput(records);
  const backward = rebuildNextInput([...records].reverse());
  assert.deepEqual(backward.items, forward.items);
  assert.equal(backward.digest, forward.digest, 'durable order, not arrival order, defines the input');
});

test('a tool call with no durable result blocks the next turn', () => {
  assert.throws(
    () => rebuildNextInput([authority(0, 'a'), user(1, 'go'), call(2, 'call-missing')]),
    (error) => error instanceof HistoryUnavailableError && /no durable result/.test(error.message),
  );
});

test('a result with no preceding call, a duplicate call id, or duplicate ordinals block', () => {
  assert.throws(() => rebuildNextInput([user(0, 'go'), result(1, 'orphan', '{}')]),
    (error) => error instanceof HistoryUnavailableError && /no preceding durable call/.test(error.message));

  assert.throws(() => rebuildNextInput([call(0, 'dup'), call(1, 'dup')]),
    (error) => error instanceof HistoryUnavailableError && /more than once/.test(error.message));

  assert.throws(() => rebuildNextInput([user(0, 'a'), user(0, 'b')]),
    (error) => error instanceof HistoryUnavailableError && /share ordinal/.test(error.message));
});

test('a record whose bytes or digest do not match its content blocks', () => {
  assert.throws(() => rebuildNextInput([{ ...user(0, 'hello'), digest: sha('different') }]),
    (error) => error instanceof HistoryUnavailableError && /stored digest/.test(error.message));

  assert.throws(() => rebuildNextInput([{ ...user(0, 'hello'), bytes: 99 }]),
    (error) => error instanceof HistoryUnavailableError && /byte length/.test(error.message));
});

test('a trailing terminal assistant message ends inference rather than continuing it', () => {
  assert.throws(
    () => rebuildNextInput([user(0, 'go'), message(1, 'The analysis is complete.', true)]),
    (error) => error instanceof HistoryUnavailableError && /inference already ended/.test(error.message),
  );
});

test('a non-terminal trailing assistant message is still continuable', () => {
  const rebuilt = rebuildNextInput([user(0, 'go'), message(1, 'One moment.', false)]);
  assert.equal(rebuilt.items.length, 2);
});

test('an empty record set blocks rather than sending an empty turn', () => {
  assert.throws(() => rebuildNextInput([]),
    (error) => error instanceof HistoryUnavailableError && /no durable records/.test(error.message));
});

test('a turn with tools stores a non-terminal message; a turn without stores a terminal one', () => {
  const withTools = recordsForTurn({
    startOrdinal: 10,
    visibleOutput: [{ role: 'assistant', content: 'Checking the file.' }],
    toolCalls: [{ callId: 'c1', toolName: 'workspace_read', argumentsJson: '{}' }],
    toolResults: [],
  });
  assert.equal(withTools.filter(r => r.kind === 'assistant_message').length, 1);
  const assistant = withTools.find(r => r.kind === 'assistant_message');
  assert.equal(assistant?.kind === 'assistant_message' ? assistant.terminal : null, false);

  const finalOnly = recordsForTurn({
    startOrdinal: 10,
    visibleOutput: [{ role: 'assistant', content: 'Finished.' }],
    toolCalls: [],
    toolResults: [],
  });
  const terminal = finalOnly.find(r => r.kind === 'assistant_message');
  assert.equal(terminal?.kind === 'assistant_message' ? terminal.terminal : null, true);
});

test('recorded turn output is itself a valid rebuildable history', () => {
  const records = [
    authority(0, 'Current task'),
    ...recordsForTurn({
      startOrdinal: 1,
      visibleOutput: [{ role: 'assistant', content: 'Reading.' }],
      toolCalls: [{ callId: 'c1', toolName: 'workspace_read', argumentsJson: '{"path":"a.mjs"}' }],
      toolResults: [],
    }),
    ...recordsForTurn({
      startOrdinal: 3,
      visibleOutput: [],
      toolCalls: [],
      toolResults: [{ callId: 'c1', outputJson: '{"text":"source"}' }],
    }),
    ...recordsForTurn({
      startOrdinal: 4,
      visibleOutput: [{ role: 'assistant', content: 'The exporter reads the file.' }],
      toolCalls: [],
      toolResults: [],
    }),
  ];
  // The final turn is terminal, so rebuilding the *next* input must block.
  assert.throws(() => rebuildNextInput(records),
    (error) => error instanceof HistoryUnavailableError && /inference already ended/.test(error.message));

  // Dropping the terminal record leaves a continuable history.
  const continuable = rebuildNextInput(records.slice(0, 4));
  const last = continuable.items.at(-1);
  assert.ok(last !== undefined && 'type' in last && last.type === 'function_call_output',
    'the durable tool result is the last item, ready for the next provider input');
});