import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, statSync, chmodSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCredentialVault } from '../src/provider/credentials.js';
import { createProviderSettings } from '../src/provider/settings.js';
import { validateProviderKey } from '../src/provider/validation.js';
import type { ManagedRuntime } from '../src/runtime/managed.js';

const key = 'synthetic-provider-secret', valid = { state: 'valid' as const, checkedAt: '2026-10-16T00:00:00Z', method: 'authenticated-metadata' as const, message: 'Key accepted.' };
const model = 'test-model';
function setup(t: test.TestContext, fetchImpl: typeof fetch) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'provider-settings-'))); t.after(() => rmSync(directory, { recursive: true, force: true }));
  let configuration = { apiKey: '', model: '', providerId: 'openai', providerApi: 'responses', baseUrl: 'https://api.openai.com/v1', credentialRevision: 'environment' };
  let busy = false;
  const assertConfigurable = () => { if (busy) throw new Error('active run'); };
  const runtime = { configuration: () => ({ ...configuration }), assertConfigurable,
    configure(next: typeof configuration, persist: () => void) { assertConfigurable(); persist(); configuration = next; } } as unknown as ManagedRuntime;
  const service = createProviderSettings({ directory, runtime: () => runtime, fetchImpl });
  return { directory, service, config: () => configuration, block: () => { busy = true; } };
}

test('each provider uses only its own authenticated destination and never forwards task data', async () => {
  for (const provider of ['openai','anthropic','openrouter','opencode-go'] as const) {
    let calls = 0;
    const result = await validateProviderKey({ provider, model, apiKey: key, allowInferenceTest: true }, async (url, init) => {
      calls++; const expected = { openai: 'https://api.openai.com/v1/models', anthropic: 'https://api.anthropic.com/v1/models', openrouter: 'https://openrouter.ai/api/v1/key', 'opencode-go': 'https://opencode.ai/inference/go/openai/v1/chat/completions' };
      assert.equal(String(url), expected[provider]); assert.equal(init?.redirect, 'error');
      const headers = new Headers(init?.headers);
      if (provider === 'anthropic') { assert.equal(headers.get('x-api-key'), key); assert.equal(headers.get('authorization'), null); }
      else assert.equal(headers.get('authorization'), `Bearer ${key}`);
      if (provider === 'opencode-go') { const b = JSON.parse(String(init?.body)); assert.equal(b.max_tokens, 32); assert.deepEqual(b.messages, [{ role: 'user', content: 'Reply OK.' }]); assert.ok(headers.get('x-opencode-session')); }
      else assert.equal(init?.body, undefined);
      return Response.json(provider === 'openrouter' ? { data: { limit_remaining: 1 } } : provider === 'opencode-go' ? { choices: [{}], usage: { prompt_tokens: 2, completion_tokens: 1 } } : { data: [{ id: model }] });
    });
    assert.equal(result.state, 'valid'); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes(key));
  }
});

test('Go tests need explicit allowance consent and never probe automatically', async () => {
  let calls = 0; const result = await validateProviderKey({ provider: 'opencode-go', model, apiKey: key, allowInferenceTest: false }, async () => { calls++; throw new Error('no'); });
  assert.equal(result.state, 'consent_required'); assert.equal(calls, 0);
});

test('validation distinguishes invalid, permission, quota, timeout and malformed replies without echoing provider bodies', async () => {
  for (const [status, expected] of [[401,'invalid'],[403,'permission_denied'],[429,'rate_limited'],[500,'unavailable']] as const) {
    const result = await validateProviderKey({ provider: 'openai', model, apiKey: key, allowInferenceTest: false }, async () => new Response(key, { status }));
    assert.equal(result.state, expected); assert.ok(!JSON.stringify(result).includes(key));
  }
  for (const response of [Response.json({ public: true }), new Response(key)]) {
    assert.equal((await validateProviderKey({ provider: 'openai', model, apiKey: key, allowInferenceTest: false }, async () => response)).state, 'unavailable');
  }
});

test('connect validates before publishing, reloads saved accounts, rotates references and returns metadata only', async t => {
  const f = setup(t, async () => Response.json({ data: [{ id: model }] }));
  assert.equal(f.service.view().providers.filter(x => x.saved).length, 0);
  const result = await f.service.connect({ provider: 'openai', model, apiKey: key, allowInferenceTest: false });
  assert.equal(result.saved, true); assert.equal(f.config().apiKey, key); assert.ok(!JSON.stringify(result).includes(key));
  assert.equal(statSync(join(f.directory, 'accounts.json')).mode & 0o777, 0o600); assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  const vault = createCredentialVault(f.directory); assert.equal(vault.read()?.accounts.openai?.apiKey, key);
  const revision = f.config().credentialRevision;
  await f.service.connect({ provider: 'openai', model, apiKey: key + '-rotated', allowInferenceTest: false });
  assert.notEqual(f.config().credentialRevision, revision);
});

test('failed replacement, withdrawn authority and active runs preserve the working account', async t => {
  let fail = false, calls = 0;
  const f = setup(t, async () => { calls++; return fail ? new Response(key, { status: 401 }) : Response.json({ data: [] }); });
  await f.service.connect({ provider: 'openai', model, apiKey: key, allowInferenceTest: false });
  const previous = readFileSync(join(f.directory, 'accounts.json'));
  fail = true;
  assert.equal((await f.service.connect({ provider: 'openai', model, apiKey: key + '-wrong', allowInferenceTest: false })).saved, false);
  assert.deepEqual(readFileSync(join(f.directory, 'accounts.json')), previous); assert.equal(f.config().apiKey, key);
  fail = false;
  await assert.rejects(f.service.connect({ provider: 'openai', model, apiKey: key + '-new', allowInferenceTest: false }, async () => { throw new Error('revoked'); }), /revoked/);
  assert.deepEqual(readFileSync(join(f.directory, 'accounts.json')), previous);
  f.block(); const before = calls;
  await assert.rejects(f.service.connect({ provider: 'openai', model, apiKey: key, allowInferenceTest: false }), /active run/); assert.equal(calls, before);
  assert.throws(() => f.service.remove('openai'), /active run/);
});

test('multiple accounts can be selected and removed without falling back to another key', async t => {
  const f = setup(t, async () => Response.json({ data: [] }));
  await f.service.connect({ provider: 'openai', model, apiKey: key, allowInferenceTest: false });
  await f.service.connect({ provider: 'anthropic', model: 'claude-test', apiKey: key + '-anthropic', allowInferenceTest: false });
  f.service.select('openai'); assert.equal(f.config().apiKey, key);
  f.service.remove('anthropic'); assert.equal(f.config().apiKey, key);
  f.service.remove('openai'); assert.equal(f.config().apiKey, ''); assert.equal(createCredentialVault(f.directory).read()?.active, null);
});

test('unsafe permission modes, symlinks and multiply linked credential files are refused', t => {
  const f = setup(t, async () => Response.json({ data: [] })); const vault = createCredentialVault(f.directory);
  const file = { version: 1 as const, active: 'openai' as const, accounts: { openai: { model, apiKey: key, revision: '12345678-1234-4234-8234-123456789abc', validation: valid } } };
  vault.write(file); const path = join(f.directory, 'accounts.json');
  chmodSync(path, 0o644); assert.throws(() => vault.read(), /unsafe/); chmodSync(path, 0o600);
  linkSync(path, join(f.directory, 'second')); assert.throws(() => vault.read(), /unsafe/); rmSync(join(f.directory, 'second'));
  rmSync(path); symlinkSync(join(f.directory, 'missing'), path); assert.throws(() => vault.write(file));
});

test('saved selection survives startup and removing it cannot silently restore an environment key', async t => {
  const { parseBackendConfig } = await import('../src/config.js');
  const { loadSavedProviderConfig } = await import('../src/provider/startup.js');
  const f = setup(t, async () => Response.json({ data: [] }));
  const initial = parseBackendConfig({ env: { THREADLINE_OPENAI_API_KEY: 'synthetic-old-env-key', THREADLINE_PROVIDER_MODEL: 'old-model' } });
  assert.equal(loadSavedProviderConfig(initial, f.directory).config, initial);
  await f.service.connect({ provider: 'anthropic', model: 'claude-test', apiKey: key, allowInferenceTest: false });
  const loaded = loadSavedProviderConfig(initial, f.directory);
  assert.equal(loaded.config.storage.providerId, 'anthropic'); assert.equal(loaded.config.storage.providerApi, 'anthropic-messages'); assert.equal(loaded.config.storage.providerApiKey, key); assert.equal(loaded.revision, f.config().credentialRevision);
  f.service.remove('anthropic'); const removed = loadSavedProviderConfig(initial, f.directory);
  assert.equal(removed.config.storage.providerApiKey, ''); assert.equal(removed.config.storage.providerModel, '');
});

test('a saved-key recheck records the latest failure without replacing the secret or activating a fallback', async t => {
  let invalid = false;
  const f = setup(t, async () => invalid ? new Response('sensitive upstream text', { status: 401 }) : Response.json({ data: [] }));
  await f.service.connect({ provider: 'openai', model, apiKey: key, allowInferenceTest: false });
  invalid = true; const check = await f.service.check('openai', false);
  assert.equal(check.state, 'invalid'); assert.equal(f.service.view().providers.find(p => p.id === 'openai')?.validation?.state, 'invalid');
  assert.equal(createCredentialVault(f.directory).read()?.accounts.openai?.apiKey, key); assert.equal(f.config().providerId, 'openai');
});
