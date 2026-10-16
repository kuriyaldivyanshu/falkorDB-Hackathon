import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isSetupProvider, PROVIDER_SETTINGS_ROUTE, ThreadlineError } from '@threadline/shared';
import type { ProviderSettings } from '../provider/settings.js';
import type { ApplicationServices } from '../domain/services.js';

export function registerProviderRoutes(app: FastifyInstance, deps: {
  services: () => ApplicationServices | null;
  providerSettings: () => ProviderSettings | null;
  localBootstrap: () => { userId?: string } | null;
}) {
  async function authorize(request: FastifyRequest) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) || request.headers.origin)
      throw new ThreadlineError('unauthorized', 'Provider settings are available only to the local terminal owner.');
    const services = deps.services();
    if (!services) throw new ThreadlineError('storage_unavailable', 'Local owner authentication is unavailable.');
    const principal = await services.authenticate(typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined);
    if (principal.userId !== deps.localBootstrap()?.userId) throw new ThreadlineError('unauthorized', 'Only the local installation owner can change provider settings.');
  }
  const settings = () => { const s = deps.providerSettings(); if (!s) throw new ThreadlineError('storage_unavailable', 'Provider settings are unavailable.'); return s; };
  app.get(PROVIDER_SETTINGS_ROUTE, async request => { await authorize(request); return settings().view(); });
  app.post(PROVIDER_SETTINGS_ROUTE, { bodyLimit: 16 * 1024 }, async request => {
    await authorize(request);
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ThreadlineError('invalid_request', 'A provider operation is required.');
    const b = body as Record<string, unknown>;
    if (!isSetupProvider(b.provider) || Object.keys(b).some(k => !['action','provider','model','apiKey','allowInferenceTest'].includes(k)))
      throw new ThreadlineError('invalid_request', 'Choose a supported provider and operation.');
    if (b.action === 'connect') {
      if (typeof b.apiKey !== 'string' || typeof b.model !== 'string' || typeof b.allowInferenceTest !== 'boolean')
        throw new ThreadlineError('invalid_request', 'A model, private key and explicit test preference are required.');
      return settings().connect({ provider: b.provider, apiKey: b.apiKey, model: b.model, allowInferenceTest: b.allowInferenceTest }, () => authorize(request));
    }
    if ('apiKey' in b || 'model' in b) throw new ThreadlineError('invalid_request', 'Key material is accepted only by the connect operation.');
    if (b.action === 'check') return settings().check(b.provider, b.allowInferenceTest === true, () => authorize(request));
    if (b.action === 'select') return settings().select(b.provider);
    if (b.action === 'remove') return settings().remove(b.provider);
    throw new ThreadlineError('invalid_request', 'Unknown provider operation.');
  });
}
