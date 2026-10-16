import { createHash } from 'node:crypto';
import type { ConversationItem, ResponsesDriver, ProviderTurnResult } from './responses.js';
import type { ProviderLifecycle, PreparedAttempt } from './lifecycle.js';
import { MAX_PROVIDER_OUTPUT_TOKENS } from './lifecycle.js';
import { validateProviderBaseUrl } from './catalog.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const textId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;

/** Supported conversation items only: no hidden reasoning or provider-owned threads. */
export function toChatMessages(items: readonly ConversationItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of items) {
    if ('role' in item) { messages.push({ role: item.role, content: item.content }); continue; }
    if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output }); continue;
    }
    let assistant = messages.at(-1);
    if (!assistant || assistant.role !== 'assistant') { assistant = { role: 'assistant', content: null }; messages.push(assistant); }
    assistant.tool_calls ??= [];
    assistant.tool_calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
  }
  return messages;
}

/** Restores normalized caller-owned history from the exact submitted chat body. */
export function fromChatMessages(value: unknown): ConversationItem[] {
  if (!Array.isArray(value)) throw new Error('Durable chat messages are unavailable.');
  const items: ConversationItem[] = [];
  for (const raw of value) {
    if (!object(raw)) throw new Error('Invalid durable chat message.');
    if (raw.role === 'tool' && textId(raw.tool_call_id) && typeof raw.content === 'string') {
      items.push({ type: 'function_call_output', call_id: raw.tool_call_id, output: raw.content }); continue;
    }
    if (raw.role !== 'user' && raw.role !== 'assistant') throw new Error('Unsupported durable chat role.');
    if (typeof raw.content === 'string' && (raw.content.length > 0 || raw.role === 'user')) items.push({ role: raw.role, content: raw.content });
    else if (raw.content !== null) throw new Error('Unsupported durable chat content.');
    if (raw.tool_calls !== undefined) {
      if (raw.role !== 'assistant' || !Array.isArray(raw.tool_calls)) throw new Error('Invalid durable tool batch.');
      for (const call of raw.tool_calls) {
        if (!object(call) || !textId(call.id) || call.type !== 'function' || !object(call.function) || !textId(call.function.name) || typeof call.function.arguments !== 'string')
          throw new Error('Invalid durable tool call.');
        items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
  }
  return items;
}

/** Bounded OpenAI-compatible SSE transport; shares the existing durable guard contract. */
export function createChatCompletionsDriver(options: {
  apiKey: string; baseUrl: string; sessionId: string; timeoutMs?: number; fetchImpl?: typeof fetch;
}): ResponsesDriver {
  validateProviderBaseUrl(options.baseUrl);
  if (!options.apiKey || /\s/.test(options.apiKey) || !textId(options.sessionId) || /[\r\n]/.test(options.sessionId)) throw new Error('A private API key and stable session ID are required.');
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid provider timeout.');
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const redact = (text: string) => text.split(options.apiKey).join('<redacted>');
  return { async turn(request): Promise<ProviderTurnResult> {
    if (!textId(request.model) || !textId(request.identity.logicalRequestId) || !textId(request.identity.attemptId) ||
      !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > MAX_PROVIDER_OUTPUT_TOKENS)
      throw new Error('Explicit model, attempt identity and bounded output are required.');
    const body = JSON.stringify({ model: request.model, messages: toChatMessages(request.input),
      tools: request.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      max_tokens: request.maxOutputTokens, stream: true, stream_options: { include_usage: true }, parallel_tool_calls: false });
    if (Buffer.byteLength(body) > 48_000) throw new Error('The serialized request exceeds the defensive byte ceiling.');
    const prepared: PreparedAttempt = { ...request.identity, requestBody: body, requestDigest: createHash('sha256').update(body).digest('hex'),
      requestBytes: Buffer.byteLength(body), model: request.model, maxOutputTokens: request.maxOutputTokens,
      inputItems: request.input.length, toolCount: request.tools.length };
    const observe = (event: ProviderLifecycle) => { try { request.onLifecycle?.(event); } catch { /* Observation never dispatches work. */ } };
    let dispatched = false, responseId: string | null = null, providerRequestId: string | null = null;
    let usage: ProviderTurnResult['usage'] = null;
    const finish = (status: ProviderTurnResult['status'], reason: string, output: ConversationItem[] = []): ProviderTurnResult => {
      observe({ phase: 'settled', settled: { ...request.identity, status, reason, responseId, providerRequestId, possibleCharge: dispatched, usage } });
      return { status, reason, responseId, requestId: providerRequestId, possibleCharge: dispatched, usage, output };
    };
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    observe({ phase: 'prepared', prepared });
    if (signal.aborted) return finish('cancelled', 'cancelled_before_dispatch');
    await request.authorizeAndJournal(prepared);
    observe({ phase: 'journaled', attempt: { ...request.identity, requestDigest: prepared.requestDigest } });
    if (signal.aborted) return finish('cancelled', 'cancelled_before_dispatch');
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let pendingText = '', visible = '';
    const emit = (text: string, flush = false) => {
      const clean = redact(pendingText + text);
      let held = 0;
      if (!flush) for (let n = Math.min(options.apiKey.length - 1, clean.length); n > 0; n--) {
        if (clean.endsWith(options.apiKey.slice(0, n))) { held = n; break; }
      }
      const delta = clean.slice(0, clean.length - held);
      pendingText = clean.slice(clean.length - held);
      visible += delta;
      if (delta) request.onVisibleText(delta);
    };
    try {
      dispatched = true;
      observe({ phase: 'dispatched', attempt: { ...request.identity, requestDigest: prepared.requestDigest } });
      const response = await (options.fetchImpl ?? fetch)(endpoint, { method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream',
          'user-agent': 'threadline/0.0.0-m02', 'x-opencode-session': options.sessionId }, body });
      providerRequestId = response.headers.get('x-request-id');
      if (providerRequestId?.includes(options.apiKey)) providerRequestId = null;
      observe({ phase: 'response_observed', observed: { ...request.identity, status: response.status, providerRequestId, responseId } });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status >= 400 && response.status < 500 && ![408,409].includes(response.status)) dispatched = false;
        return finish(dispatched ? 'unknown' : 'failed', `http_${response.status}`);
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return finish('unknown', 'unsupported_response');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let buffer = '', size = 0, reason: string | null = null, done = false, frames = 0;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2 * 1024 * 1024) return finish('unknown', 'stream_limit_exceeded');
        buffer += decoder.decode(chunk.value, { stream: true });
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (!boundary || boundary.index === undefined) break;
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (Buffer.byteLength(frame) > 256 * 1024) return finish('unknown', 'frame_limit_exceeded');
          const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data === '[DONE]') { done = true; break; }
          const event: unknown = JSON.parse(data);
          if (!object(event) || !textId(event.id) || event.id.includes(options.apiKey) || !Array.isArray(event.choices) || (responseId !== null && responseId !== event.id))
            return finish('unknown', 'invalid_stream_identity');
          responseId = event.id;
          if (++frames === 1) observe({ phase: 'stream_observed', observed: { ...request.identity, responseId, events: frames } });
          if (event.usage !== undefined && event.usage !== null) {
            if (!object(event.usage) || !Number.isSafeInteger(event.usage.prompt_tokens) || !Number.isSafeInteger(event.usage.completion_tokens) ||
                Number(event.usage.prompt_tokens) < 0 || Number(event.usage.completion_tokens) < 0) return finish('unknown', 'invalid_usage');
            usage = { inputTokens: Number(event.usage.prompt_tokens), outputTokens: Number(event.usage.completion_tokens) };
          }
          if (event.choices.length > 1) return finish('unknown', 'multiple_choices_unsupported');
          for (const choice of event.choices) {
            if (!object(choice) || choice.index !== 0 || !object(choice.delta)) return finish('unknown', 'invalid_choice');
            const delta = choice.delta;
            if (delta.content !== undefined && delta.content !== null) {
              if (typeof delta.content !== 'string' || reason !== null) return finish('unknown', 'invalid_text_delta');
              emit(delta.content);
            }
            // reasoning_content is deliberately never emitted, retained or reconstructed.
            if (delta.tool_calls !== undefined) {
              if (!Array.isArray(delta.tool_calls) || reason !== null) return finish('unknown', 'invalid_tool_delta');
              for (const part of delta.tool_calls) {
                if (!object(part) || !Number.isInteger(part.index) || Number(part.index) < 0 || Number(part.index) >= 16)
                  return finish('unknown', 'invalid_tool_index');
                const index = Number(part.index);
                const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
                if (part.id !== undefined) { if (!textId(part.id) || (call.id && call.id !== part.id)) return finish('unknown', 'tool_identity_changed'); call.id = part.id; }
                if (part.type !== undefined && part.type !== 'function') return finish('unknown', 'unsupported_tool_type');
                if (part.function !== undefined) {
                  if (!object(part.function)) return finish('unknown', 'invalid_function');
                  if (part.function.name !== undefined) { if (typeof part.function.name !== 'string') return finish('unknown', 'invalid_function_name'); call.name += part.function.name; }
                  if (part.function.arguments !== undefined) { if (typeof part.function.arguments !== 'string') return finish('unknown', 'invalid_function_arguments'); call.arguments += part.function.arguments; }
                }
                if (call.name.length > 256 || Buffer.byteLength(call.arguments) > 32 * 1024) return finish('unknown', 'tool_call_limit');
                calls.set(index, call);
              }
            }
            if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
              if (reason !== null || typeof choice.finish_reason !== 'string') return finish('unknown', 'duplicate_terminal');
              reason = choice.finish_reason;
            }
          }
        }
        if (Buffer.byteLength(buffer) > 256 * 1024) return finish('unknown', 'frame_limit_exceeded');
      }
      if (!done || reason === null) return finish('unknown', 'incomplete_stream');
      // Explicit terminal exhaustion with observed usage is a known failed
      // turn, not an uncertain send. Never release its partial tool batch.
      if (reason === 'length' && usage !== null) return finish('failed', 'output_limit_reached');
      if (reason !== 'stop' && reason !== 'tool_calls') return finish('unknown', `incomplete_${reason}`);
      if ((reason === 'tool_calls') !== (calls.size > 0)) return finish('unknown', 'terminal_batch_mismatch');
      const output: ConversationItem[] = [];
      emit('', true);
      if (visible) output.push({ role: 'assistant', content: visible });
      const ids = new Set<string>();
      for (let index = 0; index < calls.size; index++) {
        const call = calls.get(index);
        if (!call || !textId(call.id) || !textId(call.name) || ids.has(call.id) || call.id.includes(options.apiKey) || call.name.includes(options.apiKey) || call.arguments.includes(options.apiKey) || !object(JSON.parse(call.arguments)))
          return finish('unknown', 'invalid_terminal_tool_batch');
        ids.add(call.id);
        output.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
      }
      return finish('completed', 'completed', output);
    } catch { return finish(signal.aborted ? 'cancelled' : 'unknown', signal.aborted ? 'cancelled_or_timed_out' : 'transport_or_stream_failed'); }
    finally { try { await reader?.cancel(); } catch { /* Never mask the outcome. */ } reader?.releaseLock(); }
  } };
}
