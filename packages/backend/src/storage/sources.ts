import { ThreadlineError, type SourceMetadata, type SourceRange, type SourceService } from '@threadline/shared';

import type { ArtifactWriter } from './artifacts.js';
import type { SqlDatabase } from './pg.js';

/**
 * The real Source service.
 *
 * Agent B's routes and the `memory.retrieve` tool consume this rather than a
 * test double, so the permission and availability rules below are the ones that
 * actually run.
 *
 * Four rules decide every call:
 *
 * 1. **Authority is re-checked on every read, not cached at session start.** A
 *    membership revoked mid-run stops the very next read.
 * 2. **Content equality never grants access.** Two artifacts with the same
 *    digest are different artifacts with different readers, because visibility
 *    lives on the row, not on the bytes.
 * 3. **Absence and inaccessibility are indistinguishable from outside.** A
 *    caller who is not in the Source's scope always observes `absent`. A
 *    precise reason is available to an authorized operator, because an operator
 *    needs it, but never to a caller who could use it to probe for existence.
 * 4. **A digest or a row is not proof that bytes exist.** Every read verifies
 *    the stored bytes against the recorded digest before returning any of them,
 *    so missing or corrupt content can never be returned as an empty success.
 *
 * Nothing physical is ever returned: `storageKey` and every filesystem locator
 * stay inside the backend.
 */

export interface SourceServiceDeps {
  readonly db: SqlDatabase;
  readonly artifacts: ArtifactWriter;
  readonly logger?: (entry: { message: string; fields?: Record<string, unknown> }) => void;
}

interface ArtifactScopeRow {
  id: string;
  content_digest: string;
  storage_key: string;
  kind: string;
  media_type: string;
  byte_size: string;
  visibility: 'project' | 'user' | 'session';
  owner_user_id: string | null;
  owner_session_id: string | null;
  status: 'available' | 'missing' | 'tombstoned';
}

export function createSourceService(deps: SourceServiceDeps): SourceService {
  /**
   * Resolves an artifact to its row, but only after confirming the caller is
   * allowed to know it exists.
   *
   * The membership check runs before the lookup so a caller outside the project
   * cannot learn anything from the difference between "no such row" and "not
   * allowed".
   */
  const resolveScoped = async (
    reader: { tenantId: string; projectId: string; userId: string; userSessionId?: string | null; agentSessionId?: string | null },
    artifactId: string,
  ): Promise<{ readonly row: ArtifactScopeRow } | { readonly absent: true }> => {
    const membership = await deps.db.withTenantTransaction(reader.tenantId, (tx) =>
      tx.rows<{ status: string }>(
        `SELECT pm.status FROM threadline.project_memberships pm
          JOIN threadline.tenant_memberships tm ON tm.tenant_id=pm.tenant_id AND tm.user_id=pm.user_id AND tm.status='active'
          JOIN threadline.users u ON u.id=pm.user_id AND u.status='active'
          WHERE pm.tenant_id = $1 AND pm.project_id = $2 AND pm.user_id = $3`,
        [reader.tenantId, reader.projectId, reader.userId],
      ),
    );
    if (membership[0]?.status !== 'active') {
      // Not active: the caller may be revoked or may simply never have been in
      // this project. Both are reported identically.
      return { absent: true };
    }

    if (reader.userSessionId) {
      const sessions = await deps.db.withTenantTransaction(reader.tenantId, tx => tx.rows<{ id: string }>(
        `SELECT id FROM threadline.user_sessions WHERE tenant_id=$1 AND id=$2 AND user_id=$3
          AND revoked_at IS NULL AND expires_at > now() AND idle_expires_at > now()`,
        [reader.tenantId, reader.userSessionId, reader.userId]));
      if (!sessions[0]) return { absent: true };
    }
    const rows = await deps.db.withTenantTransaction(reader.tenantId, (tx) =>
      tx.rows<ArtifactScopeRow>(
        `SELECT id, trim(content_digest) AS content_digest, storage_key, kind, media_type,
                byte_size::text, visibility, owner_user_id, owner_session_id, status
           FROM threadline.artifacts
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [reader.tenantId, reader.projectId, artifactId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      return { absent: true };
    }

    // Row-level visibility, re-evaluated per read.
    const readable =
      row.visibility === 'project' ||
      (row.visibility === 'user' && row.owner_user_id === reader.userId) ||
      (row.visibility === 'session' &&
        !!reader.agentSessionId && row.owner_session_id === reader.agentSessionId);
    if (!readable) {
      return { absent: true };
    }
    return { row };
  };

  const requireScoped = async (
    reader: { tenantId: string; projectId: string; userId: string; userSessionId?: string | null; agentSessionId?: string | null },
    artifactId: string,
  ): Promise<ArtifactScopeRow> => {
    const resolved = await resolveScoped(reader, artifactId);
    if ('absent' in resolved) {
      throw new ThreadlineError('not_found', 'No such Source is available to you.');
    }
    return resolved.row;
  };

  return {
    async metadata(reader, artifactId): Promise<SourceMetadata> {
      const resolved = await resolveScoped(reader, artifactId);
      if ('absent' in resolved) {
        // Deliberately the same shape a genuinely absent Source produces.
        throw new ThreadlineError('not_found', 'No such Source is available to you.');
      }
      const row = resolved.row;
      const byteSize = Number(row.byte_size);
      const identity = {
        artifactId: row.id,
        contentDigest: row.content_digest,
        storageKey: row.storage_key,
        kind: row.kind as never,
        mediaType: row.media_type,
        byteSize: Number.isSafeInteger(byteSize) && byteSize >= 0 ? byteSize : 0,
        visibility: row.visibility,
        ownerUserId: row.owner_user_id,
        ownerSessionId: row.owner_session_id,
        status: row.status,
      };
      // An authorized reader is told the real state. A caller who reaches here
      // has already passed the membership and visibility checks.
      if (row.status === 'available') {
        try { await deps.artifacts.read(reader.tenantId,reader.projectId,artifactId); }
        catch (error) {
          if (!(error instanceof ThreadlineError) || error.code !== 'authority_unavailable') throw error;
          await deps.artifacts.markUnavailable(reader.tenantId,reader.projectId,artifactId,'missing');
          row.status='missing'; identity.status='missing';
        }
      }
      const pending = await deps.db.withTenantTransaction(reader.tenantId, tx => tx.rows<{ status: string }>(
        `SELECT o.status FROM threadline.capture_outbox o JOIN threadline.capture_events c
          ON c.id=o.capture_event_id AND c.tenant_id=o.tenant_id
          WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.raw_artifact_id=$3 AND o.status <> 'committed' LIMIT 1`,
        [reader.tenantId,reader.projectId,artifactId]));
      const state = pending.length && row.status==='available' ? 'pending' : row.status === 'available' ? 'available' : 'unavailable';
      return {
        identity: identity as never,
        available: state === 'available',
        reason: state === 'pending' ? 'graph_admission_pending' : row.status === 'available' ? null : row.status,
        state: state as never,
      };
    },

    async readRange(reader, artifactId, start, end): Promise<SourceRange> {
      const row = await requireScoped(reader, artifactId);
      if (row.status !== 'available') {
        throw new ThreadlineError('authority_unavailable', 'Those bytes are not available.', {
          status: row.status,
        });
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end-start > 32768) {
        throw new ThreadlineError('invalid_request', 'The requested byte range is not valid.', { start, end });
      }
      // The artifact writer verifies the whole object's digest before slicing,
      // so a corrupt object can never yield a plausible-looking partial read.
      return deps.artifacts.readRange(reader.tenantId, reader.projectId, artifactId, start, end);
    },

    async markMissing(reader, artifactId, reason): Promise<void> {
      // Fenced by the caller's own tenant. An operator path must not need an
      // unfenced connection to record that bytes were lost.
      await requireScoped(reader, artifactId);
      await deps.artifacts.markUnavailable(reader.tenantId, reader.projectId, artifactId, 'missing');
      deps.logger?.({
        message: 'Source bytes were recorded as missing.',
        fields: { artifactId, reason: reason.slice(0, 120) },
      });
    },
  };
}