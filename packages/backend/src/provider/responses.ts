/** Narrow Responses transport. Run/claim authorization and durable journaling are caller obligations. */
import { createHash } from 'node:crypto';
import { validateProviderBaseUrl } from './catalog.js';
import { MAX_PROVIDER_OUTPUT_TOKENS } from './lifecycle.js';

import type {
  AttemptIdentity,
  DispatchedAttempt,
  ObservedHttpResponse,
  PreparedAttempt,
  ProviderLifecycle,
  ProviderLifecycleObserver,
} from './lifecycle.js';

export type {
  AttemptIdentity,
  DispatchedAttempt,
  ObservedHttpResponse,
  ObservedStream,
  PreparedAttempt,
  ProviderLifecycle,
  ProviderLifecycleObserver,
  SettledAttempt,
} from './lifecycle.js';

export type ConversationItem =
  | { role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };
export interface FunctionTool { readonly type: 'function'; readonly name: string; readonly description: string; readonly strict: true; readonly parameters: Readonly<Record<string, unknown>> }
export interface ProviderTurnResult {
  readonly status: 'completed' | 'failed' | 'unknown' | 'cancelled';
  readonly reason: string;
  readonly responseId: string | null;
  readonly requestId: string | null;
  readonly possibleCharge: boolean;
  readonly usage: { inputTokens: number; outputTokens: number } | null;
  readonly output: readonly ConversationItem[];
}
export interface ResponsesDriver {
  turn(request: {
    model: string; input: readonly ConversationItem[]; tools: readonly FunctionTool[];
    signal: AbortSignal; maxOutputTokens: number;
    /** Caller-owned durable identity, kept apart from provider and transport ids. */
    identity: AttemptIdentity;
    /**
     * Must recheck owner/profile/claim/revisions and persist the attempt and
     * reservation before returning. It receives the exact prepared identity so
     * the journal binds the same bytes this transport will send.
     */
    authorizeAndJournal: (prepared: PreparedAttempt) => Promise<void>;
    /** Observes transport facts. Never a substitute for a durable journal. */
    onLifecycle?: ProviderLifecycleObserver;
    onVisibleText: (text: string) => void;
  }): Promise<ProviderTurnResult>;
}

const MAX_STREAM_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;

/** Constructing the driver performs no network requests and reads no ambient credentials. */
export function createResponsesDriver(options: { apiKey: string; baseUrl?: string; sessionId?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): ResponsesDriver {
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  validateProviderBaseUrl(baseUrl);
  if (options.sessionId && /[\r\n]/.test(options.sessionId)) throw new Error('Invalid provider session ID.');
  if (!options.apiKey || /\s/.test(options.apiKey)) throw new Error('A coordinator-owned API key is required.');
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid provider timeout.');
  const redact = (text: string): string => text.split(options.apiKey).join('<redacted>');
  return {
    async turn(request): Promise<ProviderTurnResult> {
      const identity = request.identity;
      if (typeof identity?.logicalRequestId !== 'string' || identity.logicalRequestId.length === 0 ||
          typeof identity?.attemptId !== 'string' || identity.attemptId.length === 0)
        throw new Error('A caller-owned logicalRequestId and attemptId are required.');
      const observe = (event: ProviderLifecycle): void => { try { request.onLifecycle?.(event); } catch { /* observation must never change the turn */ } };
      if (!request.model.trim() || request.model.length > 128 || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > MAX_PROVIDER_OUTPUT_TOKENS)
        throw new Error(`An explicit compatible model and output limit from 1 to ${MAX_PROVIDER_OUTPUT_TOKENS} are required.`);
      if (Buffer.byteLength(JSON.stringify(request.input)) > 48_000) throw new Error('Submitted conversation exceeds the provisional byte limit; token accounting is still required by the coordinator.');
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      let dispatched = false, responseId: string | null = null, requestId: string | null = null;
      let usage: ProviderTurnResult['usage'] = null;
      let pendingText = '';
      const emitText = (text: string, flush = false): void => {
        const sanitized = redact(pendingText + text);
        let held = 0;
        if (!flush) {
          for (let size = Math.min(options.apiKey.length - 1, sanitized.length); size > 0; size -= 1) {
            if (sanitized.endsWith(options.apiKey.slice(0, size))) { held = size; break; }
          }
        }
        const visible = sanitized.slice(0, sanitized.length - held);
        pendingText = sanitized.slice(sanitized.length - held);
        if (visible) request.onVisibleText(visible);
      };
      const result = (status: ProviderTurnResult['status'], reason: string, output: ConversationItem[] = []): ProviderTurnResult => {
        observe({ phase: 'settled', settled: { ...identity, status, reason, responseId,
          providerRequestId: requestId, possibleCharge: dispatched, usage } });
        return { status, reason, responseId, requestId, usage, possibleCharge: dispatched, output };
      };
      // The identity digest covers the exact bytes that will be sent, so the
      // coordinator can budget and journal the same request it later sends.
      const body = JSON.stringify({ model: request.model, input: request.input, tools: request.tools,
        max_output_tokens: request.maxOutputTokens, stream: true, store: false, parallel_tool_calls: false });
      const prepared: PreparedAttempt = { ...identity,
        // The coordinator journals these exact bytes before dispatch.
        requestBody: body,
        requestDigest: createHash('sha256').update(body).digest('hex'),
        requestBytes: Buffer.byteLength(body), model: request.model, maxOutputTokens: request.maxOutputTokens,
        inputItems: request.input.length, toolCount: request.tools.length };
      observe({ phase: 'prepared', prepared });
      if (signal.aborted) return result('cancelled', 'cancelled_before_dispatch');
      // An authorization/journal failure propagates without making a paid request.
      await request.authorizeAndJournal(prepared);
      const attempt: DispatchedAttempt = { ...identity, requestDigest: prepared.requestDigest };
      observe({ phase: 'journaled', attempt });
      if (signal.aborted) return result('cancelled', 'cancelled_before_dispatch');
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        dispatched = true;
        observe({ phase: 'dispatched', attempt });
        const response = await (options.fetchImpl ?? fetch)(`${baseUrl.replace(/\/+$/, '')}/responses`, {
          method: 'POST', redirect: 'error', signal,
          headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream',
            'user-agent': 'threadline/0.0.0-m02', ...(options.sessionId ? { 'x-opencode-session': options.sessionId } : {}) },
          body,
        });
        requestId = response.headers.get('x-request-id');
        const observedHttp: ObservedHttpResponse = { ...identity, status: response.status, providerRequestId: requestId, responseId };
        observe({ phase: 'response_observed', observed: observedHttp });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          const rejected = [400, 401, 403, 404, 422, 429].includes(response.status);
          if (rejected) dispatched = false;
          return result(rejected ? 'failed' : 'unknown', `provider_http_${response.status}`);
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
          await response.body?.cancel().catch(() => {});
          return result('unknown', 'invalid_stream_handshake');
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let buffer = '', total = 0, sequence: number | null = null, streamEvents = 0;
        for (;;) {
          const chunk = await reader.read();
          if (signal.aborted) return result('unknown', 'cancelled_after_dispatch');
          if (chunk.done) return result('unknown', 'stream_ended_without_terminal_response');
          total += chunk.value.byteLength;
          if (total > MAX_STREAM_BYTES) return result('unknown', 'stream_limit_exceeded');
          buffer += decoder.decode(chunk.value, { stream: true });
          for (;;) {
            const boundary = /\r?\n\r?\n/.exec(buffer);
            if (!boundary || boundary.index === undefined) break;
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) return result('unknown', 'frame_limit_exceeded');
            const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (!data) continue;
            const event: unknown = JSON.parse(data);
            if (!object(event) || typeof event.type !== 'string' || typeof event.sequence_number !== 'number' || !Number.isSafeInteger(event.sequence_number))
              return result('unknown', 'invalid_stream_event');
            if (event.sequence_number < 0 || (sequence !== null && event.sequence_number !== sequence + 1)) return result('unknown', 'stream_sequence_gap');
            sequence = event.sequence_number;
            if (streamEvents === 0) { streamEvents += 1; observe({ phase: 'stream_observed', observed: { ...identity, responseId, events: streamEvents } }); }
            if (event.type === 'response.output_text.delta') {
              if (typeof event.delta !== 'string') return result('unknown', 'invalid_text_delta');
              emitText(event.delta);
            }
            // Partial function arguments and hidden reasoning are never returned as executable work.
            if (event.type === 'response.created' && object(event.response) && identifier(event.response.id)) responseId = event.response.id;
            if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
              if (!object(event.response) || !identifier(event.response.id)) return result('unknown', 'invalid_terminal_response');
              const terminal = event.response;
              if (responseId !== null && terminal.id !== responseId) return result('unknown', 'response_identity_mismatch');
              responseId = terminal.id as string;
              if (object(terminal.usage) && typeof terminal.usage.input_tokens === 'number' && typeof terminal.usage.output_tokens === 'number' &&
                  Number.isSafeInteger(terminal.usage.input_tokens) && terminal.usage.input_tokens >= 0 && Number.isSafeInteger(terminal.usage.output_tokens) && terminal.usage.output_tokens >= 0)
                usage = { inputTokens: terminal.usage.input_tokens, outputTokens: terminal.usage.output_tokens };
              if (event.type !== 'response.completed') return result('failed', event.type === 'response.failed' ? 'provider_failed' : 'provider_incomplete');
              if (terminal.status !== 'completed' || usage === null || !Array.isArray(terminal.output)) return result('unknown', 'incomplete_terminal_record');
              const output = visibleOutput(terminal.output, redact);
              if (output === null) return result('failed', 'unsupported_terminal_output');
              emitText('', true);
              return result('completed', 'completed', output);
            }
            if (event.type === 'error') return result('unknown', 'provider_stream_error');
          }
          if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) return result('unknown', 'frame_limit_exceeded');
        }
      } catch {
        return result('unknown', signal.aborted ? 'cancelled_after_dispatch' : 'transport_or_protocol_failure');
      } finally {
        if (reader !== null) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    },
  };
}

function visibleOutput(items: unknown[], redact: (text: string) => string): ConversationItem[] | null {
  const output: ConversationItem[] = [];
  const calls = new Set<string>();
  for (const item of items) {
    if (!object(item)) return null;
    if (item.type === 'function_call') {
      if (!identifier(item.call_id) || !identifier(item.name) || typeof item.arguments !== 'string' || item.arguments.length > 16384 ||
          item.status !== 'completed' || calls.has(item.call_id)) return null;
      let args: unknown;
      try { args = JSON.parse(item.arguments); } catch { return null; }
      if (!object(args)) return null;
      calls.add(item.call_id);
      output.push({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: redact(item.arguments) });
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) return null;
      let content = '';
      for (const part of item.content) {
        if (!object(part) || part.type !== 'output_text' || typeof part.text !== 'string') return null;
        content += redact(part.text);
      }
      output.push({ role: 'assistant', content });
    } else {
      // A model requiring private continuation items needs a separate tested profile;
      // do not silently persist reasoning or assume arbitrary model compatibility.
      return null;
    }
  }
  return output;
}
