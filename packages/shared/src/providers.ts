/** Secrets are write-only inputs; no response exposes a key or a key fragment. */
export const SETUP_PROVIDERS = ['openai', 'anthropic', 'openrouter', 'opencode-go'] as const;
export type SetupProvider = typeof SETUP_PROVIDERS[number];
export type ProviderCheckState = 'valid' | 'invalid' | 'permission_denied' | 'rate_limited' | 'unavailable' | 'consent_required';
export interface ProviderCheck {
  readonly state: ProviderCheckState;
  readonly checkedAt: string;
  readonly method: 'authenticated-metadata' | 'inference';
  readonly message: string;
}
export interface SavedProviderView {
  readonly id: SetupProvider;
  readonly label: string;
  readonly saved: boolean;
  readonly active: boolean;
  readonly model: string | null;
  readonly validation: ProviderCheck | null;
  readonly inferenceCheckRequired: boolean;
}
export interface ProviderSettingsView {
  readonly providers: readonly SavedProviderView[];
  readonly storage: 'owner-only-file';
  readonly appliesImmediately: true;
}
export interface ConnectProviderInput {
  readonly provider: SetupProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly allowInferenceTest: boolean;
}
export function isSetupProvider(value: unknown): value is SetupProvider {
  return typeof value === 'string' && SETUP_PROVIDERS.some(id => id === value);
}
export const PROVIDER_SETTINGS_ROUTE = '/providers';
export interface ConnectProviderResult { readonly saved: boolean; readonly validation: ProviderCheck; readonly settings: ProviderSettingsView }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function isProviderCheck(v: unknown): v is ProviderCheck {
  return record(v) && ['valid','invalid','permission_denied','rate_limited','unavailable','consent_required'].includes(String(v.state)) &&
    ['authenticated-metadata','inference'].includes(String(v.method)) && typeof v.checkedAt === 'string' && Number.isFinite(Date.parse(v.checkedAt)) &&
    typeof v.message === 'string' && v.message.length <= 1024 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v.message);
}
export function isProviderSettingsView(v: unknown): v is ProviderSettingsView {
  return record(v) && v.storage === 'owner-only-file' && v.appliesImmediately === true && Array.isArray(v.providers) && v.providers.length === SETUP_PROVIDERS.length &&
    new Set(v.providers.map(p => record(p) ? p.id : null)).size === SETUP_PROVIDERS.length && v.providers.every(p => record(p) && isSetupProvider(p.id) &&
      typeof p.label === 'string' && p.label.length <= 80 && typeof p.saved === 'boolean' && typeof p.active === 'boolean' && typeof p.inferenceCheckRequired === 'boolean' &&
      (p.model === null || (typeof p.model === 'string' && p.model.length <= 128)) && (p.validation === null || isProviderCheck(p.validation)));
}
export function isConnectProviderResult(v: unknown): v is ConnectProviderResult {
  return record(v) && typeof v.saved === 'boolean' && isProviderCheck(v.validation) && isProviderSettingsView(v.settings);
}
