import { CHECKPOINT_ROUTES, ThreadlineError } from '@threadline/shared';
import type { CheckpointRecoveryReport, CheckpointResult, TacticalStateView } from '@threadline/shared';

import { authHeaders } from './auth.js';

/**
 * Real HTTP transport for checkpoint routes.
 *
 * Paths come from `CHECKPOINT_ROUTES`. The bearer token is sent only as a
 * header, never in a URL or a body. Revisions cross the wire as decimal strings
 * and are never converted to a number on the way out.
 */

const FRESHNESS = ['ready', 'stale', 'blocked', 'capture_pending'] as const;
const PUBLICATION: readonly string[] = ['committed', 'pending', 'ambiguous', 'rejected'];

export interface TacticalHttpOptions {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface CheckpointRoutes {
  /** `CHECKPOINT_ROUTES` with `:projectId`/`:taskId` already substituted. */
  readonly submit: string;
  readonly state: string;
  readonly recover: string;
}

/** Substitutes the two path parameters a checkpoint route always carries. */
export function checkpointRoutes(projectId: string, taskId: string): CheckpointRoutes {
  const fill = (template: string): string =>
    template.replace(':projectId', encodeURIComponent(projectId)).replace(':taskId', encodeURIComponent(taskId));
  return { submit: fill(CHECKPOINT_ROUTES.submit), state: fill(CHECKPOINT_ROUTES.state), recover: fill(CHECKPOINT_ROUTES.recover) };
}

/** The published templates, for a caller that wants to show the route family. */
export const CHECKPOINT_ROUTE_TEMPLATES = CHECKPOINT_ROUTES;

export interface TacticalHttp {
  readState(routes: CheckpointRoutes): Promise<TacticalStateView>;
  submit(routes: CheckpointRoutes, submission: Record<string, unknown>): Promise<CheckpointResult>;
  recover(routes: CheckpointRoutes, options?: { readonly limit?: number }): Promise<CheckpointRecoveryReport>;
}

export function createTacticalHttp(options: TacticalHttpOptions): TacticalHttp {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options.token);

  const send = async (path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const response = await doFetch(`${base}${path}`, {
      method: init.method,
      headers: { ...headers, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: timeout,
    });
    const text = await response.text();
    let value: unknown = null;
    if (text.length > 0) {
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        throw new ThreadlineError('storage_unavailable', 'The backend response was not JSON.');
      }
    }
    if (!response.ok) {
      const body = (value ?? {}) as Record<string, unknown>;
      // A checkpoint route answers a rejection with the authoritative result and
      // a 4xx status. That is a completed answer, not a transport failure, so
      // it is returned rather than turned into an opaque error — otherwise a
      // legitimate stale-revision conflict would read as "unavailable".
      if (typeof body['state'] === 'string' && PUBLICATION.includes(body['state'])) {
        return value;
      }
      // Otherwise it is a typed backend error and its code is preserved.
      throw new ThreadlineError(
        (typeof body.code === 'string' ? body.code : 'storage_unavailable') as ThreadlineError['code'],
        typeof body.message === 'string' ? body.message : `request failed (${response.status})`,
      );
    }
    return value;
  };

  return {
    readState(routes) {
      const body = (send(routes.state, { method: 'GET' }) ?? {}) as Promise<Record<string, unknown>>;
      return body.then((value) => {
        const freshness = value['freshness'];
        if (typeof freshness !== 'string' || !(FRESHNESS as readonly string[]).includes(freshness)) {
          throw new ThreadlineError('storage_unavailable', 'The backend reported an unrecognised checkpoint freshness.');
        }
        return value as unknown as TacticalStateView;
      });
    },
    submit(routes, submission) {
      // The status is deliberately not checked here: `send` already decides.
      return send(routes.submit, { method: 'POST', body: submission }).then((value) => {
        const state = (value as Record<string, unknown>)['state'];
        if (typeof state !== 'string' || !PUBLICATION.includes(state)) {
          throw new ThreadlineError('storage_unavailable', 'The backend reported an unrecognised publication state.');
        }
        return value as CheckpointResult;
      });
    },
    recover(routes, opts) {
      return send(routes.recover, { method: 'POST', body: opts ?? {} }) as Promise<CheckpointRecoveryReport>;
    },
  };
}