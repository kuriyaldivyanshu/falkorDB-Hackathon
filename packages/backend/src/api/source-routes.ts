import { openHistoryStream } from './history-stream.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ThreadlineError, isUuid } from '@threadline/shared';
import { SOURCE_RANGE_MAX_BYTES } from '@threadline/shared';
import type { ReplayCursor, ReplayPage, SourceReader } from '@threadline/shared';
import type { ApplicationServices } from '../domain/services.js';
import { inspectSource } from '../capture/sources.js';

/**
 * Source inspection and durable replay transport.
 *
 * Paths are declared here and mirrored in `packages/cli/src/transport/routes.ts`.
 * They follow the existing unversioned convention; the `/v1` shapes in the notes
 * were proposals and are deliberately not used.
 *
 * Two rules govern every route:
 *
 * - **Scope is resolved, never supplied.** The caller names a project, which is
 *   only a request to look there. The tenant, user and human session come from
 *   the authenticated principal, and access is rechecked on every read.
 * - **An unavailable dependency is reported as unavailable.** `SourceService` and
 *   `ReplayService` may not be composed yet. Those routes return
 *   `service_unavailable` instead of an empty success, so a caller can never
 *   mistake a missing capability for an empty project.
 */

/** `capture_policy.graph_replay_batch_events` in the development profile. */
export const REPLAY_MAX_PAGE = 100;

/** `tool_limits.model_tool_output_max_bytes`, which bounds one range response. */
export const SOURCE_ROUTE_MAX_BYTES = SOURCE_RANGE_MAX_BYTES;

/** Reply shapes, exported so the client and tests share one definition. */
export interface SourceInspectionView {
  readonly sourceId: string;
  readonly state: 'available' | 'missing' | 'denied' | 'pending' | 'corrupt';
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
  /** Base64 of exactly `returnedBytes` bytes. */
  readonly base64: string;
  readonly contentDigest: string;
  /** What this range costs once encoded, which is what a request budget charges. */
  readonly encodedBytes: number;
}

export const SOURCE_ROUTES = {
  sourceInspect: '/projects/:projectId/sources/:sourceId',
  sourceRange: '/projects/:projectId/sources/:sourceId/range',
  historyReplay: '/projects/:projectId/history/replay',
  historyEvents: '/projects/:projectId/history/events',
} as const;

function positiveInt(value: unknown, field: string, maximum: number): number {
  if (value === undefined || value === null) throw new ThreadlineError('invalid_request', `${field} is required.`);
  if (typeof value !== 'number' && typeof value !== 'string') throw new ThreadlineError('invalid_request', `${field} must be an integer.`);
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new ThreadlineError('invalid_request', `${field} must be an integer between 0 and ${maximum}.`);
  }
  return parsed;
}

export function registerSourceRoutes(app: FastifyInstance, deps: {
  services: () => ApplicationServices | null;
  localBootstrap: () => { userId?: string } | null;
}) {
  /**
   * Resolves the caller into a `SourceReader`.
   *
   * A caller that is not the local owner, or that cannot be shown to be in the
   * project's scope, is answered `not_found`. Reporting `unauthorized`
   * separately would let an outside caller learn that a project or a Source
   * exists, so the two stay indistinguishable from outside.
   */
  async function readerFor(request: FastifyRequest, projectId: unknown): Promise<SourceReader> {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) || request.headers.origin) {
      throw new ThreadlineError('unauthorized', 'Source inspection is available only to the local terminal owner.');
    }
    if (typeof projectId !== 'string' || !isUuid(projectId)) {
      throw new ThreadlineError('invalid_request', 'A project identifier is required.');
    }
    const services = deps.services();
    if (!services) throw new ThreadlineError('service_unavailable', 'Local owner authentication is unavailable.');
    const principal = await services.authenticate(
      typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined,
    );
    if (deps.localBootstrap()?.userId !== undefined && principal.userId !== deps.localBootstrap()?.userId) {
      throw new ThreadlineError('not_found', 'No such Source.');
    }
    try {
      await services.authority(principal, projectId);
    } catch (error) {
      if (error instanceof ThreadlineError && error.code === 'storage_unavailable') throw error;
      throw new ThreadlineError('not_found', 'No such Source.');
    }
    return {
      tenantId: principal.tenantId,
      userId: principal.userId,
      projectId,
      userSessionId: principal.sessionId,
    };
  }

  const sourceOf = (services: ApplicationServices) => {
    const source = services.sources();
    if (!source) {
      throw new ThreadlineError(
        'service_unavailable',
        'Source inspection is not composed in this backend. No Source state is being reported.',
      );
    }
    return source;
  };

  app.get(SOURCE_ROUTES.sourceInspect, async (request): Promise<SourceInspectionView> => {
    const params = request.params as { projectId?: string; sourceId?: string };
    const reader = await readerFor(request, params.projectId);
    const sourceId = params.sourceId;
    if (typeof sourceId !== 'string' || sourceId.length === 0 || sourceId.length > 128 || /[\x00-\x1f\x7f]/.test(sourceId)) {
      throw new ThreadlineError('invalid_request', 'A Source identifier is required.');
    }
    const services = deps.services();
    if (!services) throw new ThreadlineError('service_unavailable', 'Source inspection is unavailable.');

    const inspection = await inspectSource({ source: sourceOf(services), reader, sourceId });
    if (inspection.state === 'available') {
      return {
        sourceId: inspection.sourceId,
        state: 'available',
        contentDigest: inspection.contentDigest,
        byteSize: inspection.byteSize,
        artifactKind: inspection.kind,
        visibility: inspection.visibility,
      };
    }
    return { sourceId: inspection.sourceId, state: inspection.state, reason: inspection.reason };
  });

  app.get(SOURCE_ROUTES.sourceRange, { bodyLimit: 4 * 1024 * 1024 }, async (request): Promise<SourceRangeView> => {
    const params = request.params as { projectId?: string; sourceId?: string };
    const query = request.query as { offset?: unknown; maxBytes?: unknown };
    const reader = await readerFor(request, params.projectId);
    const sourceId = params.sourceId;
    if (typeof sourceId !== 'string' || sourceId.length === 0 || sourceId.length > 128 || /[\x00-\x1f\x7f]/.test(sourceId)) {
      throw new ThreadlineError('invalid_request', 'A Source identifier is required.');
    }
    // Defaults mirror the model tool: an absent offset reads from the start.
    const offset = query.offset === undefined ? 0 : positiveInt(query.offset, 'offset', Number.MAX_SAFE_INTEGER);
    const maxBytes = query.maxBytes === undefined ? SOURCE_ROUTE_MAX_BYTES : positiveInt(query.maxBytes, 'maxBytes', SOURCE_ROUTE_MAX_BYTES);
    if (maxBytes === 0) throw new ThreadlineError('invalid_request', 'maxBytes must be at least 1.');

    const services = deps.services();
    if (!services) throw new ThreadlineError('service_unavailable', 'Source inspection is unavailable.');
    const source = sourceOf(services);

    // Availability is rechecked on the read itself, so a Source that disappeared
    // between the two calls fails loudly instead of returning empty bytes.
    const inspection = await inspectSource({ source, reader, sourceId });
    if (inspection.state !== 'available') {
      throw new ThreadlineError('not_found', 'No such Source.', { state: inspection.state });
    }
    const byteSize = inspection.byteSize;
    if (offset >= byteSize) throw new ThreadlineError('invalid_request', 'offset is at or past the end of the Source.');
    const end = Math.min(offset + maxBytes, byteSize);

    const range = await source.readRange(reader, sourceId, offset, end);
    if (range.end - range.start !== end - offset) {
      throw new ThreadlineError('storage_unavailable', 'The stored Source range did not match the requested range.');
    }
    return {
      sourceId,
      offset: range.start,
      returnedBytes: range.end - range.start,
      totalBytes: range.totalBytes,
      truncated: range.truncated || end < byteSize,
      base64: range.base64,
      contentDigest: inspection.contentDigest,
      encodedBytes: Buffer.byteLength(range.base64, 'utf8'),
    };
  });

  app.get(SOURCE_ROUTES.historyReplay, async (request): Promise<ReplayPage> => {
    const params = request.params as { projectId?: string };
    const query = request.query as { epoch?: unknown; afterSeq?: unknown; limit?: unknown };
    const reader = await readerFor(request, params.projectId);

    const epoch = query.epoch;
    if (typeof epoch !== 'string' || !isUuid(epoch)) {
      throw new ThreadlineError('invalid_request', 'A replay cursor must carry a graph epoch.');
    }
    const afterSeq = positiveInt(query.afterSeq, 'afterSeq', Number.MAX_SAFE_INTEGER);
    const limit = query.limit === undefined ? REPLAY_MAX_PAGE : positiveInt(query.limit, 'limit', REPLAY_MAX_PAGE);
    if (limit === 0) throw new ThreadlineError('invalid_request', 'limit must be at least 1.');

    const services = deps.services();
    if (!services) throw new ThreadlineError('service_unavailable', 'Replay is unavailable.');
    const replay = services.replay();
    if (!replay) {
      throw new ThreadlineError(
        'service_unavailable',
        'Durable replay is not composed in this backend. No history state is being reported.',
      );
    }
    const cursor: ReplayCursor = { graphEpoch: epoch, afterSeq };
    return replay.replay(reader, cursor, limit);
  });
  const followers = new Set<() => void>();
  app.addHook('preClose', async () => { for (const close of followers) close(); });
  app.get(SOURCE_ROUTES.historyEvents, async (request, reply) => {
    const params = request.params as { projectId: string };
    const query = request.query as { epoch?: string; afterSeq?: string };
    let reader = await readerFor(request, params.projectId);
    const service = deps.services()?.replay();
    if (!service) throw new ThreadlineError('service_unavailable', 'Durable replay is unavailable.');
    const lastId = request.headers['last-event-id'];
    const parts = typeof lastId === 'string' ? lastId.split(':') : [];
    const epoch = parts[0] ?? query.epoch;
    if ((typeof lastId === 'string' && parts.length !== 2) || !epoch || !isUuid(epoch)) throw new ThreadlineError('invalid_request', 'A graph epoch is required.');
    const cursor: ReplayCursor = { graphEpoch: epoch,
      afterSeq: positiveInt(parts[1] ?? query.afterSeq ?? '0', 'afterSeq', Number.MAX_SAFE_INTEGER) };
    // Validate the initial cursor before switching away from ordinary errors.
    await service.replay(reader, cursor, 1);
    if (followers.size >= 16) throw new ThreadlineError('service_unavailable', 'Replay stream capacity is full.');
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no' });
    raw.socket?.setNoDelay(true);
    const stream=openHistoryStream({raw,cursor,maxBacklogBytes:256*1024,
      read:async(position,limit)=>{
        reader=await readerFor(request,params.projectId);
        return service.replay(reader,position,limit);
      },onClose:()=>followers.delete(stream.close)});
    followers.add(stream.close);
  });

}
