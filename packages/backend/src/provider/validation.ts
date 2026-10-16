import { randomUUID } from 'node:crypto';
import type { ProviderCheck, SetupProvider } from '@threadline/shared';
import { PROVIDERS } from './catalog.js';

/** Explicit validation only. Fixed official destinations; no repository or task data. */
export async function validateProviderKey(input: {
  provider: SetupProvider; apiKey: string; model: string; allowInferenceTest: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
  const method = input.provider === 'opencode-go' ? 'inference' : 'authenticated-metadata';
  const result = (state: ProviderCheck['state'], message: string): ProviderCheck => ({ state, message, method, checkedAt: new Date().toISOString() });
  if (method === 'inference' && !input.allowInferenceTest) return result('consent_required', 'OpenCode Go validation requires one small inference request that consumes allowance. Nothing was saved or sent.');
  const definition = PROVIDERS[input.provider];
  const path = input.provider === 'openrouter' ? '/key' : method === 'inference' ? '/chat/completions' : '/models';
  const headers: Record<string, string> = input.provider === 'anthropic'
    ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${input.apiKey}` };
  if (method === 'inference') Object.assign(headers, { 'content-type': 'application/json', 'user-agent': 'threadline/0.0.0', 'x-opencode-session': randomUUID() });
  try {
    const response = await fetchImpl(definition.baseUrl + path, { method: method === 'inference' ? 'POST' : 'GET', headers,
      redirect: 'error', signal: AbortSignal.timeout(15_000),
      ...(method === 'inference' ? { body: JSON.stringify({ model: input.model, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 32, stream: false }) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return result(response.status === 401 ? 'invalid' : response.status === 403 ? 'permission_denied' : response.status === 429 ? 'rate_limited' : 'unavailable',
        response.status === 401 ? 'The provider rejected this API key.' : response.status === 403 ? 'The provider denied access. Check key permissions or account access.' : response.status === 429 ? 'The provider rate or quota limit prevented validation. Existing settings are unchanged.' : `Provider validation returned HTTP ${response.status}. Existing settings are unchanged.`);
    }
    const reader = response.body?.getReader(); if (!reader) return result('unavailable', 'The provider returned no validation response.');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 1024 * 1024) return result('unavailable', 'The validation response exceeded its size limit.'); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return result('unavailable', 'The provider returned an unsupported validation response.');
    const b = body as Record<string, unknown>;
    const metadata = b.data !== null && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data as Record<string, unknown> : null;
    const reported = b.usage !== null && typeof b.usage === 'object' ? b.usage as Record<string, unknown> : null;
    const valid = input.provider === 'openrouter' ? metadata !== null && (typeof metadata.is_free_tier === 'boolean' || typeof metadata.limit_remaining === 'number')
      : method === 'inference' ? Array.isArray(b.choices) && b.choices.length > 0 && reported !== null && Number.isSafeInteger(reported.prompt_tokens) && Number(reported.prompt_tokens) >= 0 && Number.isSafeInteger(reported.completion_tokens) && Number(reported.completion_tokens) >= 0
      : Array.isArray(b.data) && b.data.every(x => x && typeof x === 'object' && typeof x.id === 'string');
    return valid ? result('valid', method === 'inference' ? 'Key accepted by a small inference test. Full model/tool compatibility is separate.' : 'Key accepted by the authenticated account API. Model/tool access and available credit are separate checks.')
      : result('unavailable', 'The provider response did not establish successful key validation.');
  } catch { return result('unavailable', 'Provider validation could not finish. Check connectivity and retry explicitly; existing settings are unchanged.'); }
}
