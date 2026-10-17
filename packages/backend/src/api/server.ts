import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  API_PREFIX,
  ROUTES,
  ThreadlineError,
  errorPayload,
  type ThreadlineErrorCode,
} from '@threadline/shared';

import { unsupportedOperation } from '../capabilities.js';
import type { ServiceConfig } from '../config.js';
import type { MemoryService } from '../index.js';
import type { Logger } from '../log.js';

/**
 * Loopback HTTP transport for the memory product, protocol v2.
 *
 * Every route answers with the shared success/error envelope, and the error
 * shape is always the shared payload: a client never parses a driver message.
 *
 * Not every path in `ROUTES` has a handler in this build, and the two cases are
 * reported differently rather than being blurred into one:
 *
 * - a route registered as an unimplemented capability answers `unsupported`
 *   naming that capability and the batch that will land it;
 * - any other path under the protocol prefix answers `unsupported` naming the
 *   path it could not serve — no capability is invented for it;
 * - a path outside the protocol prefix answers `not_found`.
 *
 * No case fabricates a success, and no case guesses at authority.
 */

export interface ServiceAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface ApiServerHandle {
  readonly listening: boolean;
  readonly address: ServiceAddress | null;
  listen(): Promise<ServiceAddress>;
  close(): Promise<void>;
}

export interface ApiServerDeps {
  readonly config: ServiceConfig;
  readonly service: MemoryService;
  readonly logger?: Logger;
}

const STATUS_BY_CODE: Readonly<Record<ThreadlineErrorCode, number>> = {
  invalid_request: 400,
  unknown_command: 404,
  service_unavailable: 503,
  internal_error: 500,
  unauthorized: 401,
  not_found: 404,
  storage_unavailable: 503,
  schema_incompatible: 503,
  idempotency_mismatch: 409,
  authority_conflict: 409,
  authority_unavailable: 503,
  stale_revision: 409,
  scope_denied: 403,
  unsupported: 501,
  source_unavailable: 410,
  deleting: 409,
  overloaded: 429,
  partial_coverage: 409,
};

export function createApiServer(deps: ApiServerDeps): ApiServerHandle {
  const app = buildApp(deps);
  let address: ServiceAddress | null = null;

  const handle: ApiServerHandle = {
    get listening() {
      return address !== null;
    },
    get address() {
      return address;
    },

    async listen(): Promise<ServiceAddress> {
      try {
        await app.listen({ host: deps.config.host, port: deps.config.port });
      } catch (error) {
        throw new ThreadlineError('service_unavailable', 'The HTTP transport could not bind.', {
          host: deps.config.host,
          port: deps.config.port,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
      address = {
        host: deps.config.host,
        port: deps.config.port,
        url: `http://${deps.config.host === '::1' ? '[::1]' : deps.config.host}:${String(deps.config.port)}`,
      };
      return address;
    },

    async close(): Promise<void> {
      address = null;
      await app.close();
    },
  };
  return handle;
}

/** Builds the HTTP app with authenticated operation routes and safe error responses. */
function buildApp(deps: ApiServerDeps): FastifyInstance {
  const { service } = deps;
  const app = Fastify({
    logger: false,
    bodyLimit: deps.config.limits.maxRequestBodyBytes,
    // The service is loopback-only; forwarded headers are never authority.
    trustProxy: false,
  });

  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    const mapped = toSafeError(error);
    if (mapped.code === 'internal_error') {
      // The client receives a safe payload; the operator needs the actual cause,
      // which never becomes part of the response.
      deps.logger?.log({
        level: 'error',
        message: 'Request failed with an internal error.',
        fields: {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        },
      });
    }
    reply.code(STATUS_BY_CODE[mapped.code]).send({ ok: false, error: mapped.payload });
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const error = path.startsWith(API_PREFIX)
      ? errorPayload('unsupported', 'This protocol path is not served by this build.', { path })
      : errorPayload('not_found', 'No such resource.', { path });
    reply.code(STATUS_BY_CODE[error.code]).send({ ok: false, error });
  });

  const ok = <T>(reply: FastifyReply, data: T): void => {
    void reply.send({ ok: true, data });
  };

  // Unauthenticated liveness only: it proves the process answers and names the
  // build. Component readiness, storage detail and the cross-tenant backlog
  // count stay behind the authorized status route below.
  app.get(ROUTES.health, (_request, reply) => ok(reply, service.liveness()));

  // Operational detail is authorized: the backlog is a cross-tenant count and
  // readiness describes the shared stores, which is not public information.
  app.get(ROUTES.status, async (request, reply) => {
    await service.auth.authenticate(authorizationOf(request), { allowTenantLevel: true });
    ok(reply, service.status());
  });

  app.get(ROUTES.capabilities, async (request, reply) => {
    await service.auth.authenticate(authorizationOf(request), { allowTenantLevel: true });
    ok(reply, service.capabilities());
  });

  app.get(ROUTES.projects, async (request, reply) => {
    const call = await service.auth.authenticate(authorizationOf(request), { allowTenantLevel: true });
    ok(reply, await service.projects.list(call));
  });

  app.post(ROUTES.projects, async (request, reply) => {
    const call = await service.auth.authenticate(authorizationOf(request), { allowTenantLevel: true });
    ok(reply, await service.projects.add(call, request.body));
  });

  app.get<{ Params: { projectId: string } }>(ROUTES.projectGrants(':projectId'), async (request, reply) => {
    const projectId = request.params.projectId;
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.projects.listGrants(call, projectId));
  });

  app.post(ROUTES.appendSources, async (request, reply) => {
    const body = readObject(request.body, 'source append');
    const projectId = readStringField(body, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.sources.append(call, body));
  });

  app.get(ROUTES.history, async (request, reply) => {
    const query = readObject(request.query ?? {}, 'history query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    const kinds = readStringList(query, 'kinds');
    const limit = readIntegerField(query, 'limit', 50, 1, 100);
    const historyQuery = {
      projectId,
      limit,
      ...(kinds === undefined ? {} : { kinds }),
      ...(readOptionalString(query, 'nativeSessionId') === undefined
        ? {}
        : { nativeSessionId: readOptionalString(query, 'nativeSessionId') }),
      ...(readOptionalString(query, 'cursor') === undefined ? {} : { cursor: readOptionalString(query, 'cursor') }),
    };
    ok(reply, await service.sources.history(call, historyQuery));
  });

  app.get<{ Params: { sourceId: string } }>(ROUTES.source(':sourceId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'source query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.sources.view(call, projectId, request.params.sourceId));
  });

  app.get<{ Params: { sourceId: string } }>(ROUTES.sourceRange(':sourceId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'source range query');
    const projectId = readStringField(query, 'projectId');
    const start = readIntegerField(query, 'start', 0, 0, Number.MAX_SAFE_INTEGER);
    const end = readIntegerField(query, 'end', start + 32_768, start, Number.MAX_SAFE_INTEGER);
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.sources.range(call, projectId, request.params.sourceId, start, end));
  });

  app.get<{ Params: { operationId: string } }>(ROUTES.operation(':operationId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'operation query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.operations.inspect(call, projectId, request.params.operationId));
  });

  app.get(ROUTES.memories, async (request, reply) => {
    const query = readObject(request.query ?? {}, 'memory query');
    const projectId = readStringField(query, 'projectId');
    const limit = readIntegerField(query, 'limit', 20, 1, 50);
    const taskId = readOptionalString(query, 'taskId');
    const kind = readOptionalString(query, 'kind');
    const focus = readOptionalString(query, 'focus');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(
      reply,
      await service.memories.query(call, {
        projectId,
        limit,
        ...(taskId === undefined ? {} : { taskId }),
        ...(kind === undefined ? {} : { kind }),
        ...(focus === undefined ? {} : { focus }),
      }),
    );
  });

  app.post(ROUTES.memoryProposals, async (request, reply) => {
    const body = readObject(request.body, 'memory proposal');
    const projectId = readStringField(body, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.memories.propose(call, body));
  });

  app.post(ROUTES.memoryEpisodes, async (request, reply) => {
    const body = readObject(request.body, 'episode recording');
    const projectId = readStringField(body, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.memories.recordEpisode(call, body));
  });

  app.get<{ Params: { memoryId: string } }>(ROUTES.memory(':memoryId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'memory query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.memories.view(call, projectId, request.params.memoryId));
  });

  app.post<{ Params: { memoryId: string } }>(ROUTES.memoryAccept(':memoryId'), async (request, reply) => {
    const body = readObject(request.body, 'memory acceptance');
    const projectId = readStringField(body, 'projectId');
    // One identity per request: the path names the memory the body must name too.
    if (readStringField(body, 'memoryId') !== request.params.memoryId) {
      throw new ThreadlineError('invalid_request', 'The body memoryId must match the path memoryId.');
    }
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.memories.accept(call, body));
  });

  app.post<{ Params: { memoryId: string } }>(ROUTES.memoryCorrections(':memoryId'), async (request, reply) => {
    const body = readObject(request.body, 'memory correction');
    const projectId = readStringField(body, 'projectId');
    if (readStringField(body, 'memoryId') !== request.params.memoryId) {
      throw new ThreadlineError('invalid_request', 'The body memoryId must match the path memoryId.');
    }
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.memories.correct(call, body));
  });

  app.post(ROUTES.tasks, async (request, reply) => {
    const body = readObject(request.body, 'task creation');
    const projectId = readStringField(body, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.tasks.create(call, body));
  });

  app.get<{ Params: { taskId: string } }>(ROUTES.task(':taskId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'task query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.tasks.view(call, projectId, request.params.taskId));
  });

  app.get<{ Params: { taskId: string } }>(ROUTES.taskRequirements(':taskId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'task requirements query');
    const projectId = readStringField(query, 'projectId');
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.tasks.requirements(call, projectId, request.params.taskId));
  });

  app.post<{ Params: { taskId: string } }>(ROUTES.taskRequirements(':taskId'), async (request, reply) => {
    const body = readObject(request.body, 'task requirement');
    const projectId = readStringField(body, 'projectId');
    if (readStringField(body, 'taskId') !== request.params.taskId) {
      throw new ThreadlineError('invalid_request', 'The body taskId must match the path taskId.');
    }
    const call = await service.auth.authenticate(authorizationOf(request), { projectId });
    ok(reply, await service.tasks.require(call, body));
  });

  // Known product operations that are not in this build answer explicitly
  // rather than falling through as an anonymous 404.
  const unavailable: ReadonlyArray<{ readonly operation: Parameters<typeof unsupportedOperation>[0]; readonly path: string }> = [
    { operation: 'claim.status', path: ROUTES.claimStatus },
    { operation: 'context.prepare', path: ROUTES.context },
    { operation: 'context.occurrence', path: ROUTES.contextOccurrences },
    { operation: 'session.register', path: ROUTES.nativeSessions },
    { operation: 'job.import', path: ROUTES.jobs },
  ];
  for (const entry of unavailable) {
    app.all(entry.path, () => {
      throw unsupportedOperation(entry.operation);
    });
  }

  return app;
}

function authorizationOf(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return typeof header === 'string' ? header : undefined;
}

interface SafeError {
  readonly code: ThreadlineErrorCode;
  readonly payload: ReturnType<typeof errorPayload>;
}

/** Reduces any thrown value to the shared payload; driver messages never escape. */
function toSafeError(error: unknown): SafeError {
  if (error instanceof ThreadlineError) {
    return { code: error.code, payload: error.toPayload() };
  }
  if (isFastifyBodyError(error)) {
    return {
      code: 'invalid_request',
      payload: errorPayload('invalid_request', 'The request body could not be accepted.', {
        limit: 0,
      }),
    };
  }
  return {
    code: 'internal_error',
    payload: errorPayload('internal_error'),
  };
}

function isFastifyBodyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { statusCode?: unknown; code?: unknown };
  return (
    candidate.statusCode === 400 ||
    candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
    candidate.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
    candidate.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
    candidate.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  );
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ThreadlineError('invalid_request', `The ${label} payload must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readStringField(value: Record<string, unknown>, field: string): string {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ThreadlineError('invalid_request', `The "${field}" field is required.`, { field });
  }
  return raw;
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ThreadlineError('invalid_request', `The "${field}" field must be a non-empty string.`, { field });
  }
  return raw;
}

function readIntegerField(
  value: Record<string, unknown>,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = value[field];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ThreadlineError('invalid_request', `The "${field}" value is outside its bounds.`, {
      field,
      minimum,
      maximum,
    });
  }
  return parsed;
}

function readStringList(value: Record<string, unknown>, field: string): string[] | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  }
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
    return raw as string[];
  }
  throw new ThreadlineError('invalid_request', `The "${field}" filter must be a list of names.`, { field });
}
