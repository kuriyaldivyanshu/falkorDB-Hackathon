import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  API_PREFIX, POLICY_CONTROL_SURFACES, CONTRACT_ROUTES_V3, ownerPolicyV3Schema, policyStatusV3Schema,
  ROUTES,
  ThreadlineError,
  errorPayload, parseContract, sourceAppendResultSchema, sourceHistoryPageSchema, sourceViewSchema,
  memoryOperationResultSchema, memoryQueryResultSchema, memoryViewSchema, taskOperationResultSchema,
  taskViewSchema, taskRequirementsViewSchema, operationViewSchema, contextResultSchema, contextOccurrenceSchema,
  projectViewSchema, projectJoinResultSchema,
  type ThreadlineErrorCode,
} from '@threadline/shared';

import type { AuthenticatedCall, AuthenticateTarget } from '../service/auth.js';
import type { ReleaseTicket, ReleaseResource, ReleaseSelection } from '../service/release.js';
import { requirePermission } from '../service/permissions.js';
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

  const tickets = new WeakMap<FastifyRequest, ReleaseTicket>();
  const authenticate = async (request: FastifyRequest, target?: AuthenticateTarget): Promise<AuthenticatedCall> => {
    const call = await service.auth.authenticate(authorizationOf(request), target);
    const surface = `${request.method} ${request.routeOptions.url ?? '/unknown'}`;
    const params = request.params as Record<string, string>;
    const seeds: ReleaseResource[] = [];
    if (call.scope.projectId !== null) for (const [field,kind] of [
      ['sourceId','source'],['memoryId','memory'],['taskId','task'],['operationId','operation'],
    ] as const) {
      if (params?.[field]) seeds.push({projectId: call.scope.projectId, kind, id: params[field]});
    }
    if (surface === `GET ${ROUTES.memories}` && call.scope.projectId !== null) {
      const taskId = (request.query as Record<string, unknown>)?.taskId;
      if (typeof taskId === 'string') seeds.push({ projectId: call.scope.projectId, kind: 'task', id: taskId });
    }
    const graphRead = graphSurfaces.has(surface);
    if (!knownSurfaces.has(surface)) throw new ThreadlineError('unsupported','This response has no release contract.');
    // Mutation acknowledgements do not include content read through path IDs.
    tickets.set(request, await service.release.begin(call, surface, request.method === 'GET' ? seeds : [], graphRead));
    return call;
  };
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode >= 400) return payload;
    const ticket = tickets.get(request);
    // Liveness is the only unauthenticated successful route. New authenticated
    // routes require an explicit response release contract.
    if (!ticket) {
      if (request.routeOptions.url === ROUTES.health) return payload;
      throw new ThreadlineError('scope_denied', 'This release is not authorized.');
    }
    if (typeof payload !== 'string') throw new ThreadlineError('invalid_request', 'Only bounded JSON responses can be released.');
    const envelope = JSON.parse(payload) as {data:unknown};
    await service.release.permit(ticket, payload, releaseSelection(ticket.surface,envelope.data,ticket.call));
    return payload;
  });

  app.get(CONTRACT_ROUTES_V3.policy(':projectId'), async (request,reply) => {
    const projectId = (request.params as {projectId:string}).projectId;
    const call = await authenticate(request,{projectId});
    const bindingId = (request.query as {bindingId?:string}).bindingId;
    return reply.send({ok:true,data:await service.policies.inspect(call,bindingId)});
  });
  app.post(CONTRACT_ROUTES_V3.policy(':projectId'), async (request,reply) => {
    const projectId = (request.params as {projectId:string}).projectId;
    const call = await authenticate(request,{projectId});
    return reply.send({ok:true,data:await service.policies.activate(call,request.body)});
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

  const ok = <T>(reply: FastifyReply, data: T): FastifyReply => {
    return reply.send({ ok: true, data });
  };

  // Unauthenticated liveness only: it proves the process answers and names the
  // build. Component readiness, storage detail and the cross-tenant backlog
  // count stay behind the authorized status route below.
  app.get(ROUTES.health, (_request, reply) => ok(reply, service.liveness()));

  // Operational detail is authorized: the backlog is a cross-tenant count and
  // readiness describes the shared stores, which is not public information.
  app.get(ROUTES.status, async (request, reply) => {
    const call = await authenticate(request, { allowTenantLevel: true });
    requirePermission(call, 'service.status');
    return ok(reply, service.status());
  });

  app.get(ROUTES.capabilities, async (request, reply) => {
    const call = await authenticate(request, { allowTenantLevel: true });
    requirePermission(call, 'capabilities');
    return ok(reply, service.capabilities());
  });

  app.get(ROUTES.projects, async (request, reply) => {
    const call = await authenticate(request, { allowTenantLevel: true });
    requirePermission(call, 'read');
    const query=readObject(request.query??{},'project page');
    const page=await service.projects.listPage(call,{limit:readIntegerField(query,'limit',16,1,16),
      ...(readOptionalString(query,'cursor')?{cursor:readOptionalString(query,'cursor')} : {}),
      ...(readOptionalString(query,'projectId')?{projectId:readOptionalString(query,'projectId')} : {})});
    if(page.nextCursor)reply.header('X-Threadline-Next-Cursor',page.nextCursor);
    return ok(reply,page.entries);
  });

  app.post(ROUTES.projects, async (request, reply) => {
    const call = await authenticate(request, { allowTenantLevel: true });
    requirePermission(call, 'project.admin');
    return ok(reply, await service.projects.add(call, request.body));
  });

  app.get<{ Params: { projectId: string } }>(ROUTES.projectGrants(':projectId'), async (request, reply) => {
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'project.admin');
    const query=readObject(request.query??{},'grant page');
    const page=await service.projects.grantsPage(call,projectId,{limit:readIntegerField(query,'limit',100,1,100),
      ...(readOptionalString(query,'cursor')?{cursor:readOptionalString(query,'cursor')}: {})});
    if(page.nextCursor)reply.header('X-Threadline-Next-Cursor',page.nextCursor);
    return ok(reply,page.entries);
  });

  app.post<{ Params: { projectId: string } }>(ROUTES.readerCredentials(':projectId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'access.admin');
    return ok(reply, await service.access.issue(call, projectId, request.body));
  });
  app.get<{ Params: { projectId: string } }>(ROUTES.readerCredentials(':projectId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'access.admin');
    const query = readObject(request.query ?? {}, 'reader credential list');
    if (Object.keys(query).some((key) => key !== 'limit')) throw new ThreadlineError('invalid_request', 'Only the metadata limit may be selected.');
    return ok(reply, await service.access.list(call, projectId, readIntegerField(query, 'limit', 50, 1, 100)));
  });
  app.post<{ Params: { projectId: string; credentialId: string } }>(
    ROUTES.readerCredentialRevocation(':projectId', ':credentialId'), async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { projectId, credentialId } = request.params;
      const call = await authenticate(request, { projectId });
      requirePermission(call, 'access.admin');
      if (request.body !== undefined && Object.keys(readObject(request.body, 'revocation')).length > 0) {
        throw new ThreadlineError('invalid_request', 'Revocation accepts no additional fields.');
      }
      return ok(reply, await service.access.revoke(call, projectId, credentialId));
    });

  app.post<{ Params: { projectId: string } }>(ROUTES.enrollments(':projectId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.nativeAccess.issue(call, projectId, request.body));
  });
  app.get<{ Params: { projectId: string } }>(ROUTES.enrollments(':projectId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    const query = readObject(request.query ?? {}, 'native enrollment list');
    if (Object.keys(query).some((key) => key !== 'limit')) throw new ThreadlineError('invalid_request', 'Only the metadata limit may be selected.');
    return ok(reply, await service.nativeAccess.list(call, projectId, readIntegerField(query, 'limit', 50, 1, 100)));
  });
  app.get<{ Params: { projectId: string; enrollmentId: string } }>(ROUTES.enrollment(':projectId', ':enrollmentId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { projectId, enrollmentId } = request.params;
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.nativeAccess.inspect(call, projectId, enrollmentId));
  });
  app.post<{ Params: { projectId: string; enrollmentId: string } }>(ROUTES.enrollmentRevocation(':projectId', ':enrollmentId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { projectId, enrollmentId } = request.params;
    const call = await authenticate(request, { projectId });
    if (request.body !== undefined && Object.keys(readObject(request.body, 'revocation')).length > 0) {
      throw new ThreadlineError('invalid_request', 'Revocation accepts no additional fields.');
    }
    return ok(reply, await service.nativeAccess.revoke(call, projectId, enrollmentId));
  });
  app.post(ROUTES.nativeSessions, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const call = await authenticate(request);
    const result = await service.nativeAccess.register(call, request.body);
    const refreshed = await service.auth.authenticate(authorizationOf(request));
    tickets.set(request,await service.release.begin(refreshed,`${request.method} ${request.routeOptions.url}`,[],false));
    return ok(reply,result);
  });
  app.get<{ Params: { projectId: string } }>(ROUTES.projectSessions(':projectId'), async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const projectId = request.params.projectId;
    const call = await authenticate(request, { projectId });
    const query = readObject(request.query ?? {}, 'native session list');
    if (Object.keys(query).some((key) => key !== 'limit')) throw new ThreadlineError('invalid_request', 'Only the metadata limit may be selected.');
    return ok(reply, await service.nativeAccess.sessions(call, projectId, readIntegerField(query, 'limit', 50, 1, 100)));
  });

  app.post(ROUTES.appendSources, async (request, reply) => {
    const body = readObject(request.body, 'source append');
    const projectId = readStringField(body, 'projectId');
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.sources.append(call, body));
  });

  app.get(ROUTES.history, async (request, reply) => {
    const query = readObject(request.query ?? {}, 'history query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
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
    return ok(reply, await service.sources.history(call, historyQuery));
  });

  app.get<{ Params: { sourceId: string } }>(ROUTES.source(':sourceId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'source query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.sources.view(call, projectId, request.params.sourceId));
  });

  app.get<{ Params: { sourceId: string } }>(ROUTES.sourceRange(':sourceId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'source range query');
    const projectId = readStringField(query, 'projectId');
    const start = readIntegerField(query, 'start', 0, 0, Number.MAX_SAFE_INTEGER);
    const end = readIntegerField(query, 'end', start + 32_768, start, Number.MAX_SAFE_INTEGER);
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.sources.range(call, projectId, request.params.sourceId, start, end));
  });

  app.get<{ Params: { operationId: string } }>(ROUTES.operation(':operationId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'operation query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.operations.inspect(call, projectId, request.params.operationId));
  });

  app.get(ROUTES.memories, async (request, reply) => {
    const query = readObject(request.query ?? {}, 'memory query');
    const projectId = readStringField(query, 'projectId');
    const limit = readIntegerField(query, 'limit', 20, 1, 50);
    const taskId = readOptionalString(query, 'taskId');
    const kind = readOptionalString(query, 'kind');
    const focus = readOptionalString(query, 'focus');
    const call = await authenticate(request, { projectId });
    return ok(
      reply,
      await service.memories.query(call, {
        projectId,
        limit,
        ...(readOptionalString(query,'cursor') ? {cursor:readOptionalString(query,'cursor')} : {}),
        ...(taskId === undefined ? {} : { taskId }),
        ...(kind === undefined ? {} : { kind }),
        ...(focus === undefined ? {} : { focus }),
      }),
    );
  });

  app.post(ROUTES.memoryProposals, async (request, reply) => {
    const body = readObject(request.body, 'memory proposal');
    const projectId = readStringField(body, 'projectId');
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.memories.propose(call, body));
  });

  app.post(ROUTES.memoryEpisodes, async (request, reply) => {
    const body = readObject(request.body, 'episode recording');
    const projectId = readStringField(body, 'projectId');
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.memories.recordEpisode(call, body));
  });

  app.get<{ Params: { memoryId: string } }>(ROUTES.memory(':memoryId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'memory query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.memories.view(call, projectId, request.params.memoryId));
  });

  app.post<{ Params: { memoryId: string } }>(ROUTES.memoryAccept(':memoryId'), async (request, reply) => {
    const body = readObject(request.body, 'memory acceptance');
    const projectId = readStringField(body, 'projectId');
    // One identity per request: the path names the memory the body must name too.
    if (readStringField(body, 'memoryId') !== request.params.memoryId) {
      throw new ThreadlineError('invalid_request', 'The body memoryId must match the path memoryId.');
    }
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.memories.accept(call, body));
  });

  app.post<{ Params: { memoryId: string } }>(ROUTES.memoryCorrections(':memoryId'), async (request, reply) => {
    const body = readObject(request.body, 'memory correction');
    const projectId = readStringField(body, 'projectId');
    if (readStringField(body, 'memoryId') !== request.params.memoryId) {
      throw new ThreadlineError('invalid_request', 'The body memoryId must match the path memoryId.');
    }
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.memories.correct(call, body));
  });

  app.post(ROUTES.tasks, async (request, reply) => {
    const body = readObject(request.body, 'task creation');
    const projectId = readStringField(body, 'projectId');
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.tasks.create(call, body));
  });

  app.get<{ Params: { taskId: string } }>(ROUTES.task(':taskId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'task query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.tasks.view(call, projectId, request.params.taskId));
  });

  app.get<{ Params: { taskId: string } }>(ROUTES.taskRequirements(':taskId'), async (request, reply) => {
    const query = readObject(request.query ?? {}, 'task requirements query');
    const projectId = readStringField(query, 'projectId');
    const call = await authenticate(request, { projectId });
    return ok(reply, await service.tasks.requirements(call, projectId, request.params.taskId));
  });

  app.post<{ Params: { taskId: string } }>(ROUTES.taskRequirements(':taskId'), async (request, reply) => {
    const body = readObject(request.body, 'task requirement');
    const projectId = readStringField(body, 'projectId');
    if (readStringField(body, 'taskId') !== request.params.taskId) {
      throw new ThreadlineError('invalid_request', 'The body taskId must match the path taskId.');
    }
    const call = await authenticate(request, { projectId });
    requirePermission(call, 'knowledge.write');
    return ok(reply, await service.tasks.require(call, body));
  });

  app.post(ROUTES.context, async (request, reply) => {
    const body = readObject(request.body, 'context preparation');
    const call = await authenticate(request, { projectId: readStringField(body, 'projectId') });
    requirePermission(call, 'context.audit');
    return ok(reply, await service.context.prepare(call, body));
  });
  app.post(ROUTES.contextOccurrences, async (request, reply) => {
    const body = readObject(request.body, 'context occurrence');
    const call = await authenticate(request, { projectId: readStringField(body, 'projectId') });
    requirePermission(call, 'context.audit');
    return ok(reply, await service.context.recordOccurrence(call, body));
  });

  // Known product operations that are not in this build answer explicitly
  // rather than falling through as an anonymous 404.
  const unavailable: ReadonlyArray<{ readonly operation: Parameters<typeof unsupportedOperation>[0]; readonly path: string }> = [
    { operation: 'claim.status', path: ROUTES.claimStatus },
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

const SAFE_INPUT_FIELDS = new Set([
  'projectId', 'taskId', 'memoryId', 'versionId', 'sourceId', 'operationId',
  'content', 'records', 'applicability', 'observedUnder', 'reason', 'title', 'family',
  'limit', 'cursor', 'discoveryCursor', 'offset', 'maxBytes', 'focus', 'kind', 'kinds',
  'idempotencyKey', 'expectedCurrentVersionId', 'expectedTaskRevision', 'sourceIds',
  'nativeSessionId', 'joinProjectId', 'root', 'label', 'bindingId', 'candidateDigest', 'guard', 'ceilings',
]);

/** Reduces any thrown value to the shared payload; driver messages never escape. */
function toSafeError(error: unknown): SafeError {
  if (error instanceof ThreadlineError) {
    if(error.code==='authority_unavailable' && error.details?.['reason']==='policy_unavailable')return {code:error.code,payload:errorPayload(error.code,'Current policy requires owner reconciliation; inspect the project policy.',{reason:'policy_unavailable'})};
    if (error.code === 'invalid_request') {
      const details = error.details;
      const candidate = typeof details?.field === 'string' ? details.field
        : typeof details?.path === 'string' ? details.path.split('.')[0] : undefined;
      // Only request field names qualify for detailed validation diagnostics.
      // Stored sizes, resource identities and arbitrary details never escape.
      const field = candidate && SAFE_INPUT_FIELDS.has(candidate) ? candidate : undefined;
      return { code: error.code, payload: field
        ? errorPayload(error.code, error.message, { field }) : errorPayload(error.code) };
    }
    if (error.code === 'unsupported' && typeof error.details?.operation === 'string'
      && ['claim.status', 'job.import'].includes(error.details.operation)) {
      return { code: error.code, payload: errorPayload(error.code, error.message, { operation: error.details.operation }) };
    }
    return { code: error.code, payload: errorPayload(error.code) };
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

const metadataSurfaces = POLICY_CONTROL_SURFACES;
const admissionKinds = new Map([
  [`POST ${ROUTES.appendSources}`,'source.append'],[`POST ${ROUTES.memoryProposals}`,'memory.propose'],
  [`POST ${ROUTES.memoryEpisodes}`,'memory.episode.record'],[`POST ${ROUTES.memoryAccept(':memoryId')}`,'memory.accept'],
  [`POST ${ROUTES.memoryCorrections(':memoryId')}`,'memory.correct'],[`POST ${ROUTES.tasks}`,'task.create'],
  [`POST ${ROUTES.taskRequirements(':taskId')}`,'task.require'],
]);
const graphSurfaces = new Set([
  `GET ${ROUTES.memories}`,`GET ${ROUTES.memory(':memoryId')}`,`GET ${ROUTES.task(':taskId')}`,
  `GET ${ROUTES.taskRequirements(':taskId')}`,`POST ${ROUTES.context}`,`POST ${ROUTES.contextOccurrences}`,
]);
const knownSurfaces = new Set([...metadataSurfaces,...admissionKinds.keys(),...graphSurfaces,
  `GET ${ROUTES.history}`,`GET ${ROUTES.source(':sourceId')}`,`GET ${ROUTES.sourceRange(':sourceId')}`,`GET ${ROUTES.operation(':operationId')}`]);
function releaseSelection(surface:string,data:unknown,call:AuthenticatedCall):ReleaseSelection {
  const resources: ReleaseResource[]=[];
  const add=(kind:ReleaseResource['kind'],id:string,projectId=call.scope.projectId):void=>{
    if(projectId===null)throw new ThreadlineError('scope_denied','Project release scope is required.');
    resources.push({kind,id,projectId});
  };
  if(surface===`GET ${CONTRACT_ROUTES_V3.policy(':projectId')}` || surface===`POST ${CONTRACT_ROUTES_V3.policy(':projectId')}`) {
    requirePermission(call,'access.admin');
    const policy = surface.startsWith('GET ') ? parseContract(policyStatusV3Schema,data,'policy status').current : parseContract(ownerPolicyV3Schema,data,'approved policy');
    add('project',policy.projectId,policy.projectId);
    return {resources,policyRevision:policy.fence.policyRevision};
  }
  const admissionKind=admissionKinds.get(surface);
  if(admissionKind) {
    if(admissionKind==='source.append') {
      const result=parseContract(sourceAppendResultSchema,data,'source acknowledgement');
      return {resources,admission:{kind:admissionKind,sourceIds:result.outcomes.flatMap(o=>o.status==='rejected'?[]:[o.sourceId])}};
    }
    const result=admissionKind.startsWith('task.')?parseContract(taskOperationResultSchema,data,'task acknowledgement'):parseContract(memoryOperationResultSchema,data,'memory acknowledgement');
    return {resources,admission:{kind:admissionKind,operationIds:[result.operationId]}};
  }
  if(surface===`GET ${ROUTES.projects}`)for(const row of data as unknown[]) {const project=parseContract(projectViewSchema,row,'project');add('project',project.projectId,project.projectId);}
  else if(surface===`POST ${ROUTES.projects}`){const project=parseContract(projectJoinResultSchema,data,'project association').project;add('project',project.projectId,project.projectId);}
  else if(surface===`GET ${ROUTES.history}`)for(const source of parseContract(sourceHistoryPageSchema,data,'history').entries)add('source',source.sourceId);
  else if(surface===`GET ${ROUTES.source(':sourceId')}`)add('source',parseContract(sourceViewSchema,data,'source').sourceId);
  else if(surface===`GET ${ROUTES.memories}`)for(const memory of parseContract(memoryQueryResultSchema,data,'memory page').memories)add('memory',memory.memoryId);
  else if(surface===`GET ${ROUTES.memory(':memoryId')}`)add('memory',parseContract(memoryViewSchema,data,'memory').memoryId);
  else if(surface===`GET ${ROUTES.task(':taskId')}`)add('task',parseContract(taskViewSchema,data,'task').taskId);
  else if(surface===`GET ${ROUTES.taskRequirements(':taskId')}`)add('task',parseContract(taskRequirementsViewSchema,data,'requirements').taskId);
  else if(surface===`GET ${ROUTES.operation(':operationId')}`)add('operation',parseContract(operationViewSchema,data,'operation').operationId);
  else if(surface===`POST ${ROUTES.context}`){const result=parseContract(contextResultSchema,data,'context');if(result.kind==='packet')add('occurrence',result.packet.occurrenceId);}
  else if(surface===`POST ${ROUTES.contextOccurrences}`)add('occurrence',parseContract(contextOccurrenceSchema,data,'occurrence').occurrenceId);
  return {resources};
}
