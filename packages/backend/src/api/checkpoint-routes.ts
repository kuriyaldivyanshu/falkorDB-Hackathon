import type { FastifyInstance } from 'fastify';

import {
  CHECKPOINT_ROUTES,
  RECOVERY_BATCH_EVENTS,
  MAX_PLAN_STEPS,
  PLAN_STEP_STATUSES,
  ThreadlineError,
  isDecimalSequence,
  isUuid,
  type CheckpointScope,
  type CheckpointService,
  type CheckpointSubmission,
  type CheckpointRecoveryReport,
  type TacticalStateView,
} from '@threadline/shared';

import type { ApplicationServices } from '../domain/services.js';

/**
 * HTTP transport for checkpoints and tactical state.
 *
 * Paths come from `CHECKPOINT_ROUTES` verbatim. This module translates transport
 * into a service call and a status code and holds no domain logic: it builds no
 * manifest, resolves no transition and decides no durability.
 *
 * **Scope is resolved, never supplied.** The `:projectId` and `:taskId` path
 * segments are a *requested target*. They are checked against the caller's own
 * authority, and a caller naming a project or task it does not hold receives
 * `not_found` rather than `unauthorized`, so existence is not discoverable from
 * outside. A `runId` in the body is likewise a target: it is verified against
 * the durable run before it enters the scope.
 *
 * Every field that the contract calls server-owned stays absent from this
 * boundary. `taskId`, `tenantId`, `userId`, `runId` and `agentSessionId` are
 * resolved here and cannot be supplied.
 */

/** One bound submission body. Bounded so a huge payload cannot reach the service. */
const SUBMIT_BODY_LIMIT = 256 * 1024;

export interface CheckpointRouteDeps {
  readonly services: () => ApplicationServices | null;
}

interface ResolvedScope extends CheckpointScope {
  /** The revision the caller believes is current, when it stated one. */
  readonly submittedBaseRevision: string | null;
}

function requireServices(deps: CheckpointRouteDeps): ApplicationServices {
  const services = deps.services();
  if (services === null) {
    throw new ThreadlineError('storage_unavailable', 'Durable routes need storage to be running.');
  }
  return services;
}

function requireCheckpointService(services: ApplicationServices): CheckpointService {
  const service = services.checkpoints();
  if (service === null) {
    // Not composed. This is reported as unavailable rather than as an empty
    // checkpoint, so it can never read as "nothing has been recorded".
    throw new ThreadlineError(
      'service_unavailable',
      'The checkpoint service is not composed in this backend. No checkpoint state is being reported.',
    );
  }
  return service;
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a revision token without ever routing it through `Number`.
 *
 * A revision is `bigint` in SQL. Parsing one as a double would round it and then
 * misreport which revision is current, so an unsafe numeric form is refused
 * rather than converted.
 */
function readRevisionToken(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ThreadlineError('invalid_request', `${field} must be a decimal string.`, { field });
  }
  if (!isDecimalSequence(value)) {
    throw new ThreadlineError('invalid_request', `${field} must be a decimal string.`, { field });
  }
  // A revision crosses the wire as a decimal string and is never parsed. There
  // is therefore no floating-point threshold to apply: `9007199254740993` is a
  // perfectly good token, because nothing ever turns it into a double.
  //
  // What is checked instead is canonical syntax (no sign, no leading zeros, no
  // whitespace) and a length bound. The bound is about storage and transport
  // cost, not precision: SQL `numeric` holds far more, and `bigint` holds
  // 19 digits, so 32 characters leaves headroom without truncating anything the
  // system can actually produce.
  const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;
  const MAX_REVISION_CHARS = 32;
  if (!CANONICAL_DECIMAL.test(value)) {
    throw new ThreadlineError(
      'invalid_request',
      `${field} must be a canonical decimal string such as 7 or 9007199254740993.`,
      { field },
    );
  }
  if (value.length > MAX_REVISION_CHARS) {
    throw new ThreadlineError('invalid_request', `${field} exceeds the supported length of ${MAX_REVISION_CHARS} digits.`, { field });
  }
  return value;
}

function requireOperationId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ThreadlineError('invalid_request', 'A durable operationId is required.');
  }
  return value;
}

/**
 * Builds the submission.
 *
 * Only the fields a caller may propose survive. Anything server-owned in the body
 * is refused by name rather than dropped, because a silently ignored override
 * reads as a successful write.
 */
function parseSubmission(body: unknown, baseRevision: string | null): CheckpointSubmission {
  if (!isRecord(body)) throw new ThreadlineError('invalid_request', 'A checkpoint submission is required.');
  // `runId` is accepted only as a *target*: it is consumed by scope resolution,
  // verified against the durable run, and never copied into the submission.
  const allowed = ['operationId', 'proposed', 'planPatch', 'baseRevision', 'pendingQuestionId', 'runId'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      // Named explicitly: a caller must learn that its field was refused.
      throw new ThreadlineError(
        'invalid_request',
        `"${key}" is resolved by the server and cannot be submitted.`,
        { field: key },
      );
    }
  }
  const operationId = requireOperationId(body['operationId']);
  // Built as a mutable draft and returned as the readonly contract.
  const draft: {
    operationId: string;
    proposed?: CheckpointSubmission['proposed'];
    planPatch?: NonNullable<CheckpointSubmission['planPatch']>;
    baseRevision?: string;
    pendingQuestionId?: string | null;
  } = { operationId };

  if (body['proposed'] !== undefined && body['proposed'] !== null) {
    if (!isRecord(body['proposed'])) throw new ThreadlineError('invalid_request', 'proposed must be an object.');
    const proposed = body['proposed'];
    const proposedAllowed = ['progress', 'next_action'];
    for (const key of Object.keys(proposed)) {
      if (!proposedAllowed.includes(key)) {
        throw new ThreadlineError('invalid_request', `"proposed.${key}" is resolved by the server.`, { field: key });
      }
    }
    for(const field of ['progress','next_action'])if(proposed[field]!==undefined&&typeof proposed[field]!=='string')
      throw new ThreadlineError('invalid_request',`proposed.${field} must be a string.`);
    draft.proposed = {
      ...(proposed['progress'] === undefined ? {} : { progress: String(proposed['progress']) }),
      ...(proposed['next_action'] === undefined ? {} : { next_action: String(proposed['next_action']) }),
    };
  }

  if (body['planPatch'] !== undefined && body['planPatch'] !== null) {
    if (!Array.isArray(body['planPatch'])) throw new ThreadlineError('invalid_request', 'planPatch must be an array.');
    if(body['planPatch'].length>MAX_PLAN_STEPS)throw new ThreadlineError('invalid_request','A plan patch may contain at most eight steps.');
    const ids=new Set<string>();
    draft.planPatch = body['planPatch'].map((entry) => {
      if (!isRecord(entry)) throw new ThreadlineError('invalid_request', 'Each plan patch entry must be an object.');
      for (const key of Object.keys(entry)) {
        if (!['step_id', 'text', 'status'].includes(key)) {
          throw new ThreadlineError('invalid_request', `"planPatch.${key}" is not a patchable field.`, { field: key });
        }
      }
      if(typeof entry['step_id']!=='string'||!entry['step_id']||entry['step_id'].length>128||ids.has(entry['step_id']))
        throw new ThreadlineError('invalid_request','Plan step ids must be nonempty, bounded and unique.');
      ids.add(entry['step_id']);
      if(entry['text']!==undefined&&typeof entry['text']!=='string')throw new ThreadlineError('invalid_request','Plan text must be a string.');
      if(entry['status']!==undefined&&!(PLAN_STEP_STATUSES as readonly unknown[]).includes(entry['status']))
        throw new ThreadlineError('invalid_request','Unknown plan status.');
      return {step_id:entry['step_id'],...(entry['text']===undefined?{}:{text:entry['text']}),
        ...(entry['status']===undefined?{}:{status:entry['status'] as typeof PLAN_STEP_STATUSES[number]})};
    });
  }

  const declaredBase = readRevisionToken(body['baseRevision'], 'baseRevision');
  const resolvedBase = declaredBase ?? baseRevision;
  if (resolvedBase !== null) draft.baseRevision = resolvedBase;

  if (body['pendingQuestionId'] !== undefined) {
    const id = body['pendingQuestionId'];
    if (id !== null && typeof id !== 'string') throw new ThreadlineError('invalid_request', 'pendingQuestionId must be a string or null.');
    draft.pendingQuestionId = id as string | null;
  }

  if (draft.proposed === undefined && (draft.planPatch === undefined || draft.planPatch.length === 0)) {
    throw new ThreadlineError('invalid_request', 'A submission must propose state or patch at least one step.');
  }
  return draft as CheckpointSubmission;
}

export function registerCheckpointRoutes(app: FastifyInstance, deps: CheckpointRouteDeps): void {
  /**
   * Resolves the caller's authoritative scope.
   *
   * Membership is proven by reading the caller's own authority, and the task in
   * the path must match it. A run named in the body is verified against the
   * durable run, so a caller cannot attach a checkpoint to another run.
   */
  const scopeFor = async (
    request: { params: unknown; query: unknown; body?: unknown },
    params: { projectId: string; taskId: string },
  ): Promise<ResolvedScope> => {
    const services = requireServices(deps);
    const principal = await services.authenticate(
      readHeader((request as { headers?: Record<string, unknown> }).headers?.['authorization'] as string | string[] | undefined),
    );

    let authority: Awaited<ReturnType<ApplicationServices['authority']>>;
    try {
      authority = await services.authority(principal, params.projectId);
    } catch {
      // `not_found`, not `unauthorized`: a caller outside the scope must not
      // learn that the project or task exists.
      throw new ThreadlineError('not_found', 'No such task.');
    }
    if (authority.taskId !== params.taskId) {
      throw new ThreadlineError('not_found', 'No such task.');
    }

    let runId: string | null = null;
    let agentSessionId: string | null = null;
    const body = request.body;
    const requestedRun = isRecord(body) && typeof body['runId'] === 'string' ? body['runId'] : null;
    if (requestedRun !== null) {
      const execution = requireServices(deps).execution();
      if (execution === null) {
        throw new ThreadlineError('storage_unavailable', 'The execution surface is unavailable.');
      }
      let run: Awaited<ReturnType<typeof execution.inspect>>;
      try {
        run = await execution.inspect(principal, requestedRun);
      } catch {
        throw new ThreadlineError('not_found', 'No such run.');
      }
      // The run must belong to this project and task, or it is not a target here.
      if (run.run.projectId !== authority.projectId || run.run.taskId !== authority.taskId) {
        throw new ThreadlineError('not_found', 'No such run.');
      }
      runId = run.run.runId;
      agentSessionId = run.run.sessionId;
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    return {
      tenantId: principal.tenantId,
      projectId: authority.projectId,
      userId: principal.userId,
      taskId: authority.taskId,
      runId,
      agentSessionId,
      submittedBaseRevision: readRevisionToken(query['baseRevision'], 'baseRevision'),
    };
  };

  const paramsOf = (raw: unknown): { projectId: string; taskId: string } => {
    const params = raw as { projectId?: unknown; taskId?: unknown };
    if (typeof params.projectId !== 'string' || !isUuid(params.projectId)) {
      throw new ThreadlineError('invalid_request', 'A project identifier is required.');
    }
    if (typeof params.taskId !== 'string' || !isUuid(params.taskId)) {
      throw new ThreadlineError('invalid_request', 'A task identifier is required.');
    }
    return { projectId: params.projectId, taskId: params.taskId };
  };

  app.get(CHECKPOINT_ROUTES.state, async (request, reply) => {
    const params = paramsOf(request.params);
    const scope = await scopeFor(request, params);
    const view: TacticalStateView = await requireCheckpointService(requireServices(deps)).inspect({
      tenantId: scope.tenantId, projectId: scope.projectId, userId: scope.userId,
      taskId: scope.taskId, runId: scope.runId, agentSessionId: scope.agentSessionId,
    });
    return reply.code(200).send(view);
  });

  app.post(CHECKPOINT_ROUTES.submit, { bodyLimit: SUBMIT_BODY_LIMIT }, async (request, reply) => {
    const params = paramsOf(request.params);
    const scope = await scopeFor(request, params);
    const submission = parseSubmission(request.body, scope.submittedBaseRevision);
    const result = await requireCheckpointService(requireServices(deps)).submit({
      tenantId: scope.tenantId, projectId: scope.projectId, userId: scope.userId,
      taskId: scope.taskId, runId: scope.runId, agentSessionId: scope.agentSessionId,
    }, submission);
    // A rejection is a completed answer: 409 for a conflict the caller must
    // reconcile, 202 when bytes are durable but publication is outstanding.
    if (result.state === 'rejected') {
      const kind = result.rejection?.kind;
      const status = kind === 'stale_revision' || kind === 'payload_conflict' ? 409
        : kind === 'unauthorized' ? 403
        : 422;
      return reply.code(status).send(result);
    }
    return reply.code(result.state === 'committed' ? 200 : 202).send(result);
  });

  app.post(CHECKPOINT_ROUTES.recover, async (request, reply) => {
    const params = paramsOf(request.params);
    const scope = await scopeFor(request, params);
    const body = request.body;
    let limit = RECOVERY_BATCH_EVENTS;
    if (body !== undefined && body !== null) {
      if (!isRecord(body)) throw new ThreadlineError('invalid_request', 'A recover request must be an object.');
      for (const key of Object.keys(body)) {
        if (key !== 'limit') throw new ThreadlineError('invalid_request', `"${key}" is not a recover option.`, { field: key });
      }
      const raw = body['limit'];
      if (raw !== undefined) {
        if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > RECOVERY_BATCH_EVENTS) {
          throw new ThreadlineError('invalid_request', `limit must be an integer between 1 and ${RECOVERY_BATCH_EVENTS}.`);
        }
        limit = raw;
      }
    }
    const report: CheckpointRecoveryReport = await requireCheckpointService(requireServices(deps)).recover({
      tenantId: scope.tenantId, projectId: scope.projectId, userId: scope.userId,
      taskId: scope.taskId, runId: scope.runId, agentSessionId: scope.agentSessionId,
    }, { limit });
    return reply.code(report.state === 'blocked' ? 409 : 200).send(report);
  });
}