import { createHash } from 'node:crypto';
import type { ConversationItem, ProviderTurnResult, ResponsesDriver } from './responses.js';
import { MAX_PROVIDER_OUTPUT_TOKENS, type ProviderLifecycle } from './lifecycle.js';
import { validateProviderBaseUrl } from './catalog.js';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type NativeMessage = { role: 'user' | 'assistant'; content: Record<string, unknown>[] };
export function toAnthropicMessages(items: readonly ConversationItem[]): NativeMessage[] {
  const messages: NativeMessage[] = [];
  for (const item of items) {
    const role = 'role' in item ? item.role : item.type === 'function_call' ? 'assistant' : 'user';
    const block = 'role' in item ? { type: 'text', text: item.content }
      : item.type === 'function_call' ? { type: 'tool_use', id: item.call_id, name: item.name, input: JSON.parse(item.arguments) }
      : { type: 'tool_result', tool_use_id: item.call_id, content: item.output };
    let message = messages.at(-1);
    if (!message || message.role !== role) { message = { role, content: [] }; messages.push(message); }
    message.content.push(block);
  }
  return messages;
}
export function fromAnthropicMessages(value: unknown): ConversationItem[] {
  if (!Array.isArray(value)) throw new Error('Invalid durable Anthropic messages.');
  const items: ConversationItem[] = [];
  for (const message of value) {
    if (!object(message) || !['user', 'assistant'].includes(String(message.role)) || !Array.isArray(message.content)) throw new Error('Invalid durable Anthropic message.');
    for (const block of message.content) {
      if (!object(block)) throw new Error('Invalid durable Anthropic block.');
      if (block.type === 'text' && typeof block.text === 'string') items.push({ role: message.role as 'user' | 'assistant', content: block.text });
      else if (block.type === 'tool_use' && message.role === 'assistant' && typeof block.id === 'string' && typeof block.name === 'string' && object(block.input))
        items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      else if (block.type === 'tool_result' && message.role === 'user' && typeof block.tool_use_id === 'string' && typeof block.content === 'string')
        items.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.content });
      else throw new Error('Unsupported durable Anthropic block.');
    }
  }
  return items;
}

/** Native Messages API, buffered to a bounded complete response before output/tool release. */
export function createAnthropicDriver(options: { apiKey: string; baseUrl: string; fetchImpl?: typeof fetch }): ResponsesDriver {
  validateProviderBaseUrl(options.baseUrl);
  if (!options.apiKey || /\s/.test(options.apiKey)) throw new Error('A private API key is required.');
  return { async turn(request): Promise<ProviderTurnResult> {
    if (!request.model.trim() || request.model.length > 128 || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > MAX_PROVIDER_OUTPUT_TOKENS)
      throw new Error('An explicit model and bounded output are required.');
    const body = JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens, stream: false,
      messages: toAnthropicMessages(request.input), tools: request.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) });
    if (Buffer.byteLength(body) > 48_000) throw new Error('Request exceeds the defensive byte ceiling.');
    const prepared = { ...request.identity, requestBody: body, requestDigest: createHash('sha256').update(body).digest('hex'), requestBytes: Buffer.byteLength(body),
      model: request.model, maxOutputTokens: request.maxOutputTokens, inputItems: request.input.length, toolCount: request.tools.length };
    let dispatched = false, responseId: string | null = null, providerRequestId: string | null = null, usage: ProviderTurnResult['usage'] = null;
    const observe = (event: ProviderLifecycle) => { try { request.onLifecycle?.(event); } catch { /* Observation is not authority. */ } };
    const finish = (status: ProviderTurnResult['status'], reason: string, output: ConversationItem[] = []): ProviderTurnResult => {
      observe({ phase: 'settled', settled: { ...request.identity, status, reason, responseId, providerRequestId, possibleCharge: dispatched, usage } });
      return { status, reason, responseId, requestId: providerRequestId, possibleCharge: dispatched, usage, output };
    };
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    observe({ phase: 'prepared', prepared });
    if (signal.aborted) return finish('cancelled', 'cancelled_before_dispatch');
    await request.authorizeAndJournal(prepared);
    observe({ phase: 'journaled', attempt: { ...request.identity, requestDigest: prepared.requestDigest } });
    if (signal.aborted) return finish('cancelled', 'cancelled_before_dispatch');
    try {
      dispatched = true; observe({ phase: 'dispatched', attempt: { ...request.identity, requestDigest: prepared.requestDigest } });
      const response = await (options.fetchImpl ?? fetch)(options.baseUrl.replace(/\/+$/, '') + '/messages', { method: 'POST', redirect: 'error', signal,
        headers: { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body });
      providerRequestId = response.headers.get('request-id');
      if (providerRequestId?.includes(options.apiKey)) providerRequestId = null;
      observe({ phase: 'response_observed', observed: { ...request.identity, status: response.status, providerRequestId, responseId } });
      if (!response.ok) { await response.body?.cancel(); if (response.status >= 400 && response.status < 500 && ![408,409].includes(response.status)) dispatched = false;
        return finish(dispatched ? 'unknown' : 'failed', `http_${response.status}`); }
      const reader = response.body?.getReader(); if (!reader) return finish('unknown', 'missing_response');
      const parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 2 * 1024 * 1024) return finish('unknown', 'response_limit_exceeded'); parts.push(next.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const payload: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!object(payload) || payload.type !== 'message' || payload.role !== 'assistant' || typeof payload.id !== 'string' || payload.id.includes(options.apiKey) || !Array.isArray(payload.content)) return finish('unknown', 'invalid_response');
      responseId = payload.id;
      if (!object(payload.usage)) return finish('unknown', 'missing_usage');
      const u = payload.usage;
      for (const n of [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0])
        if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return finish('unknown', 'invalid_usage');
      usage = { inputTokens: Number(u.input_tokens) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0), outputTokens: Number(u.output_tokens) };
      if (payload.stop_reason === 'max_tokens') return finish('failed', 'output_limit_reached');
      if (!['end_turn', 'tool_use'].includes(String(payload.stop_reason))) return finish('unknown', 'unsupported_terminal');
      const output: ConversationItem[] = [], ids = new Set<string>(); let text = '';
      for (const block of payload.content) {
        if (!object(block)) return finish('unknown', 'invalid_content');
        if (block.type === 'text' && typeof block.text === 'string') { const safe = block.text.split(options.apiKey).join('<redacted>'); text += safe; output.push({ role: 'assistant', content: safe }); }
        else if (block.type === 'tool_use' && typeof block.id === 'string' && block.id.length <= 256 && typeof block.name === 'string' && block.name.length <= 256 && object(block.input) && !ids.has(block.id)) {
          const args = JSON.stringify(block.input); if (Buffer.byteLength(args) > 32768 || [block.id, block.name, args].some(v => v.includes(options.apiKey))) return finish('unknown', 'invalid_tool_batch');
          ids.add(block.id); output.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: args });
        } else return finish('unknown', 'unsupported_content'); // Never persist hidden reasoning blocks.
      }
      if ((payload.stop_reason === 'tool_use') !== (ids.size > 0)) return finish('unknown', 'terminal_batch_mismatch');
      if (text) request.onVisibleText(text);
      return finish('completed', 'completed', output);
    } catch { return finish(signal.aborted ? 'cancelled' : 'unknown', signal.aborted ? 'cancelled_or_timed_out' : 'transport_or_response_failed'); }
  } };
}
