import assert from 'node:assert/strict';
import test from 'node:test';

import { ThreadlineError } from '@threadline/shared';

import {
  CONSERVATIVE_BYTES_PER_TOKEN,
  decideTurnBudget,
  estimateRequestTokens,
  readModelCapacity,
  requireCapacity,
} from '../src/storage/budget.js';

/** A conversation-shaped body, which is what the driver actually serializes. */
function body(items: readonly string[]): string {
  return JSON.stringify({
    model: 'fixture-model',
    input: items.map((text) => ({ role: 'user', content: text })),
    tools: [{ name: 'read_file', parameters: { type: 'object' } }],
    max_output_tokens: 256,
  });
}

test('the token estimate is an upper bound, not a measured count', () => {
  const small = estimateRequestTokens(body(['hi']));
  const large = estimateRequestTokens(body(['hi'.repeat(4000)]));

  assert.ok(large.tokens > small.tokens);
  assert.equal(small.method, 'conservative-bytes');
  // Never fewer than one token per byte-pair, so it cannot under-reserve.
  assert.ok(small.tokens >= Math.ceil(small.bytes / CONSERVATIVE_BYTES_PER_TOKEN));
});

test('structural overhead is counted per conversation item', () => {
  const one = estimateRequestTokens(body(['a']));
  const many = estimateRequestTokens(body(['a', 'b', 'c', 'd']));

  assert.ok(many.tokens > one.tokens, 'more items must reserve more');
  // Three more items must cost more than their raw byte share alone, because
  // each item also carries structural overhead the byte count cannot see.
  const byteShareOnly = Math.ceil(many.bytes / CONSERVATIVE_BYTES_PER_TOKEN) -
    Math.ceil(one.bytes / CONSERVATIVE_BYTES_PER_TOKEN);
  assert.ok(many.tokens - one.tokens > byteShareOnly, 'per-item overhead must be added');
});

test('a body with no input array does not invent items', () => {
  assert.equal(estimateRequestTokens('{"model":"m"}').tokens >= 1, true);
});

test('capacity is read only from declared profile settings', () => {
  const declared = readModelCapacity({ contextWindowTokens: 128_000, maxOutputTokens: 4096 });
  assert.equal(declared?.contextWindowTokens, 128_000);
  assert.equal(declared?.maxOutputTokens, 4096);
  assert.equal(declared?.source, 'declared-profile');

  // Partial or nonsensical declarations establish nothing.
  assert.equal(readModelCapacity({ maxOutputTokens: 4096 }), null);
  assert.equal(readModelCapacity({ contextWindowTokens: 0, maxOutputTokens: 4096 }), null);
  assert.equal(readModelCapacity({ contextWindowTokens: -1, maxOutputTokens: 4096 }), null);
  assert.equal(readModelCapacity({ contextWindowTokens: 1.5, maxOutputTokens: 4096 }), null);
  assert.equal(readModelCapacity({}), null);
});

test('an undeclared capacity fails closed instead of guessing', () => {
  assert.throws(
    () => requireCapacity(null),
    (error: unknown) => {
      assert.ok(error instanceof ThreadlineError);
      assert.equal(error.details?.['reason'], 'capacity_not_established');
      return true;
    },
  );
});

test('a request larger than the declared context window is refused', () => {
  const capacity = { contextWindowTokens: 1_000, maxOutputTokens: 256, source: 'declared-profile' as const };
  assert.throws(
    () =>
      decideTurnBudget({
        requestBody: body(['x'.repeat(20_000)]),
        capacity,
        runMaxTotalTokens: 1_000_000,
        reservedTokens: 0,
        observedTokens: 0,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ThreadlineError);
      assert.equal(error.details?.['reason'], 'context_window_exceeded');
      return true;
    },
  );
});

test('a request that fits the window reserves input plus the maximum output', () => {
  const capacity = { contextWindowTokens: 128_000, maxOutputTokens: 512, source: 'declared-profile' as const };
  const decision = decideTurnBudget({
    requestBody: body(['hello world']),
    capacity,
    runMaxTotalTokens: 1_000_000,
    reservedTokens: 0,
    observedTokens: 0,
  });

  assert.equal(decision.reservedTokens, decision.estimate.tokens + 256);
  assert.ok(decision.contextWindowHeadroom > 0);
});

test('budget already held by the run counts against the next turn', () => {
  const capacity = { contextWindowTokens: 128_000, maxOutputTokens: 256, source: 'declared-profile' as const };
  const requestBody = body(['a turn']);

  const fits = decideTurnBudget({
    requestBody,
    capacity,
    runMaxTotalTokens: 10_000,
    reservedTokens: 100,
    observedTokens: 100,
  });
  assert.ok(fits.reservedTokens > 0);

  assert.throws(
    () =>
      decideTurnBudget({
        requestBody,
        capacity,
        runMaxTotalTokens: fits.reservedTokens + 10,
        reservedTokens: fits.reservedTokens,
        observedTokens: 0,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ThreadlineError);
      assert.equal(error.details?.['reason'], 'max_total_tokens');
      return true;
    },
  );
});

test('observed usage blocks the next turn even when no reservation is outstanding', () => {
  const capacity = { contextWindowTokens: 128_000, maxOutputTokens: 256, source: 'declared-profile' as const };
  const requestBody = body(['a turn']);
  const baseline = decideTurnBudget({
    requestBody,
    capacity,
    runMaxTotalTokens: 10_000,
    reservedTokens: 0,
    observedTokens: 0,
  });

  assert.throws(
    () =>
      decideTurnBudget({
        requestBody,
        capacity,
        runMaxTotalTokens: baseline.reservedTokens,
        reservedTokens: 0,
        observedTokens: baseline.reservedTokens,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ThreadlineError);
      assert.equal(error.details?.['reason'], 'max_total_tokens');
      return true;
    },
  );
});
test('chat-completions budgets its exact messages and max_tokens ceiling', () => {
  const requestBody = JSON.stringify({ model: 'space-bunny', messages: [{ role: 'user', content: 'Inspect the candidate.' }], max_tokens: 128 });
  const decision = decideTurnBudget({ requestBody, capacity: { contextWindowTokens: 12_000, maxOutputTokens: 1500, source: 'declared-profile' },
    runMaxTotalTokens: 120_000, reservedTokens: 0, observedTokens: 0 });
  assert.equal(decision.reservedTokens, estimateRequestTokens(requestBody).tokens + 128);
  assert.ok(decision.estimate.tokens > Buffer.byteLength(requestBody), 'message framing counts for chat too');
});
