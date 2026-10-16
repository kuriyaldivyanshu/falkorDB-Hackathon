import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { ThreadlineError } from '@threadline/shared';
import type { ArtifactKind, ArtifactVisibility, SourceRange } from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { SqlDatabase } from './pg.js';

/**
 * Immutable artifact writer.
 *
 * The smallest thing that makes an input or response durably readable later:
 * content-addressed bytes written atomically under a backend-chosen locator,
 * a verified SHA-256, and a SQL row that can say the bytes are missing.
 *
 * Deliberate limits for M02:
 * - locators are derived from the content digest, never from model input;
 * - the original fixture seed lives outside this root;
 * - no general object store, no dedup service, no M03 capture graph. Those
 *   extend this module rather than replacing it.
 */

export { ARTIFACT_KINDS } from '@threadline/shared';
export type { ArtifactKind, ArtifactVisibility } from '@threadline/shared';

const ARTIFACT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  model_input: 'application/json',
  model_response: 'application/json',
  tool_input: 'application/json',
  tool_output: 'application/json',
  registered_command_output: 'application/octet-stream',
  diagnostic_output: 'application/octet-stream',
  episode: 'application/json',
};

function mediaTypeFor(kind: ArtifactKind, override?: string): string {
  return override ?? ARTIFACT_MEDIA_TYPES[kind] ?? 'application/octet-stream';
}

/** 4 MiB is far above any bounded M02 request and far below anything harmful. */
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export interface ArtifactRow {
  readonly id: string;
  readonly contentDigest: string;
  readonly storageKey: string;
  readonly kind: ArtifactKind;
  readonly mediaType?: string;
  readonly byteSize: number;
  readonly visibility: ArtifactVisibility;
  readonly ownerUserId?: string | null;
  readonly ownerSessionId?: string | null;
  readonly status: 'available' | 'missing' | 'tombstoned';
}

export interface WriteArtifactParams {
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: ArtifactKind;
  /** Overrides the kind's default; captured bytes are not always JSON. */
  readonly mediaType?: string;
  readonly bytes: Buffer;
  readonly visibility?: ArtifactVisibility;
  readonly ownerUserId?: string | null;
  readonly ownerSessionId?: string | null;
  readonly id: string;
}

export interface ArtifactWriterDeps {
  readonly db: SqlDatabase;
  /** Absolute, owner-only directory. Created with mode 0700 if absent. */
  readonly root: string;
  readonly clock: () => Date;
  readonly logger?: Logger;
}

export interface ArtifactWriter {
  withDatabase(db: SqlDatabase): ArtifactWriter;
  publish(params: WriteArtifactParams): Promise<ArtifactRow>;
  /** Reads the exact bytes back and verifies the digest before returning them. */
  read(tenantId: string, projectId: string, artifactId: string): Promise<Buffer>;
  /**
   * Reads a byte range, verifying the whole object's digest first.
   *
   * Ranges are byte offsets, and the returned slice is base64, so a range may
   * split a multi-byte character without corrupting anything: the caller
   * decodes bytes, not text.
   */
  readRange(
    tenantId: string,
    projectId: string,
    artifactId: string,
    start: number,
    end: number,
  ): Promise<SourceRange>;
  /**
   * Records that the bytes are gone or were deliberately retired.
   *
   * Used after a disappearance so later reads fail loudly instead of silently
   * reporting an empty result.
   */
  markUnavailable(
    tenantId: string,
    projectId: string,
    artifactId: string,
    status: 'missing' | 'tombstoned',
  ): Promise<void>;
  find(
    tenantId: string,
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactRow | null>;
  readonly root: string;
}

export function createArtifactWriter(deps: ArtifactWriterDeps): ArtifactWriter {
  const logger = deps.logger ?? silentLogger;
  const root = resolve(deps.root);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const storageKeyFor = (digest: string, kind: ArtifactKind, id: string): string =>
    `${kind}/${digest.slice(0, 2)}/${digest}-${id}`;

  const absolutePathFor = (storageKey: string): string => {
    const candidate = resolve(root, storageKey);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new ThreadlineError('internal_error', 'An artifact locator escaped the artifact root.');
    }
    return candidate;
  };

  return {
    root,
    withDatabase(db) { return createArtifactWriter({ ...deps, db }); },

    async publish(params: WriteArtifactParams): Promise<ArtifactRow> {
      if (params.bytes.byteLength === 0) {
        throw new ThreadlineError('invalid_request', 'An artifact must contain bytes.');
      }
      if (params.bytes.byteLength > MAX_ARTIFACT_BYTES) {
        throw new ThreadlineError('invalid_request', 'The artifact exceeds the maximum size.', {
          limit: MAX_ARTIFACT_BYTES,
          received: params.bytes.byteLength,
        });
      }
      const visibility = params.visibility ?? 'project';
      if (visibility === 'user' && (params.ownerUserId ?? null) === null) {
        throw new ThreadlineError('invalid_request', 'A user-private artifact needs an owner user id.');
      }
      if (visibility === 'session' && (params.ownerSessionId ?? null) === null) {
        throw new ThreadlineError('invalid_request', 'A session-private artifact needs an owner session id.');
      }

      const digest = createHash('sha256').update(params.bytes).digest('hex');
      const storageKey = storageKeyFor(digest, params.kind, params.id);
      const target = absolutePathFor(storageKey);

      // Republishing under an id that already exists must resolve to one of
      // three outcomes, never a guess:
      //   - identical content   -> the original identity, unchanged
      //   - different content   -> typed conflict, and the stored bytes stay
      //   - tombstoned/missing  -> refuse; a dead artifact is not resurrected
      const existing = await findRow(deps.db, params.tenantId, params.projectId, params.id);
      if (existing !== null) {
        if (existing.contentDigest !== digest || existing.kind !== params.kind || existing.visibility !== visibility
          || (existing.ownerUserId ?? null) !== (params.ownerUserId ?? null) || (existing.ownerSessionId ?? null) !== (params.ownerSessionId ?? null)) {
          throw new ThreadlineError(
            'authority_conflict',
            'An artifact already exists under that id with different content.',
            { reason: 'artifact_content_conflict', existingDigest: existing.contentDigest },
          );
        }
        if (existing.status !== 'available') {
          throw new ThreadlineError(
            'authority_unavailable',
            'The artifact is recorded but its bytes are not available.',
            { reason: 'artifact_not_available', status: existing.status },
          );
        }
        if (!readAndVerify(absolutePathFor(existing.storageKey),digest))
          throw new ThreadlineError('authority_unavailable','Recorded artifact bytes are unavailable.');
        // Same identity, same bytes: publication is idempotent.
        return existing;
      }

      writeAtomically(target, params.bytes);

      const verified = readAndVerify(target, digest);
      if (!verified) {
        throw new ThreadlineError('internal_error', 'The artifact bytes did not verify after writing.');
      }

      try {
        const inserted = await deps.db.withTenantTransaction(params.tenantId, (tx) =>
          tx.rows<{ id: string }>(
            `INSERT INTO threadline.artifacts
               (tenant_id, project_id, id, content_digest, storage_key, kind, media_type,
                byte_size, visibility, owner_user_id, owner_session_id, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'available', $12)
             ON CONFLICT (id) DO NOTHING RETURNING id`,
            [
              params.tenantId,
              params.projectId,
              params.id,
              digest,
              storageKey,
              params.kind,
              mediaTypeFor(params.kind, params.mediaType),
              params.bytes.byteLength,
              visibility,
              params.ownerUserId ?? null,
              params.ownerSessionId ?? null,
              deps.clock(),
            ],
          ),
        );
        if (!inserted.length) {
          const winner=await findRow(deps.db,params.tenantId,params.projectId,params.id);
          if (!winner || winner.contentDigest!==digest || winner.visibility!==visibility || winner.kind!==params.kind || (winner.ownerUserId??null)!==(params.ownerUserId??null)
            || (winner.ownerSessionId??null)!==(params.ownerSessionId??null) || winner.status!=='available')
            throw new ThreadlineError('authority_conflict','Artifact publication conflicted with an existing identity.');
          return winner;
        }
      } catch (error) {
        // A failed SQL acknowledgement may follow a committed insert, and a
        // concurrent publisher may own the same target. Keep immutable orphan
        // bytes rather than deleting a possibly referenced winner.
        logger.log({level:'warn',message:'Artifact publication needs reconciliation; immutable bytes retained.',fields:{errorName:error instanceof Error?error.name:typeof error}});
        throw error;
      }

      return {
        id: params.id,
        contentDigest: digest,
        storageKey,
        kind: params.kind,
        mediaType: mediaTypeFor(params.kind, params.mediaType),
        byteSize: params.bytes.byteLength,
        visibility,
        status: 'available',
      };
    },

    async read(tenantId: string, projectId: string, artifactId: string): Promise<Buffer> {
      const row = await this.find(tenantId, projectId, artifactId);
      if (row === null) {
        throw new ThreadlineError('not_found', 'No artifact exists for that id.');
      }
      if (row.status !== 'available') {
        throw new ThreadlineError('authority_unavailable', 'The artifact bytes are not available.', {
          status: row.status,
        });
      }
      const path = absolutePathFor(row.storageKey);
      const bytes=verifiedBytes(path,row.contentDigest,row.byteSize);
      if (!bytes) throw new ThreadlineError('authority_unavailable','The stored bytes do not match the recorded digest.');
      return bytes;
    },

    async readRange(
      tenantId: string,
      projectId: string,
      artifactId: string,
      start: number,
      end: number,
    ): Promise<SourceRange> {
      const row = await findRow(deps.db, tenantId, projectId, artifactId);
      if (row === null) {
        throw new ThreadlineError('not_found', 'No artifact exists for that id.');
      }
      if (row.status !== 'available') {
        throw new ThreadlineError('authority_unavailable', 'The artifact bytes are not available.', {
          status: row.status,
        });
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        throw new ThreadlineError('invalid_request', 'The requested byte range is not valid.', { start, end });
      }
      const total = row.byteSize;
      // A range that starts past the end is an error; one that merely runs off
      // the end is truncated, and the caller is told which happened.
      if (start > total) {
        throw new ThreadlineError('invalid_request', 'The requested range starts past the end of the artifact.', {
          start,
          totalBytes: total,
        });
      }
      const bounded = Math.min(end, total);
      const path = absolutePathFor(row.storageKey);
      // Slice the very buffer that was verified: a second file read would
      // allow a replacement between verification and delivery.
      const bytes=verifiedBytes(path,row.contentDigest,total);
      if (!bytes) throw new ThreadlineError('authority_unavailable','The stored bytes do not match the recorded digest.');
      const buffer=bytes.subarray(start,bounded);
      return {start,end:bounded,totalBytes:total,truncated:bounded<total,base64:buffer.toString('base64')};
    },

    async markUnavailable(
      tenantId: string,
      projectId: string,
      artifactId: string,
      status: 'missing' | 'tombstoned',
    ): Promise<void> {
      await deps.db.withTenantTransaction(tenantId, (tx) =>
        tx.rows(
          `UPDATE threadline.artifacts SET status = $4
            WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND status = 'available'`,
          [tenantId, projectId, artifactId, status],
        ),
      );
    },

    async find(tenantId: string, projectId: string, artifactId: string): Promise<ArtifactRow | null> {
      return findRow(deps.db, tenantId, projectId, artifactId);
    },

  };
}

/**
 * Writes through a temporary file and renames, so a reader never observes a
 * partial artifact and a crash leaves no half-written digest-addressed object.
 */
function writeAtomically(target: string, bytes: Buffer): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.partial`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    let written = 0;
    while (written < bytes.byteLength) {
      written += writeSync(descriptor, bytes, written, bytes.byteLength - written);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary name is unique per process and pid; a leftover is inert.
    }
    throw new ThreadlineError('storage_unavailable', 'Could not publish artifact bytes.', {
      reason: error instanceof Error ? error.name : typeof error,
    });
  }
}

function verifiedBytes(path:string,digest:string,size?:number):Buffer|null {
  try {
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=fstatSync(fd);
      if(!before.isFile() || before.size>MAX_ARTIFACT_BYTES || (size!==undefined && before.size!==size))return null;
      const bytes=readFileSync(fd);
      if(bytes.length!==before.size || createHash('sha256').update(bytes).digest('hex')!==digest)return null;
      return bytes;
    }finally{closeSync(fd);}
  }catch(error){
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return null;
    throw new ThreadlineError('storage_unavailable','Could not read artifact bytes.',{retryable:true});
  }
}
function readAndVerify(path:string,digest:string):boolean { return verifiedBytes(path,digest)!==null; }

async function findRow(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  artifactId: string,
): Promise<ArtifactRow | null> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{
      id: string;
      content_digest: string;
      storage_key: string;
      kind: ArtifactKind;
      media_type: string;
      byte_size: string;
      visibility: ArtifactVisibility;
      owner_user_id: string | null;
      owner_session_id: string | null;
      status: ArtifactRow['status'];
    }>(
      `SELECT id, content_digest, storage_key, kind, media_type, byte_size, visibility,
              owner_user_id, owner_session_id, status
         FROM threadline.artifacts
        WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
      [tenantId, projectId, artifactId],
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  const byteSize = Number(row.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new ThreadlineError('internal_error', 'An artifact byte size is outside the safe range.');
  }
  return {
    id: row.id,
    contentDigest: row.content_digest.trim(),
    storageKey: row.storage_key,
    kind: row.kind,
    mediaType: row.media_type,
    byteSize,
    visibility: row.visibility,
    ownerUserId: row.owner_user_id,
    ownerSessionId: row.owner_session_id,
    status: row.status,
  };
}
