import { randomUUID } from 'node:crypto';
import { SETUP_PROVIDERS, ThreadlineError, type ConnectProviderInput, type ProviderSettingsView, type SetupProvider } from '@threadline/shared';
import { PROVIDERS } from './catalog.js';
import { createCredentialVault, validKey, validModel } from './credentials.js';
import { validateProviderKey } from './validation.js';
import type { ManagedRuntime } from '../runtime/managed.js';

const labels: Record<SetupProvider, string> = { openai: 'OpenAI', anthropic: 'Anthropic (Claude API)', openrouter: 'OpenRouter', 'opencode-go': 'OpenCode Go' };
export function createProviderSettings(deps: { directory: string; runtime: () => ManagedRuntime; fetchImpl?: typeof fetch }) {
  const vault = createCredentialVault(deps.directory);
  let busy = false;
  function view(): ProviderSettingsView {
    const saved = vault.read(), current = deps.runtime().configuration();
    return { storage: 'owner-only-file', appliesImmediately: true, providers: SETUP_PROVIDERS.map(id => ({ id, label: labels[id], saved: !!saved?.accounts[id],
      active: current.providerId === id && current.apiKey.length > 0, model: saved?.accounts[id]?.model ?? (current.providerId === id && current.model ? current.model : null),
      validation: saved?.accounts[id]?.lastCheck ?? saved?.accounts[id]?.validation ?? null, inferenceCheckRequired: id === 'opencode-go' })) };
  }
  return {
    view,
    async connect(input: ConnectProviderInput, beforeCommit: () => Promise<void> = async () => {}) {
      if (!validKey(input.apiKey) || !validModel(input.model) || input.model.includes(input.apiKey)) throw new ThreadlineError('invalid_request', 'Enter a valid model ID and a nonempty API key without spaces or line breaks.');
      if (busy) throw new ThreadlineError('authority_conflict', 'Another provider operation is in progress.');
      const runtime = deps.runtime(); runtime.assertConfigurable(); busy = true;
      try {
        const validation = await validateProviderKey(input, deps.fetchImpl);
        if (validation.state !== 'valid') return { saved: false, validation, settings: view() };
        await beforeCommit();
        const file = vault.read() ?? vault.empty();
        const account = { model: input.model, apiKey: input.apiKey, revision: randomUUID(), validation };
        const definition = PROVIDERS[input.provider];
        runtime.configure({ apiKey: account.apiKey, model: account.model, providerId: input.provider, providerApi: definition.api, baseUrl: definition.baseUrl, credentialRevision: account.revision },
          () => vault.write({ version: 1, active: input.provider, accounts: { ...file.accounts, [input.provider]: account } }));
        return { saved: true, validation, settings: view() };
      } finally { busy = false; }
    },
    async check(provider: SetupProvider, allowInferenceTest: boolean, beforeSave: () => Promise<void> = async () => {}) {
      if (busy) throw new ThreadlineError('authority_conflict', 'Another provider operation is in progress.');
      const file = vault.read(), account = file?.accounts[provider];
      if (!file || !account) throw new ThreadlineError('not_found', 'No saved key exists for this provider.');
      busy = true;
      try {
        const result = await validateProviderKey({ provider, apiKey: account.apiKey, model: account.model, allowInferenceTest }, deps.fetchImpl);
        if (result.state !== 'consent_required') { await beforeSave(); vault.write({ ...file, accounts: { ...file.accounts, [provider]: { ...account, lastCheck: result } } }); }
        return result;
      }
      finally { busy = false; }
    },
    select(provider: SetupProvider) {
      if (busy) throw new ThreadlineError('authority_conflict', 'Another provider operation is in progress.');
      const file = vault.read(), account = file?.accounts[provider];
      if (!file || !account) throw new ThreadlineError('not_found', 'Connect this provider before selecting it.');
      const definition = PROVIDERS[provider];
      deps.runtime().configure({ apiKey: account.apiKey, model: account.model, providerId: provider, providerApi: definition.api, baseUrl: definition.baseUrl, credentialRevision: account.revision }, () => vault.write({ ...file, active: provider }));
      return view();
    },
    remove(provider: SetupProvider) {
      if (busy) throw new ThreadlineError('authority_conflict', 'Another provider operation is in progress.');
      const file = vault.read(); if (!file?.accounts[provider]) throw new ThreadlineError('not_found', 'No saved key exists for this provider.');
      const accounts = { ...file.accounts }; delete accounts[provider];
      const runtime = deps.runtime(), config = runtime.configuration(), active = config.providerId === provider;
      runtime.configure(active ? { ...config, apiKey: '', model: '', credentialRevision: 'disconnected' } : config,
        () => vault.write({ version: 1, active: file.active === provider ? null : file.active, accounts }));
      return view();
    },
  };
}
export type ProviderSettings = ReturnType<typeof createProviderSettings>;
