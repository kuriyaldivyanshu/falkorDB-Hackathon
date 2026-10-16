import { SseDecoder } from './sse.js';
import type { ReplayCursor, ReplayFrame } from '@threadline/shared';
import { ThreadlineError } from '@threadline/shared';
import type { ReplayPage } from '@threadline/shared';

import { authHeaders } from './auth.js';
import { routePath, SOURCE_BACKEND_ROUTES } from './routes.js';

/**
 * Client for Source inspection and durable replay.
 *
 * Transport only: it holds no database handle, no graph client and no retry
 * loop, and it never infers a Source state. Every view below is the backend's
 * own answer, including the states that report absence.
 *
 * Two client-side rules:
 *
 * - A `service_unavailable` reply is surfaced as such. It is never turned into
 *   an empty result, because "the backend cannot answer" and "nothing is there"
 *   are different facts and the interface must show which one occurred.
 * - Responses are bounded. A range reply is checked against the requested span
 *   so a backend that returns more than asked cannot quietly widen a read.
 */

export const SOURCE_ROUTE_MAX_BYTES = 32_768;
export const REPLAY_MAX_PAGE = 100;

export type SourceInspectionState = 'available' | 'missing' | 'denied' | 'pending' | 'corrupt';

export interface SourceInspectionView {
  readonly sourceId: string;
  readonly state: SourceInspectionState;
  readonly contentDigest?: string;
  readonly byteSize?: number;
  readonly artifactKind?: string;
  readonly visibility?: string;
  readonly reason?: string;
}

export interface SourceRangeView {
  readonly sourceId: string;
  readonly offset: number;
  readonly returnedBytes: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  readonly base64: string;
  readonly contentDigest: string;
  readonly encodedBytes: number;
}

export interface ReconnectQuery {
  readonly graphEpoch: string;
  readonly afterSeq: number;
  readonly limit?: number;
}

export interface SourceClientDeps {
  /** Authenticated GET. Rejects with a `ThreadlineError` on a typed failure. */
  get(url: string): Promise<unknown>;
  follow?(projectId: string, cursor: ReplayCursor, hooks: {
    frame(frame: ReplayFrame): void;
    status(page: ReplayPage): void;
    error(error: unknown): void;
  }): { close(): void };
}

const inspectionStates: readonly SourceInspectionState[] = ['available', 'missing', 'denied', 'pending', 'corrupt'];

function inspectUrl(projectId: string, sourceId: string): string {
  return routePath(SOURCE_BACKEND_ROUTES.sourceInspect,{projectId,sourceId});
}

function rangeUrl(projectId: string, sourceId: string, offset: number, maxBytes: number): string {
  return `${inspectUrl(projectId, sourceId)}/range?offset=${offset}&maxBytes=${maxBytes}`;
}

function replayUrl(projectId: string, query: ReconnectQuery): string {
  const limit = query.limit ?? REPLAY_MAX_PAGE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REPLAY_MAX_PAGE) {
    throw new ThreadlineError('invalid_request', `limit must be between 1 and ${REPLAY_MAX_PAGE}.`);
  }
  if (!Number.isSafeInteger(query.afterSeq) || query.afterSeq < 0) {
    throw new ThreadlineError('invalid_request', 'afterSeq must be a non-negative integer.');
  }
  return `${routePath(SOURCE_BACKEND_ROUTES.historyReplay,{projectId})}?epoch=${encodeURIComponent(query.graphEpoch)}&afterSeq=${query.afterSeq}&limit=${limit}`;
}

function parseInspection(payload: unknown, sourceId: string): SourceInspectionView {
  const body = (payload ?? {}) as Record<string, unknown>;
  const state = body.state;
  if (typeof state !== 'string' || !inspectionStates.includes(state as SourceInspectionState)) {
    throw new ThreadlineError('storage_unavailable', 'The backend reported an unrecognised Source state.');
  }
  return {
    sourceId: typeof body.sourceId === 'string' ? body.sourceId : sourceId,
    state: state as SourceInspectionState,
    contentDigest: typeof body.contentDigest === 'string' ? body.contentDigest : undefined,
    byteSize: typeof body.byteSize === 'number' ? body.byteSize : undefined,
    artifactKind: typeof body.artifactKind === 'string' ? body.artifactKind : undefined,
    visibility: typeof body.visibility === 'string' ? body.visibility : undefined,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  };
}

/** Reads one Source's typed state. Never returns a physical locator. */
export async function inspectSourceView(deps: SourceClientDeps, projectId: string, sourceId: string): Promise<SourceInspectionView> {
  if (!sourceId || sourceId.length > 128) throw new ThreadlineError('invalid_request', 'A Source identifier is required.');
  return parseInspection(await deps.get(inspectUrl(projectId, sourceId)), sourceId);
}

/** Reads one bounded byte range and verifies it matches what was requested. */
export async function readSourceRange(
  deps: SourceClientDeps,
  projectId: string,
  sourceId: string,
  offset: number,
  maxBytes: number,
): Promise<SourceRangeView> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ThreadlineError('invalid_request', 'offset must be a non-negative integer.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SOURCE_ROUTE_MAX_BYTES) {
    throw new ThreadlineError('invalid_request', `maxBytes must be between 1 and ${SOURCE_ROUTE_MAX_BYTES}.`);
  }
  const body = (await deps.get(rangeUrl(projectId, sourceId, offset, maxBytes)) ?? {}) as Record<string, unknown>;
  const returnedBytes = body.returnedBytes;
  if (body.sourceId !== sourceId || body.offset !== offset || typeof body.totalBytes !== 'number'
      || !Number.isSafeInteger(body.totalBytes) || body.totalBytes < offset)
    throw new ThreadlineError('storage_unavailable','The backend returned a different Source range.');
  if (typeof returnedBytes !== 'number' || returnedBytes < 1 || returnedBytes > maxBytes) {
    throw new ThreadlineError('storage_unavailable', 'The backend returned a range outside the requested bounds.');
  }
  if (typeof body.base64 !== 'string' || Buffer.byteLength(body.base64, 'utf8') !== Math.ceil(returnedBytes / 3) * 4
    || Buffer.from(body.base64,'base64').length !== returnedBytes || Buffer.from(body.base64,'base64').toString('base64') !== body.base64
    || offset+returnedBytes > body.totalBytes) {
    throw new ThreadlineError('storage_unavailable', 'The returned range did not match its declared size.');
  }
  return {
    sourceId: typeof body.sourceId === 'string' ? body.sourceId : sourceId,
    offset: typeof body.offset === 'number' ? body.offset : offset,
    returnedBytes,
    totalBytes: typeof body.totalBytes === 'number' ? body.totalBytes : 0,
    truncated: body.truncated === true,
    base64: body.base64,
    contentDigest: typeof body.contentDigest === 'string' ? body.contentDigest : '',
    encodedBytes: typeof body.encodedBytes === 'number' ? body.encodedBytes : Buffer.byteLength(body.base64, 'utf8'),
  };
}

/** Requests one bounded catch-up page from a durable cursor. */
export async function replayPage(deps: SourceClientDeps, projectId: string, query: ReconnectQuery): Promise<ReplayPage> {
  const body = (await deps.get(replayUrl(projectId, query)) ?? {}) as Record<string, unknown>;
  const cursor = body.cursor as Record<string, unknown> | undefined;
  if (!cursor || typeof cursor.graphEpoch !== 'string' || typeof cursor.afterSeq !== 'number') {
    throw new ThreadlineError('storage_unavailable', 'The backend did not return a usable replay cursor.');
  }
  const frames = Array.isArray(body.frames) ? body.frames : [];
  const gap = body.gap as Record<string, unknown> | null | undefined;
  return {
    frames: frames as ReplayPage['frames'],
    admission: body.admission as ReplayPage['admission'],
    cursor: { graphEpoch: cursor.graphEpoch, afterSeq: cursor.afterSeq },
    hasMore: body.hasMore === true,
    // A gap without both bounds cannot be shown as an interval, so it is not
    // invented here: the reducer reports nothing rather than a made-up range.
    gap: gap && typeof gap.fromSeq === 'number' && typeof gap.toSeq === 'number'
      ? { fromSeq: gap.fromSeq, toSeq: gap.toSeq }
      : null,
  };
}

export { routePath };

/**
 * Builds a `SourceClient` over the authenticated transport.
 *
 * The bearer token is sent only as a header, never in a URL or a body.
 *
 * There is deliberately no reader/tenant parameter: scope is resolved entirely
 * by the backend from the authenticated session, so the client holds no value it
 * could use to widen its own access.
 */
export function createSourceClient(options: {
  baseUrl: string;
  token: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): SourceClientDeps {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options.token);
  return {
    follow(projectId, initial, hooks) {
      let stopped=false, cursor=initial, controller: AbortController | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const connect = async () => {
        controller = new AbortController();
        try {
          const url = `${routePath(SOURCE_BACKEND_ROUTES.historyEvents,{projectId})}?epoch=${encodeURIComponent(cursor.graphEpoch)}&afterSeq=${cursor.afterSeq}`;
          const response = await doFetch(`${base}${url}`, { headers: { ...headers, accept:'text/event-stream',
            'Last-Event-ID': `${cursor.graphEpoch}:${cursor.afterSeq}` }, signal:controller.signal });
          if (!response.ok || !response.body) {
            const error=new Error(`Durable replay refused (${response.status}); refresh the cursor or reauthenticate.`);
            if (response.status>=400 && response.status<500) { hooks.error(error);stopped=true;return; }
            throw error;
          }
          const reader=response.body.getReader(), decoder=new SseDecoder(), text=new TextDecoder();
          try {
            while (!stopped) {
              const next=await reader.read(); if (next.done) break;
              for (const event of decoder.push(text.decode(next.value,{stream:true}))) {
                if (event.event==='history.event') {
                  const frame=JSON.parse(event.data) as ReplayFrame;
                  if (frame.graphEpoch!==cursor.graphEpoch || frame.seq!==cursor.afterSeq+1) throw new Error('Durable replay gap; refresh the cursor.');
                  hooks.frame(frame); cursor={graphEpoch:frame.graphEpoch,afterSeq:frame.seq};
                } else if (event.event==='history.cursor') {
                  const state=JSON.parse(event.data) as {admission?:ReplayPage['admission']};
                  hooks.status({frames:[],cursor,hasMore:false,admission:state.admission});
                } else if (event.event==='history.gap') {
                  hooks.status(JSON.parse(event.data) as ReplayPage); stopped=true; controller.abort();
                } else if (event.event==='history.refused') {
                  stopped=true; hooks.error(new Error('Unauthorized durable delivery; reauthenticate or refresh the cursor.')); controller.abort();
                }
              }
            }
          } finally { await reader.cancel().catch(() => {}); }
        } catch (error) { if (!stopped) hooks.error(error); }
        if (!stopped) retry=setTimeout(() => { void connect(); },1000);
      };
      void connect();
      return { close() { stopped=true; clearTimeout(retry); controller?.abort(); } };
    },
    async get(url: string): Promise<unknown> {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
      const response = await doFetch(`${base}${url}`, { headers, signal: timeout });
      const parts: Uint8Array[]=[];let size=0;
      if (response.body) {
        const reader=response.body.getReader();
        try {
          for (;;) { const next=await reader.read();if(next.done) break;size+=next.value.byteLength;
            if(size>1048576) throw new ThreadlineError('storage_unavailable','Source/history response exceeds the client limit.');parts.push(next.value); }
        } finally { await reader.cancel().catch(()=>{}); }
      }
      const text=Buffer.concat(parts).toString('utf8');
      let value: unknown = null;
      try {
        value = text.length > 0 ? (JSON.parse(text) as unknown) : null;
      } catch {
        throw new ThreadlineError('storage_unavailable', 'The backend response was not JSON.');
      }
      if (!response.ok) {
        const body = (value ?? {}) as Record<string, unknown>;
        const code = typeof body.code === 'string' ? body.code : 'storage_unavailable';
        throw new ThreadlineError(
          code as ThreadlineError['code'],
          typeof body.message === 'string' ? body.message : `request failed (${response.status})`,
        );
      }
      return value;
    },
  };
}
