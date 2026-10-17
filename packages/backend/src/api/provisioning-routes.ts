import { ThreadlineError, MODEL_SELECTION_ROUTES } from '@threadline/shared';
import type { FastifyInstance } from 'fastify';

import type { ApplicationServices } from '../domain/services.js';
import type { ProvisioningService } from '../domain/provisioning.js';

/**
 * M05.2 routes: model listing, prospective selection and durable human input.
 *
 * Thin by design. Every identity in the request body is ignored; the scope comes
 * from the authenticated principal and the verified project binding, so a caller
 * cannot attribute an instruction or a selection to someone else.
 */

export const PROVISIONING_ROUTES = MODEL_SELECTION_ROUTES;

export function registerProvisioningRoutes(
  app: FastifyInstance,
  deps: {
    services: () => ApplicationServices | null;
    provisioning: () => ProvisioningService;
  },
): void {
  /**
   * Resolves membership only.
   *
   * Listing models must work before a task is admitted, so this deliberately
   * stops at project membership rather than requiring governing authority.
   */
  const memberScopeFor = async (request: { headers: Record<string, unknown>; params: unknown }) => {
    const services = deps.services();
    if (services === null) {
      throw new ThreadlineError('service_unavailable', 'Storage is not ready.');
    }
    const header = request.headers.authorization;
    const principal = await services.authenticate(typeof header === 'string' ? header : undefined);
    const projectId = (request.params as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new ThreadlineError('invalid_request', 'A project identifier is required.');
    }
    // Membership is re-read here, so supplying a project id the caller cannot
    // reach is refused rather than used as a scope.
    await services.membership(principal, projectId);
    return {
      tenantId: principal.tenantId,
      projectId,
      userId: principal.userId,
      userSessionId: principal.sessionId,
    };
  };

  /** Resolves membership *and* governing authority, for operations that need a task. */
  const scopeFor = async (request: { headers: Record<string, unknown>; params: unknown }) => {
    const services = deps.services();
    if (services === null) {
      throw new ThreadlineError('service_unavailable', 'Storage is not ready.');
    }
    const header = request.headers.authorization;
    const principal = await services.authenticate(typeof header === 'string' ? header : undefined);
    const projectId = (request.params as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new ThreadlineError('invalid_request', 'A project identifier is required.');
    }
    // Re-resolve the binding: a project the principal cannot reach must not be
    // selectable or writable merely because its id was supplied.
    const authority = await services.authority(principal, projectId);
    return {
      tenantId: principal.tenantId,
      projectId,
      userId: principal.userId,
      userSessionId: principal.sessionId,
      taskId: authority.taskId,
    };
  };

  app.get(PROVISIONING_ROUTES.list, async (request, reply) => {
    const scope = await memberScopeFor(request);
    const query = request.query as { q?: unknown; limit?: unknown };
    const result = await deps.provisioning().listModels(
      scope,
      typeof query.q === 'string' ? query.q : null,
      typeof query.limit === 'string' ? Number(query.limit) : undefined,
    );
    return reply.send(result);
  });

  app.post(PROVISIONING_ROUTES.select, async (request, reply) => {
    const scope = await scopeFor(request);
    const body = objectBody(request.body);
    const operationId = readString(body, 'operationId');
    const result = await deps.provisioning().selectModel(
      scope,
      {
        providerId: readString(body, 'providerId'),
        modelId: readString(body, 'modelId'),
        contextWindowTokens: readNumber(body, 'contextWindowTokens'),
        maxOutputTokens: readNumber(body, 'maxOutputTokens'),
        providerApi: typeof body['providerApi'] === 'string' ? body['providerApi'] : undefined,
        baseUrl: typeof body['baseUrl'] === 'string' ? body['baseUrl'] : undefined,
        label: typeof body['label'] === 'string' ? body['label'] : undefined,
      },
      operationId,
    );
    // A refusal is reported with its reason rather than collapsed into 400, so a
    // client can tell "unknown provider" from "no account configured".
    return reply.code(result.outcome === 'rejected' ? 409 : 200).send(result);
  });

  app.post(PROVISIONING_ROUTES.input, async (request, reply) => {
    const scope = await scopeFor(request);
    const body = objectBody(request.body);
    const kind = readString(body, 'kind');
    if(kind!=='initial'&&kind!=='follow_up')throw new ThreadlineError('invalid_request','Unknown human input kind.');
    if(body['consent']!==undefined&&body['consent']!=='none'&&body['consent']!=='explicit')throw new ThreadlineError('invalid_request','Unknown inference consent.');
    const result = await deps.provisioning().submitInput(scope, {
      operationId: readString(body, 'operationId'),
      kind,
      text: readString(body, 'text'),
      consent: body['consent'] === 'explicit' ? 'explicit' : 'none',
    });
    return reply.code(result.outcome === 'rejected' ? 409 : 200).send(result);
  });
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ThreadlineError('invalid_request', `${key} is required.`);
  }
  return value;
}

function readNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ThreadlineError('invalid_request', `${key} must be a whole number.`);
  }
  return value;
}
function objectBody(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ThreadlineError('invalid_request','An object body is required.');
 return value as Record<string,unknown>;
}
