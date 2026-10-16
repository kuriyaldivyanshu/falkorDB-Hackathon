import {
  RUN_STATES,
  SESSION_STATES,
  TASK_CLAIM_STATES,
  type CancelRunOutcome,
  type RunInspectView,
  type RunStartOutcome,
  type StartRunInput,
} from '@threadline/shared';

import { BackendProtocolError, BackendUnreachableError, describeCause, isAbortError } from './errors.js';
import { authHeaders } from './auth.js';
import { BACKEND_ROUTES, routePath } from './routes.js';

/**
 * Authenticated run operations.
 *
 * Each answer is validated field by field before it is handed on. An HTTP 200 is
 * not treated as success: `start` in particular distinguishes an admitted run,
 * an accepted-but-pending acknowledgement, an idempotent replay and a
 * rejection, because those are four different facts.
 *
 * Nothing here infers a run state. Whatever the backend reported is what the
 * interface renders.
 */

export interface RunClientOptions {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly token: string | null;
  readonly fetchImpl?: typeof fetch;
}

export interface RunClient {
  readonly baseUrl: string;
  readonly authenticated: boolean;
  prepareRun(projectId: string, contextWindowTokens: number, profileId?: string): Promise<StartRunInput>;
  startRun(input: StartRunInput, signal?: AbortSignal): Promise<RunStartOutcome>;
  inspectRun(runId: string, signal?: AbortSignal): Promise<RunInspectView>;
  cancelRun(runId: string, reason: string, signal?: AbortSignal): Promise<CancelRunOutcome>;
}

export function createRunClient(options: RunClientOptions): RunClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const bearer = authHeaders(options.token);

  const call = async (
    route: string,
    init: { method: string; body?: unknown },
    signal: AbortSignal | undefined,
  ): Promise<{ url: string; status: number; body: unknown }> => {
    const url = `${baseUrl}${route}`;
    const timeout = AbortSignal.timeout(options.requestTimeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const headers: Record<string, string> = {
      ...bearer,
      accept: 'application/json',
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      const detail = isAbortError(error) ? `no answer within ${options.requestTimeoutMs}ms` : describeCause(error);
      throw new BackendUnreachableError(url, detail, { cause: error });
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch (error) {
      throw new BackendProtocolError(url, `the response body was not JSON (status ${response.status})`, response.status, { cause: error });
    }
    if (response.status >= 400 && isObject(body) && str(body['code']) && str(body['message'])) {
      const correlation = isObject(body['details']) && str(body['details']['correlationId']) ? ` correlation=${body['details']['correlationId']}` : '';
      throw new BackendProtocolError(url, `${body['code']}: ${body['message']}${correlation}`, response.status);
    }
    // The backend registers the run routes only when it has real run
    // configuration, and refuses to serve them otherwise. That refusal arrives
    // as a framework 404 rather than a run view, so it is reported as such
    // instead of being read as a malformed answer.
    if (response.status === 404 && !isRunAnswer(body)) {
      throw new BackendProtocolError(
        url,
        'the backend did not serve this route. Run routes are registered only ' +
          'when supported; run operations fail closed without required storage and credentials.',
        response.status,
      );
    }
    return { url, status: response.status, body };
  };

  return {
    baseUrl,
    authenticated: options.token !== null && options.token.length > 0,

    async prepareRun(projectId, contextWindowTokens,profileId) {
      const { url, status, body } = await call(BACKEND_ROUTES.runPrepare,
        { method: 'POST', body: { projectId, contextWindowTokens,profileId } }, undefined);
      if (status !== 200 || !isObject(body) || !str(body['projectId']) || !str(body['requestId']) ||
          !str(body['taskId']) || !str(body['profileId']) || !str(body['workspaceId']) ||
          !num(body['expectedRevision']) || !num(body['expectedRequirementRevision']))
        throw new BackendProtocolError(url, 'The backend refused preparation or returned incomplete identities.', status);
      return { projectId: body['projectId'], requestId: body['requestId'], taskId: body['taskId'],
        profileId: body['profileId'], workspaceId: body['workspaceId'], expectedRevision: body['expectedRevision'],
        expectedRequirementRevision: body['expectedRequirementRevision'] };
    },
    async startRun(input, signal) {
      const { url, status, body } = await call(BACKEND_ROUTES.runStart, { method: 'POST', body: input }, signal);
      const outcome = readRunStartOutcome(url, status, body);
      // A rejection is a normal outcome, not a protocol error.
      if (outcome.kind === 'rejected' && status < 400) {
        throw new BackendProtocolError(url, 'a rejection was answered with a success status', status);
      }
      return outcome;
    },

    async inspectRun(runId, signal) {
      const route = routePath(BACKEND_ROUTES.runInspect, { runId });
      const { url, body } = await call(route, { method: 'GET' }, signal);
      return readRunInspectView(url, null, body);
    },

    async cancelRun(runId, reason, signal) {
      const { url, body } = await call(BACKEND_ROUTES.runCancel, { method: 'POST', body: { runId, reason } }, signal);
      return readCancelOutcome(url, null, body);
    },
  };
}

// ---- validators -------------------------------------------------------------

/** True when the body looks like a run answer rather than a framework error page. */
function isRunAnswer(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value['kind'] === 'string' || typeof value['run'] === 'object' || Array.isArray(value['attempts']);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function str(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readRunStartOutcome(url: string, status: number, body: unknown): RunStartOutcome {
  if (!isObject(body) || !oneOf(body['kind'], ['admitted', 'accepted', 'replayed', 'rejected'] as const)) {
    throw new BackendProtocolError(url, 'the run start answer had no usable kind', status);
  }
  switch (body['kind']) {
    case 'admitted':
    case 'replayed':
      return { kind: body['kind'], run: readRunLaunchView(url, status, body['run']) };
    case 'accepted':
      const { runId, sessionId, pendingReason } = body;
      if (!str(runId) || !str(sessionId) || !str(pendingReason)) {
        throw new BackendProtocolError(url, 'a pending acknowledgement was incomplete', status);
      }
      return { kind: 'accepted', runId, sessionId, pendingReason };
    case 'rejected':
      const { code, reason, correlationId } = body;
      if (!str(code) || !str(reason) || !str(correlationId)) {
        throw new BackendProtocolError(url, 'a rejection was incomplete', status);
      }
      return { kind: 'rejected', code, reason, correlationId };
  }
}

function readRunLaunchView(url: string, status: number | null, value: unknown): import('@threadline/shared').RunLaunchView {
  if (!isObject(value)) throw new BackendProtocolError(url, 'the run view was not an object', status);
  const claim = value['claim'];
  const budget = value['budget'];
  if (!isObject(claim) || !isObject(budget)) {
    throw new BackendProtocolError(url, 'the run view had no claim or budget', status);
  }
  for (const field of ['runId', 'sessionId', 'projectId', 'taskId', 'profileId', 'workspaceId', 'model', 'graphEpoch', 'correlationId'] as const) {
    if (!str(value[field])) throw new BackendProtocolError(url, `the run view had no ${field}`, status);
  }
  if (!oneOf(value['state'], RUN_STATES) || !oneOf(value['sessionState'], SESSION_STATES)) {
    throw new BackendProtocolError(url, 'the run view had an unknown state', status);
  }
  if (!oneOf(claim['taskClaimState'], TASK_CLAIM_STATES) || !num(claim['fence']) || !num(claim['revision']) || !num(claim['requirementRevision']) || !str(claim['leaseExpiresAt'])) {
    throw new BackendProtocolError(url, 'the claim view was incomplete', status);
  }
  const ownerSessionId = claim['ownerSessionId'];
  if (ownerSessionId !== null && !str(ownerSessionId)) {
    throw new BackendProtocolError(url, 'the claim owner was neither null nor an id', status);
  }
  for (const field of ['maxAttempts', 'attemptsUsed', 'maxToolCalls', 'toolCallsUsed', 'maxTotalTokens', 'reservedTokens', 'observedTokens'] as const) {
    if (!num(budget[field])) throw new BackendProtocolError(url, `the budget view had no ${field}`, status);
  }
  if (!str(budget['deadlineAt']) || typeof budget['blockedOnReconciliation'] !== 'boolean') {
    throw new BackendProtocolError(url, 'the budget view was incomplete', status);
  }
  return value as unknown as import('@threadline/shared').RunLaunchView;
}

function readRunInspectView(url: string, status: number | null, body: unknown): RunInspectView {
  if (!isObject(body) || !Array.isArray(body['attempts'])) {
    throw new BackendProtocolError(url, 'the run inspection answer was incomplete', null);
  }
  for (const attempt of body['attempts']) {
    if (!isObject(attempt) || !str(attempt['logicalRequestId']) || !str(attempt['attemptId']) ||
        !num(attempt['attemptNo']) || !str(attempt['state']) || typeof attempt['possibleCharge'] !== 'boolean' ||
        !str(attempt['createdAt'])) {
      throw new BackendProtocolError(url, 'an attempt record was incomplete', status);
    }
    const providerRequestId = attempt['providerRequestId'];
    if (providerRequestId !== null && !str(providerRequestId)) {
      throw new BackendProtocolError(url, 'an attempt provider request id was neither null nor a string', status);
    }
    const finishedAt = attempt['finishedAt'];
    if (finishedAt !== null && !str(finishedAt)) {
      throw new BackendProtocolError(url, 'an attempt finish time was neither null nor a timestamp', status);
    }
  }
  const { unresolvedAttempts } = body;
  if (!num(unresolvedAttempts)) {
    throw new BackendProtocolError(url, 'the run inspection answer had no unresolved attempt count', status);
  }
  return {
    run: readRunLaunchView(url, status, body['run']),
    attempts: body['attempts'] as RunInspectView['attempts'],
    unresolvedAttempts,
  };
}

function readCancelOutcome(url: string, status: number | null, body: unknown): CancelRunOutcome {
  if (!isObject(body) || typeof body['acknowledged'] !== 'boolean' || !str(body['runId']) ||
      !oneOf(body['state'], RUN_STATES) || !oneOf(body['sessionState'], SESSION_STATES) ||
      typeof body['usageUncertain'] !== 'boolean' || !str(body['reason'])) {
    throw new BackendProtocolError(url, 'the cancel answer was incomplete', status);
  }
  return body as unknown as CancelRunOutcome;
}
