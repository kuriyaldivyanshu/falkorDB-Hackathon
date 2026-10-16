import { isProviderCheck, isProviderSettingsView, isConnectProviderResult, PROVIDER_SETTINGS_ROUTE, type ConnectProviderInput, type ProviderCheck, type ProviderSettingsView, type SetupProvider } from '@threadline/shared';

export interface ProviderClient {
  list(): Promise<ProviderSettingsView>;
  connect(input: ConnectProviderInput): Promise<{ saved: boolean; validation: ProviderCheck; settings: ProviderSettingsView }>;
  check(provider: SetupProvider, allowInferenceTest: boolean): Promise<ProviderCheck>;
  select(provider: SetupProvider): Promise<ProviderSettingsView>;
  remove(provider: SetupProvider): Promise<ProviderSettingsView>;
}
/** Provider key entry is transient UI input; only the coordinator persists it. */
export function createProviderClient(options: { baseUrl: string; token: string | null; fetchImpl?: typeof fetch }): ProviderClient {
  const endpoint = new URL(PROVIDER_SETTINGS_ROUTE, options.baseUrl);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) || endpoint.username || endpoint.password || !['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('Provider setup requires a loopback backend without URL credentials.');
  async function call<T>(validate: (value: unknown) => value is T, body?: unknown): Promise<T> {
    if (!options.token) throw new Error('Attach your local owner session before configuring providers.');
    let response: Response;
    try { response = await (options.fetchImpl ?? fetch)(endpoint, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${options.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new Error('Provider setup could not reach the local backend. Inspect provider status before retrying a submitted test.'); }
    if (!response.ok) {
      const message = response.status === 409 ? 'An active run or another provider operation prevents this change. Finish or cancel it first.'
        : response.status === 401 ? 'Your local owner session is unavailable or no longer authorized.'
        : response.status === 400 ? 'Check the provider, model ID and key format.' : 'Provider settings could not be saved. Check local storage permissions and backend readiness.';
      await response.body?.cancel(); throw new Error(message);
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('The backend returned an unsupported provider settings response.'); }
    if (!validate(value)) throw new Error('The backend returned an unsupported provider settings response.');
    return value;
  }
  return { list: () => call(isProviderSettingsView), connect: input => call(isConnectProviderResult, { action: 'connect', ...input }),
    check: (provider, allowInferenceTest) => call(isProviderCheck, { action: 'check', provider, allowInferenceTest }),
    select: provider => call(isProviderSettingsView, { action: 'select', provider }), remove: provider => call(isProviderSettingsView, { action: 'remove', provider }) };
}
