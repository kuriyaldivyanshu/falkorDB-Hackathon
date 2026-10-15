import assert from 'node:assert/strict';
import test from 'node:test';
import { SseDecoder } from '../dist/transport/sse.js';

const wire = 'id: 1\nevent: backend.status\ndata: {"detail":"hello"}\n\n';
const expected = [{ id: '1', event: 'backend.status', data: '{"detail":"hello"}' }];

test('SSE frames survive every possible network-chunk boundary', () => {
  for (let cut = 0; cut <= wire.length; cut += 1) {
    const decoder = new SseDecoder();
    assert.deepEqual([...decoder.push(wire.slice(0, cut)), ...decoder.push(wire.slice(cut))], expected, `cut=${cut}`);
  }
});

test('SSE frames survive one-character chunks, CRLF and multiple frames', () => {
  const decoder = new SseDecoder();
  const frames = [...(wire + wire).replaceAll('\n', '\r\n')].flatMap((char) => decoder.push(char));
  assert.deepEqual(frames, [...expected, ...expected]);
});

test('incomplete SSE input is not delivered and reset discards it', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push('data: {"partial":'), []);
  decoder.reset();
  assert.deepEqual(decoder.push(wire), expected);
});
