import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';


import {
  EventCapacityError,
  PublisherClosedError,
  ThreadlineError,
  errorPayload,
  isUuid,
  type AuthStatusView,
  type AuthorityView,
  type GoalAdmissionResult,
  type PrincipalView,
} from '@threadline/shared';

import type { ManagedRuntime } from '../runtime/managed.js';
import type { BackendConfig } from '../config.js';
import type { CommandDispatcher } from '../domain/dispatcher.js';
import type { ApplicationServices, ExecutionSurface } from '../domain/services.js';
import type { EventStreamManager } from './events-stream.js';

/**
 * HTTP handlers for the M00/M01 scaffold.
 *
 * Handlers only translate transport into a backend call and a status code.
 * There is no domain logic here, and no domain module imports Fastify.
 */

export interface RouteDeps {
  readonly runtime?: () => ManagedRuntime | null;
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
  runPrepare: '/runs/prepare',
  runStart: '/runs/start',
  runCancel: '/runs/cancel',
  runInspect: '/runs/:runId',
  runHeartbeat: '/runs/:runId/heartbeat',
} as const;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ThreadlineError) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'not_found' ? 404 :
        ['invalid_request','unknown_command'].includes(error.code) ? 400 :
        ['authority_conflict','idempotency_mismatch'].includes(error.code) ? 409 :
        ['authority_unavailable','storage_unavailable','service_unavailable'].includes(error.code) ? 503 : 500;
      const payload = error.toPayload();
      return reply.code(status).send({ ...payload, details: { ...payload.details,
        correlationId: payload.details?.['correlationId'] ?? randomUUID() } });
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

  app.get(ROUTES.events, (request, reply) => {
    const authorization = readHeader(request.headers.authorization);
    try { deps.streams.open(reply.raw, async event => {
      if (event.name !== 'run.activity') return true;
      const services = requireServices(deps);
      const principal = await services.authenticate(authorization);
      if (principal.tenantId !== event.payload.tenantId) return false;
      await services.authority(principal, event.payload.projectId);
      return true;
    }); return reply.hijack(); }
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
/**
 * M02 run routes.
 *
 * All four are asynchronous with respect to the model: none waits for a
 * provider response, so a long turn never holds a human command's HTTP request
 * open. Handlers translate; the domain code below owns every decision.
 */
export function registerRunRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const runtime = () => {
    const value = deps.runtime?.();
    if (!value) throw new ThreadlineError('storage_unavailable', 'The owned runtime requires configured storage.');
    return value;
  };
  app.post(ROUTES.runPrepare, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(readHeader(request.headers.authorization));
    const body = request.body;
    if (!isRecord(body) || typeof body['projectId'] !== 'string' || !isUuid(body['projectId']) || typeof body['contextWindowTokens'] !== 'number')
      throw new ThreadlineError('invalid_request', 'projectId and declared contextWindowTokens are required.');
    return reply.send(await runtime().prepare(principal, body['projectId'], body['contextWindowTokens']));
  });
  app.post(ROUTES.runStart, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(readHeader(request.headers.authorization));
    const body = parseStartRunBody(request.body);
    const outcome = await runtime().start(principal, body);
    return reply.code(outcome.kind === 'admitted' || outcome.kind === 'replayed' ? 200 : 202).send(outcome);
  });

  app.post(ROUTES.runCancel, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(readHeader(request.headers.authorization));
    const body = request.body as { runId?: unknown; reason?: unknown } | undefined;
    if (!isRecord(body) || typeof body['runId'] !== 'string' || typeof body['reason'] !== 'string') {
      throw new ThreadlineError('invalid_request', 'A runId and reason are required.');
    }
    return reply.code(200).send(await runtime().cancel(principal, body['runId'], body['reason']));
  });

  app.get(ROUTES.runInspect, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(readHeader(request.headers.authorization));
    const execution = requireExecution(deps);
    const params = request.params as { runId?: unknown };
    if (typeof params.runId !== 'string') {
      throw new ThreadlineError('invalid_request', 'A run id is required.');
    }
    return reply.code(200).send(await execution.inspect(principal, params.runId));
  });

  app.post(ROUTES.runHeartbeat, async (request, reply) => {
    const principal = await requireServices(deps).authenticate(readHeader(request.headers.authorization));
    const execution = requireExecution(deps);
    const params = request.params as { runId?: unknown };
    if (typeof params.runId !== 'string') {
      throw new ThreadlineError('invalid_request', 'A run id is required.');
    }
    return reply.code(200).send(await execution.heartbeat(principal, params.runId));
  });
}

function requireExecution(deps: RouteDeps): ExecutionSurface {
  const execution = deps.services()?.execution() ?? null;
  if (execution === null) {
    throw new ThreadlineError('storage_unavailable', 'Execution is not available until storage has started.');
  }
  return execution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStartRunBody(body: unknown): {
  projectId: string;
  requestId: string;
  taskId: string;
  profileId: string;
  workspaceId: string;
  expectedRevision: number;
  expectedRequirementRevision: number;
} {
  if (!isRecord(body)) {
    throw new ThreadlineError('invalid_request', 'The start body must be a JSON object.');
  }
  const required = [
    'projectId',
    'requestId',
    'taskId',
    'profileId',
    'workspaceId',
  ] as const;
  for (const key of required) {
    const value = body[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ThreadlineError('invalid_request', `The "${key}" field is required.`);
    }
  }
  if (!isUuid(body['projectId']) || !isUuid(body['requestId'])) {
    throw new ThreadlineError('invalid_request', 'projectId and requestId must be UUIDs.');
  }
  const revision = body['expectedRevision'];
  const requirementRevision = body['expectedRequirementRevision'];
  if (!Number.isInteger(revision) || !Number.isInteger(requirementRevision)) {
    throw new ThreadlineError('invalid_request', 'expectedRevision and expectedRequirementRevision must be integers.');
  }
  return {
    projectId: body['projectId'] as string,
    requestId: body['requestId'] as string,
    taskId: body['taskId'] as string,
    profileId: body['profileId'] as string,
    workspaceId: body['workspaceId'] as string,
    expectedRevision: revision as number,
    expectedRequirementRevision: requirementRevision as number,
  };
}
