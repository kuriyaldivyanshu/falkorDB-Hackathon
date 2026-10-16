/** Small provider records, following Pi's separation of provider identity and wire API. */
export type ProviderApi = 'responses' | 'chat-completions' | 'anthropic-messages';
export type ProviderId = 'openai' | 'anthropic' | 'openrouter' | 'opencode-go' | 'openai-compatible';
export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly keyEnv: string;
}
export const PROVIDERS: Readonly<Record<ProviderId, ProviderDefinition>> = Object.freeze({
  openai: { id: 'openai', api: 'responses', baseUrl: 'https://api.openai.com/v1', keyEnv: 'THREADLINE_OPENAI_API_KEY' },
  anthropic: { id: 'anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', keyEnv: 'THREADLINE_ANTHROPIC_API_KEY' },
  openrouter: { id: 'openrouter', api: 'chat-completions', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'THREADLINE_OPENROUTER_API_KEY' },
  'opencode-go': { id: 'opencode-go', api: 'chat-completions', baseUrl: 'https://opencode.ai/inference/go/openai/v1', keyEnv: 'MODEL_OPENCODE_API_KEY' },
  'openai-compatible': { id: 'openai-compatible', api: 'chat-completions', baseUrl: '', keyEnv: 'THREADLINE_PROVIDER_API_KEY' },
});

/** Explicit endpoint configuration is coordinator-owned, never model input. */
export function validateProviderBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTPS base URL (or loopback HTTP), without credentials, query or fragment.');
}
