/**
 * Provider transport lifecycle observations.
 *
 * These are facts the transport actually observed, not claims that the provider
 * accepted anything. The distinction matters: `dispatched` means this process
 * invoked the transport, which still leaves the request possibly unbilled,
 * possibly billed, or possibly lost in between.
 *
 * The coordinator journals these. It never infers a missing phase from a later
 * one, and it must not treat a local callback as proof of provider acceptance.
 */

/** Local harness ceiling, independent of the provider's model capacity. */
export const MAX_PROVIDER_OUTPUT_TOKENS = 4096;

/** Caller-owned identity, stable across retries and separate from provider ids. */
export interface AttemptIdentity {
  /** Durable logical request. One user-visible operation may span several attempts. */
  readonly logicalRequestId: string;
  /** Durable id of this single attempt. Never a transport `commandId`. */
  readonly attemptId: string;
}

export interface PreparedAttempt extends AttemptIdentity {
  /**
   * The exact serialized request body this transport will transmit.
   *
   * The coordinator stores these bytes verbatim and re-hashes them, so the
   * durable record and the transmitted request cannot diverge. It contains the
   * model, conversation, tool definitions and supported parameters. It never
   * contains an API key or an authorization header: those travel separately in
   * transport headers.
   */
  readonly requestBody: string;
  /** SHA-256 over `requestBody`. */
  readonly requestDigest: string;
  readonly requestBytes: number;
  readonly model: string;
  readonly maxOutputTokens: number;
  /** Number of caller-owned conversation items, including any system/authority items. */
  readonly inputItems: number;
  readonly toolCount: number;
}

export interface DispatchedAttempt extends AttemptIdentity {
  readonly requestDigest: string;
}

export interface ObservedHttpResponse extends AttemptIdentity {
  readonly status: number;
  /** `x-request-id` from the provider, or null. Not the logical request id. */
  readonly providerRequestId: string | null;
  /** Provider `response.id` when the stream reported one. */
  readonly responseId: string | null;
}

export interface ObservedStream extends AttemptIdentity {
  readonly responseId: string | null;
  readonly events: number;
}

export interface SettledAttempt extends AttemptIdentity {
  readonly status: 'completed' | 'failed' | 'unknown' | 'cancelled';
  readonly reason: string;
  readonly responseId: string | null;
  readonly providerRequestId: string | null;
  /**
   * True once the transport was invoked and the provider may have billed.
   * Pre-dispatch cancellation and authorization failure are false.
   */
  readonly possibleCharge: boolean;
  /** Observed usage only. Null means the provider did not report it; never zero-filled. */
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export type ProviderLifecycle =
  /** Intent exists locally. Nothing has been sent. */
  | { readonly phase: 'prepared'; readonly prepared: PreparedAttempt }
  /** The coordinator returned from its durable authorization/reservation/journal barrier. */
  | { readonly phase: 'journaled'; readonly attempt: DispatchedAttempt }
  /** This process invoked the transport. Not proof the provider received it. */
  | { readonly phase: 'dispatched'; readonly attempt: DispatchedAttempt }
  /** A response status line was received. */
  | { readonly phase: 'response_observed'; readonly observed: ObservedHttpResponse }
  /** The first valid stream event was parsed. */
  | { readonly phase: 'stream_observed'; readonly observed: ObservedStream }
  /** Terminal outcome for this attempt. Always the last observation. */
  | { readonly phase: 'settled'; readonly settled: SettledAttempt };

export type ProviderLifecycleObserver = (event: ProviderLifecycle) => void;

export function isProviderLifecycle(value: unknown): value is ProviderLifecycle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'phase' in value &&
    typeof (value as { phase: unknown }).phase === 'string'
  );
}
