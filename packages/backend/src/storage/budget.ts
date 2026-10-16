import { ThreadlineError } from '@threadline/shared';

/**
 * Whole-input budget for one provider turn.
 *
 * Three separate quantities are kept apart, because conflating them is how a
 * run ends up believing it has capacity it does not:
 *
 * - **request digest** — SHA-256 over the exact bytes this transport sends.
 * - **artifact content digest** — SHA-256 over the stored bytes. Equal to the
 *   request digest when the stored bytes are the transmitted bytes, which is
 *   what the journal enforces.
 * - **profile config digest** — SHA-256 over the immutable admitted profile
 *   configuration. Changes when the profile does, never when a request does.
 *
 * The driver also carries `policy_digest`, which changes when the run policy
 * does. None of these may stand in for another.
 *
 * ## Token counting
 *
 * There is no tokenizer dependency here, and a byte count is not a token count.
 * This module therefore uses a deliberately conservative **upper bound** and
 * says so: `bytes` tokens, plus framing overhead; this is a reservation estimate for
 * JSON text, not measured provider token usage. Under-reserving is the failure
 * that costs money, so the bound errs high.
 *
 * This is a reservation basis, never evidence that a model accepted the input,
 * and never evidence of a model's real context capacity. Capacity itself is
 * declared by the admitted profile; when it is absent, production fails closed.
 */

/** Bytes per token in the conservative upper-bound estimate. */
export const CONSERVATIVE_BYTES_PER_TOKEN = 1;

/** Per-message structural overhead the estimate adds on top of the payload. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

export interface ModelCapacity {
  /** Effective context window the admitted profile declares. */
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  /** Always `declared-profile`: there is no assumed capacity in this module. */
  readonly source: 'declared-profile';
}

/**
 * Reads the effective capacity from an admitted profile's settings.
 *
 * A test-fixture profile is not exempt: it declares its window like any other
 * profile, so the same budget path is exercised in tests as in production.
 */
export function readModelCapacity(
  settings: Readonly<Record<string, unknown>>,
): ModelCapacity | null {
  const window = settings['contextWindowTokens'];
  const output = settings['maxOutputTokens'];
  if (typeof window !== 'number' || !Number.isSafeInteger(window) || window <= 0) {
    return null;
  }
  if (typeof output !== 'number' || !Number.isSafeInteger(output) || output <= 0) {
    return null;
  }
  return { contextWindowTokens: window, maxOutputTokens: output, source: 'declared-profile' };
}

export interface TokenEstimate {
  readonly bytes: number;
  /** Conservative upper bound, never a measured count. */
  readonly tokens: number;
  readonly method: 'conservative-bytes';
}

export function estimateRequestTokens(requestBody: string): TokenEstimate {
  const bytes = Buffer.byteLength(requestBody, 'utf8');
  const structured = Math.ceil(bytes / CONSERVATIVE_BYTES_PER_TOKEN);
  // A conversation is a list of items; each carries structural overhead the
  // raw byte count cannot see. Counting the top-level array members keeps the
  // estimate honest for empty-but-many-item inputs.
  const items = countTopLevelItems(requestBody);
  return {
    bytes,
    tokens: structured + items * PER_MESSAGE_OVERHEAD_TOKENS,
    method: 'conservative-bytes',
  };
}

function countTopLevelItems(body: string): number {
  const value: unknown = JSON.parse(body);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
  const request = value as Record<string, unknown>;
  const items = request['input'] ?? request['messages'];
  return Array.isArray(items) ? items.length : 0;
}

export interface BudgetRequest {
  readonly requestBody: string;
  readonly capacity: ModelCapacity;
  readonly runMaxTotalTokens: number;
  readonly reservedTokens: number;
  readonly observedTokens: number;
}

export interface BudgetDecision {
  readonly estimate: TokenEstimate;
  /** Whole-input upper bound plus the maximum this turn can emit. */
  readonly reservedTokens: number;
  readonly contextWindowHeadroom: number;
}

/**
 * Decides the reservation for one turn, or refuses.
 *
 * Refusal is the correct outcome whenever capacity is unknown or the turn does
 * not fit. Nothing here guesses a model's limits.
 */
export function decideTurnBudget(request: BudgetRequest): BudgetDecision {
  const { capacity } = request;
  const estimate = estimateRequestTokens(request.requestBody);
  const payload = JSON.parse(request.requestBody);
  const output: unknown = payload.max_output_tokens ?? payload.max_tokens;
  if (typeof output !== 'number' || !Number.isSafeInteger(output) || output < 1 || output > capacity.maxOutputTokens)
    throw new ThreadlineError('authority_conflict', 'The request exceeds the admitted profile output limit.', { reason: 'max_output_tokens' });
  const maxOutput = output;
  if (estimate.tokens + maxOutput > capacity.contextWindowTokens) {
    throw new ThreadlineError(
      'authority_conflict',
      'The prepared request does not fit the admitted profile context window.',
      {
        reason: 'context_window_exceeded',
        estimatedInputTokens: estimate.tokens,
        maxOutputTokens: maxOutput,
        contextWindowTokens: capacity.contextWindowTokens,
      },
    );
  }
  const reservedTokens = estimate.tokens + maxOutput;
  const alreadyHeld = request.reservedTokens + request.observedTokens;
  if (alreadyHeld + reservedTokens > request.runMaxTotalTokens) {
    throw new ThreadlineError(
      'authority_conflict',
      'The run does not have budget for another turn.',
      {
        reason: 'max_total_tokens',
        reservedTokens: request.reservedTokens,
        observedTokens: request.observedTokens,
        requestedTokens: reservedTokens,
        maxTotalTokens: request.runMaxTotalTokens,
      },
    );
  }
  return {
    estimate,
    reservedTokens,
    contextWindowHeadroom: capacity.contextWindowTokens - (estimate.tokens + maxOutput),
  };
}

/**
 * Refuses to dispatch when the admitted profile declares no usable capacity.
 *
 * There is deliberately no fallback: a run that cannot state its own limits
 * must not be allowed to guess at them.
 */
export function requireCapacity(capacity: ModelCapacity | null): ModelCapacity {
  if (capacity !== null) {
    return capacity;
  }
  throw new ThreadlineError(
    'unauthorized',
    'The admitted provider profile declares no effective context window; dispatch fails closed.',
    { reason: 'capacity_not_established' },
  );
}
