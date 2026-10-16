import type { BackendConfig } from '../config.js';
import { createCredentialVault } from './credentials.js';
import { PROVIDERS } from './catalog.js';

/** Saved explicit selection wins over legacy environment configuration. No network access. */
export function loadSavedProviderConfig(config: BackendConfig, directory: string): { config: BackendConfig; revision?: string } {
  const saved = createCredentialVault(directory).read();
  if (!saved) return { config };
  const account = saved.active ? saved.accounts[saved.active] : undefined;
  const definition = saved.active ? PROVIDERS[saved.active] : PROVIDERS.openai;
  return { config: { ...config, storage: { ...config.storage, providerId: definition.id, providerApi: definition.api,
    providerBaseUrl: definition.baseUrl, providerApiKey: account?.apiKey ?? '', providerModel: account?.model ?? '' } },
    ...(account ? { revision: account.revision } : {}) };
}
