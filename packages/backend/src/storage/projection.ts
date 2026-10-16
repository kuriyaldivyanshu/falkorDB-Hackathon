import { randomUUID } from 'node:crypto';
import { ThreadlineError, type ReplayCursor, type ReplayPage, type ReplayService, type SourceReader } from '@threadline/shared';

import type { GraphStore } from './graph.js';
import type { SqlDatabase } from './pg.js';
import { requireActiveMember } from './capture.js';

/**
 * Ordered graph-Event projection and durable replay.
 *
 * The rule that shapes this module: **the cursor never advances by itself.**
 * Projection rows and the contiguous offset are written in one SQL
 * transaction, so a failure anywhere in the batch leaves the cursor exactly
 * where it was. A cursor that moved without its rows would silently skip
 * evidence, and a skipped event is worse than a visible gap.
 *
 * The four positions stay distinct:
 *   - `capture_events.capture_seq`      session capture position
 *   - `graph_event_projection.event_seq` project Event sequence within an epoch
 *   - `projection_offsets`               this consumer's contiguous position
 *   - the client replay cursor           what a reader last consumed
 *
 * A process-local SSE number is none of these and is never persisted as one.
 */

/** `capture_policy.graph_replay_batch_events`. */
export const PROJECTION_BATCH_EVENTS = 100;

/** Matches the replay page bound the route already declares. */
export const REPLAY_MAX_PAGE = 100;

export interface ProjectionProfile {
  readonly consumerName: string;
  readonly batchSize: number;
}

export const DEFAULT_PROJECTION_PROFILE: ProjectionProfile = {
  consumerName: 'replay',
  batchSize: PROJECTION_BATCH_EVENTS,
};

export interface ProjectionService {
  /**
   * Projects the next contiguous run of Events.
   *
   * Stops at the first missing sequence rather than skipping it: a hole in the
   * Event stream is reported as a gap, never stepped over.
   */
  projectOnce(tenantId: string, projectId: string, graphKey: string): Promise<{
    readonly projected: number;
    readonly cursor: ReplayCursor;
  }>;
  /** The contiguous position a consumer may resume from. */
  cursor(reader: SourceReader): Promise<ReplayCursor>;
  /** Replaces `services.replay()` for HTTP and the CLI. */
  readonly service: ReplayService;
}

interface OffsetRow {
  graph_epoch: string;
  last_contiguous_seq: string;
}

export function createProjectionService(
  db: SqlDatabase,
  graphs: GraphStore,
  profile: ProjectionProfile = DEFAULT_PROJECTION_PROFILE,
): ProjectionService {
  const readCursor = async (tenantId: string, projectId: string): Promise<ReplayCursor> => {
    const rows = await db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<OffsetRow>(
        `SELECT graph_epoch, last_contiguous_seq::text
           FROM threadline.projection_offsets
          WHERE tenant_id = $1 AND project_id = $2 AND consumer_name = $3`,
        [tenantId, projectId, profile.consumerName],
      ),
    );
    const projectRows = await db.withTenantTransaction(tenantId, tx => tx.rows<{ graph_epoch: string }>(
      `SELECT graph_epoch FROM threadline.projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId]));
    const currentEpoch = projectRows[0]?.graph_epoch;
    if (!currentEpoch) throw new ThreadlineError('not_found', 'Project is unavailable.');
    const row = rows[0]?.graph_epoch === currentEpoch ? rows[0] : undefined;
    if (row === undefined) {
      // A consumer that has never run starts at the beginning of the current
      // epoch, which is honest rather than assuming zero for a moving epoch.
      const project = await db.withTenantTransaction(tenantId, (tx) =>
        tx.rows<{ graph_epoch: string }>(
          `SELECT graph_epoch FROM threadline.projects WHERE tenant_id = $1 AND id = $2`,
          [tenantId, projectId],
        ),
      );
      const epoch = project[0]?.graph_epoch;
      if (epoch === undefined) {
        throw new ThreadlineError('not_found', 'No project exists for that id.');
      }
      return { graphEpoch: epoch, afterSeq: 0 };
    }
    return { graphEpoch: row.graph_epoch, afterSeq: Number(row.last_contiguous_seq) };
  };

  /**
   * Reads the next Events after the cursor, in order.
   *
   * Bounded by the profile and stops at a hole, so a gap is visible.
   */
  const projectOnce = async (
    tenantId: string,
    projectId: string,
    graphKey: string,
  ): Promise<{ projected: number; cursor: ReplayCursor }> => {
    const cursor = await readCursor(tenantId, projectId);
    const graph = graphs.graph(graphKey);
    const reply = await graph.query<{
      event_graph_id: string;
      seq: number;
      graph_epoch: string;
      kind: string;
      aggregate_id: string;
      payload_json: string;
      payload_digest: string;
      committed_at_ms: number;
    }>(
      // ORDER BY and LIMIT follow the RETURN clause: this dialect rejects them
      // before it.
      `MATCH (e:Entity:Event {graph_epoch:$graph_epoch})
        WHERE e.seq > $after_seq
       RETURN e.id AS event_graph_id, e.seq AS seq, e.graph_epoch AS graph_epoch,
              e.kind AS kind, e.aggregate_id AS aggregate_id,
              e.payload_json AS payload_json, e.payload_digest AS payload_digest,
              e.committed_at_ms AS committed_at_ms
        ORDER BY e.seq ASC
        LIMIT $limit`,
      {
        params: {
          graph_epoch: cursor.graphEpoch,
          after_seq: cursor.afterSeq,
          limit: profile.batchSize + 1,
        },
      },
    );

    const all = reply.data ?? [];
    const batch = all.slice(0, profile.batchSize);

    // Stop at the first hole rather than stepping over it. Anything beyond a
    // hole is not contiguous and must not advance the cursor.
    let contiguous: typeof batch = [];
    for (const event of batch) {
      const expected = contiguous.length === 0 ? cursor.afterSeq + 1 : contiguous[contiguous.length - 1]!.seq + 1;
      if (Number(event.seq) !== expected) {
        break;
      }
      contiguous = [...contiguous, event];
    }

    if (contiguous.length === 0) {
      return { projected: 0, cursor };
    }

    const last = contiguous[contiguous.length - 1]!;
    // Rows and cursor in one transaction: either the whole run is durable or
    // the cursor does not move at all.
    await db.withTenantTransaction(tenantId, async (tx) => {
      const project = await tx.rows<{ graph_epoch: string }>(
        `SELECT graph_epoch FROM threadline.projects WHERE tenant_id=$1 AND id=$2 FOR SHARE`, [tenantId, projectId]);
      if (project[0]?.graph_epoch !== cursor.graphEpoch) throw new ThreadlineError('authority_conflict', 'Projection epoch changed.');
      for (const event of contiguous) {
        const inserted = await tx.rows(
          `INSERT INTO threadline.graph_event_projection
             (tenant_id, project_id, id, graph_epoch, event_seq, event_graph_id, kind,
              aggregate_graph_id, payload, payload_digest, committed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (tenant_id, project_id, graph_epoch, event_seq) DO UPDATE
           SET payload_digest=graph_event_projection.payload_digest
           WHERE graph_event_projection.event_graph_id=EXCLUDED.event_graph_id
             AND graph_event_projection.payload_digest=EXCLUDED.payload_digest RETURNING id`,
          [
            tenantId,
            projectId,
            event.event_graph_id,
            event.graph_epoch,
            event.seq,
            event.event_graph_id,
            event.kind,
            event.aggregate_id,
            event.payload_json,
            event.payload_digest,
            new Date(Number(event.committed_at_ms)).toISOString(),
          ],
        );
        if (inserted.length !== 1) throw new ThreadlineError('authority_conflict','Projected event identity changed; cursor was not advanced.');
      }
      await tx.rows(
        `INSERT INTO threadline.projection_offsets
           (tenant_id, project_id, id, consumer_name, graph_epoch, last_contiguous_seq)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, project_id, consumer_name)
         DO UPDATE SET graph_epoch = $5, last_contiguous_seq = CASE
           WHEN projection_offsets.graph_epoch=$5 THEN GREATEST(projection_offsets.last_contiguous_seq,$6)
           ELSE $6 END, updated_at = now()`,
        [
          tenantId,
          projectId,
          randomUUID(),
          profile.consumerName,
          last.graph_epoch,
          Number(last.seq),
        ],
      );
    });

    return { projected: contiguous.length, cursor: { graphEpoch: last.graph_epoch, afterSeq: Number(last.seq) } };
  };

  const replay: ReplayService = {
    async replay(reader: SourceReader, cursor: ReplayCursor, limit: number): Promise<ReplayPage> {
      await requireActiveMember(db, reader.tenantId, reader.projectId, reader.userId);
      if (!Number.isSafeInteger(cursor.afterSeq) || cursor.afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > REPLAY_MAX_PAGE)
        throw new ThreadlineError('invalid_request', 'Invalid replay cursor or page size.');
      const current = await readCursor(reader.tenantId, reader.projectId);
      if (cursor.graphEpoch !== current.graphEpoch) throw new ThreadlineError('authority_conflict', 'Replay epoch is stale; refresh the cursor.', { reason: 'stale_epoch', expected: current.graphEpoch });
      if (cursor.afterSeq > current.afterSeq) throw new ThreadlineError('invalid_request', 'Replay cursor is ahead of retained history.');
      const bounded = Math.min(Math.max(1, Math.trunc(limit)), REPLAY_MAX_PAGE);
      // Replay is served from the durable projection, not from the graph, so a
      // client that reconnects reads what was actually committed to SQL.
      const rows = await db.withTenantTransaction(reader.tenantId, (tx) =>
        tx.rows<{
          event_seq: string;
          graph_epoch: string;
          kind: string;
          aggregate_graph_id: string;
          payload: unknown;
          payload_digest: string;
          committed_at: Date;
          current_visibility: string | null;
          current_owner_user: string | null;
          current_owner_session: string | null;
        }>(
          `SELECT g.event_seq::text, g.graph_epoch, g.kind, g.aggregate_graph_id, g.payload,
                  trim(g.payload_digest) AS payload_digest, g.committed_at,
                  a.visibility AS current_visibility, a.owner_user_id AS current_owner_user,
                  a.owner_session_id AS current_owner_session
             FROM threadline.graph_event_projection g
             LEFT JOIN threadline.artifacts a ON a.tenant_id=g.tenant_id AND a.project_id=g.project_id
               AND a.id::text=g.payload->>'sourceId'
            WHERE g.tenant_id = $1 AND g.project_id = $2 AND g.graph_epoch = $3
              AND g.event_seq > $4
            ORDER BY g.event_seq ASC
            LIMIT $5`,
          [
            reader.tenantId,
            reader.projectId,
            cursor.graphEpoch,
            Math.max(0, Math.trunc(cursor.afterSeq)),
            bounded + 1,
          ],
        ),
      );

      const page = rows.slice(0, bounded);
      const firstSeq = page.length === 0 ? cursor.afterSeq + 1 : Number(page[0]!.event_seq);
      const expected = cursor.afterSeq + 1;
      // A hole before the first frame is reported, never skipped silently.
      let gap = page.length > 0 && firstSeq !== expected ? { fromSeq: expected, toSeq: firstSeq - 1 } : null;
      let next = expected;
      for (const row of page) {
        if (Number(row.event_seq) !== next) { gap ??= { fromSeq: next, toSeq: Number(row.event_seq) - 1 }; break; }
        next += 1;
      }
      if (!page.length && cursor.afterSeq < current.afterSeq) gap = { fromSeq: expected, toSeq: current.afterSeq };

      const decoded = (gap ? [] : page).map((row) => ({
        seq: Number(row.event_seq),
        graphEpoch: row.graph_epoch,
        kind: row.kind,
        aggregateId: row.aggregate_graph_id,
        payload:
          typeof row.payload === 'string'
            ? (JSON.parse(row.payload) as Record<string, unknown>)
            : (row.payload as Record<string, unknown>),
        payloadDigest: row.payload_digest,
        committedAt: row.committed_at.toISOString(),
      }));

      // Preserve sequence continuity without exposing a private payload to a
      // different member. Authorization is evaluated for every replay call.
      const authorized = decoded.map((frame,index) => {
        const visibility = page[index]?.current_visibility ?? frame.payload['visibility'];
        const readable = visibility !== 'user' && visibility !== 'session'
          || visibility === 'user' && (page[index]?.current_owner_user ?? frame.payload['ownerUserId']) === reader.userId
          || visibility === 'session' && !!reader.agentSessionId && (page[index]?.current_owner_session ?? frame.payload['ownerSessionId']) === reader.agentSessionId;
        return readable ? frame : { ...frame, kind: 'capture.restricted', aggregateId: '', payload: {}, payloadDigest: '' };
      });
      const delivery = await db.withTenantTransaction(reader.tenantId,tx=>tx.rows<{pending:string;quarantined:string;oldest:Date|null}>(
        `SELECT count(*) FILTER (WHERE status IN ('pending','leased'))::text AS pending,
          count(*) FILTER (WHERE status='quarantined')::text AS quarantined,
          min(created_at) FILTER (WHERE status IN ('pending','leased')) AS oldest
          FROM threadline.capture_outbox WHERE tenant_id=$1 AND project_id=$2`,[reader.tenantId,reader.projectId]));
      return {
        admission:{pending:Number(delivery[0]?.pending??0),quarantined:Number(delivery[0]?.quarantined??0),oldestPendingAt:delivery[0]?.oldest?.toISOString()??null},
        frames: authorized,
        cursor: {
          graphEpoch: cursor.graphEpoch,
          afterSeq: decoded.length === 0 ? cursor.afterSeq : decoded[decoded.length - 1]!.seq,
        },
        hasMore: rows.length > bounded,
        gap,
      };
    },

    async cursor(reader: SourceReader): Promise<ReplayCursor> {
      await requireActiveMember(db, reader.tenantId, reader.projectId, reader.userId);
      return readCursor(reader.tenantId, reader.projectId);
    },
  };

  return {
    projectOnce,
    cursor: async (reader: SourceReader): Promise<ReplayCursor> =>
      readCursor(reader.tenantId, reader.projectId),
    service: replay,
  };
}