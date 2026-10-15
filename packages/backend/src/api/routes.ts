import type { FastifyInstance } from 'fastify';

import {
  ThreadlineError,
  EventCapacityError, PublisherClosedError, isUuid, errorPayload,
  type AuthStatusView,
  type AuthorityView,
  type GoalAdmissionResult,
  type PrincipalView,
} from '@threadline/shared';

import type { BackendConfig } from '../config.js';
import type { CommandDispatcher } from '../domain/dispatcher.js';
import type { ApplicationServices } from '../domain/services.js';
import type { EventStreamManager } from './events-stream.js';

/**
 * HTTP handlers for the M00/M01 scaffold.
 *
 * Handlers only translate transport into a backend call and a status code.
 * There is no domain logic here, and no domain module imports Fastify.
 */

export interface RouteDeps {
  readonly config: BackendConfig;
  readonly dispatch: CommandDispatcher;
  readonly streams: EventStreamManager;
  readonly health: () => unknown;
  /**
   * Durable services. `null` until storage has started; every authenticated
   * route then fails closed with `storage_unavailable` rather than pretending.
   */
  readonly services: () => ApplicationServices | null;
  readonly localBootstrap: () => {
    tenantId: string;
    userId: string;
    projectId: string;
    projectSlug: string;
  } | null;
}

/**
 * Public routes. Agent B's terminal client targets exactly these paths:
 *
 * - `GET  /healthz`                              -> HealthReport (200 ready, 503 otherwise)
 * - `POST /commands`                             -> CommandResponse
 * - `GET  /events`                               -> text/event-stream of ThreadlineEvent
 * - `GET  /auth/session`                         -> PrincipalView (bearer token required)
 * - `GET  /auth/status`                          -> AuthStatusView (unauthenticated, booleans only)
 * - `POST /auth/session/revoke`                  -> revokes the presented session
 * - `GET  /projects/:projectId/authority`        -> AuthorityView
 * - `GET  /projects/:projectId/admissions/:requestId` -> committed receipt or 404
 */
export const ROUTES = {
  health: '/healthz',
  commands: '/commands',
  events: '/events',
  authSession: '/auth/session',
  authStatus: '/auth/status',
  authRevoke: '/auth/session/revoke',
  authority: '/projects/:projectId/authority',
  admission: '/projects/:projectId/admissions/:requestId',
} as const;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ThreadlineError) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'not_found' ? 404 :
        ['invalid_request','unknown_command'].includes(error.code) ? 400 :
        ['authority_conflict','idempotency_mismatch'].includes(error.code) ? 409 :
        ['authority_unavailable','storage_unavailable','service_unavailable'].includes(error.code) ? 503 : 500;
      return reply.code(status).send(error.toPayload());
    }
    const status = typeof error === 'object' && error !== null && 'statusCode' in error &&
      typeof error.statusCode === 'number' && [400,413,415].includes(error.statusCode) ? error.statusCode : 500;
    return reply.code(status).send(errorPayload(status === 500 ? 'internal_error' : 'invalid_request'));
  });
  app.get(ROUTES.health, async (_request, reply) => {
    const services = deps.services();
    const stores = services === null ? null : await services.refreshReadiness();
    const report = deps.health() as { state?: string } | undefined;
    const storesReady = deps.config.storage.mode !== 'required' || (stores?.sqlReady === true && stores.graphReady);
    return reply.code(storesReady && report?.state === 'ready' ? 200 : 503).send(report);
  });

  app.post(ROUTES.commands, async (request, reply) => {
    const header = request.headers.authorization;
    const outcome = await deps.dispatch(
      request.body,
      typeof header === 'string' ? header : undefined,
    );
    return reply.code(outcome.status).send(outcome.body);
  });

  app.get(ROUTES.events, (_request, reply) => {
    try { deps.streams.open(reply.raw); return reply.hijack(); }
    catch (error) {
      if (error instanceof EventCapacityError || error instanceof PublisherClosedError)
        return reply.code(503).send({error:errorPayload('service_unavailable','Event streaming capacity is unavailable.')});
      throw error;
    }
  });

  /**
   * Reports only whether a credential was supplied and accepted. It never
   * echoes a token, a user name or a project id, so it is safe to call before
   * the client has decided whether it holds the owner credential.
   */
  app.get(ROUTES.authStatus, async (request, reply) => {
    const services = deps.services();
    const body: AuthStatusView = {
      bootstrapped: deps.localBootstrap() !== null,
      authenticated: false,
      reason: services === null ? 'storage is not running' : 'no bearer token supplied',
    };
    if (services === null) {
      return reply.code(503).send(body);
    }
    try {
      await services.authenticate(readHeader(request.headers.authorization));
      return reply.code(200).send({ ...body, authenticated: true, reason: 'ok' } satisfies AuthStatusView);
    } catch (error) {
      return reply.code(401).send({
        ...body,
        reason: error instanceof ThreadlineError ? error.message : 'unauthorized',
      } satisfies AuthStatusView);
    }
  });

  app.get(ROUTES.authSession, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(
      readHeader(request.headers.authorization),
    );
    const sql = deps.services();
    const view: PrincipalView = await buildPrincipalView(sql, principal);
    return reply.code(200).send(view);
  });

  app.post(ROUTES.authRevoke, async (request, reply) => {
    const services = requireServices(deps);
    const principal = await services.authenticate(readHeader(request.headers.authorization));
    const revoked = await services.revokeSession(principal, principal.sessionId);
    return reply.code(revoked ? 200 : 409).send({ revoked });
  });

  app.get(ROUTES.authority, async (request, reply) => {
    const services = requireServices(deps);
    const principal = await services.authenticate(readHeader(request.headers.authorization));
    const params = request.params as { projectId?: unknown };
    if (!isUuid(params.projectId)) {
      throw new ThreadlineError('invalid_request', 'A project id is required.');
    }
    const view: AuthorityView = await services.authority(principal, params.projectId);
    return reply.code(200).send(view);
  });

  app.get(ROUTES.admission, async (request, reply) => {
    const services = requireServices(deps);
    const principal = await services.authenticate(readHeader(request.headers.authorization));
    const params = request.params as { projectId?: unknown; requestId?: unknown };
    if (!isUuid(params.projectId) || !isUuid(params.requestId)) {
      throw new ThreadlineError('invalid_request', 'A project id and request id are required.');
    }
    const result: GoalAdmissionResult = await services.admissionByRequestId(
      principal,
      params.projectId,
      params.requestId,
    );
    return reply.code(200).send(result);
  });
}

function requireServices(deps: RouteDeps): ApplicationServices {
  const services = deps.services();
  if (services === null) {
    throw new ThreadlineError(
      'storage_unavailable',
      'Durable routes need storage to be running.',
    );
  }
  return services;
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function buildPrincipalView(
  services: ApplicationServices | null,
  principal: Awaited<ReturnType<ApplicationServices['authenticate']>>,
): Promise<PrincipalView> {
  if (services === null) {
    throw new ThreadlineError('storage_unavailable', 'Storage is not running.');
  }
  const projects = await services.projectsFor(principal);
  return {
    userId: principal.userId,
    displayName: principal.displayName,
    tenantId: principal.tenantId,
    sessionId: principal.sessionId,
    expiresAt: principal.expiresAt.toISOString(),
    idleExpiresAt: principal.idleExpiresAt.toISOString(),
    projects,
  };
}