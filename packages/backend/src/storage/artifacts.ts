import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { ThreadlineError } from '@threadline/shared';

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

export type ArtifactKind = 'model_input' | 'model_response' | 'tool_input' | 'tool_output';
export type ArtifactVisibility = 'project' | 'user' | 'session';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'model_input',
  'model_response',
  'tool_input',
  'tool_output',
];
export const ARTIFACT_MEDIA_TYPES: Readonly<Record<ArtifactKind, string>> = {
  model_input: 'application/json',
  model_response: 'application/json',
  tool_input: 'application/json',
  tool_output: 'application/json',
};

/** 4 MiB is far above any bounded M02 request and far below anything harmful. */
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export interface ArtifactRow {
  readonly id: string;
  readonly contentDigest: string;
  readonly storageKey: string;
  readonly kind: ArtifactKind;
  readonly byteSize: number;
  readonly visibility: ArtifactVisibility;
  readonly status: 'available' | 'missing' | 'tombstoned';
}

export interface WriteArtifactParams {
  readonly tenantId: string;
  readonly projectId: string;
  readonly kind: ArtifactKind;
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
  publish(params: WriteArtifactParams): Promise<ArtifactRow>;
  /** Reads the exact bytes back and verifies the digest before returning them. */
  read(tenantId: string, projectId: string, artifactId: string): Promise<Buffer>;
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

      writeAtomically(target, params.bytes);

      const verified = readAndVerify(target, digest);
      if (!verified) {
        throw new ThreadlineError('internal_error', 'The artifact bytes did not verify after writing.');
      }

      try {
        await deps.db.withTenantTransaction(params.tenantId, (tx) =>
          tx.rows<{ id: string }>(
            `INSERT INTO threadline.artifacts
               (tenant_id, project_id, id, content_digest, storage_key, kind, media_type,
                byte_size, visibility, owner_user_id, owner_session_id, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'available', $12)
             ON CONFLICT (tenant_id, project_id, id) DO NOTHING`,
            [
              params.tenantId,
              params.projectId,
              params.id,
              digest,
              storageKey,
              params.kind,
              ARTIFACT_MEDIA_TYPES[params.kind],
              params.bytes.byteLength,
              visibility,
              params.ownerUserId ?? null,
              params.ownerSessionId ?? null,
              deps.clock(),
            ],
          ),
        );
      } catch (error) {
        // Never leave bytes without a row: an orphan is worse than a failure.
        try {
          unlinkSync(target);
        } catch {
          logger.log({
            level: 'warn',
            message: 'Could not remove artifact bytes after a failed row insert.',
            fields: { storageKey },
          });
        }
        throw error;
      }

      return {
        id: params.id,
        contentDigest: digest,
        storageKey,
        kind: params.kind,
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
      if (!readAndVerify(path, row.contentDigest)) {
        throw new ThreadlineError('authority_unavailable', 'The stored bytes do not match the recorded digest.');
      }
      return readFileSync(path);
    },

    async find(tenantId: string, projectId: string, artifactId: string): Promise<ArtifactRow | null> {
      const rows = await deps.db.withTenantTransaction(tenantId, (tx) =>
        tx.rows<{
          id: string;
          content_digest: string;
          storage_key: string;
          kind: ArtifactKind;
          byte_size: string;
          visibility: ArtifactVisibility;
          status: ArtifactRow['status'];
        }>(
          `SELECT id, content_digest, storage_key, kind, byte_size, visibility, status
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
      if (!Number.isSafeInteger(byteSize)) {
        throw new ThreadlineError('internal_error', 'An artifact byte size is outside the safe range.');
      }
      return {
        id: row.id,
        contentDigest: row.content_digest.trim(),
        storageKey: row.storage_key,
        kind: row.kind,
        byteSize,
        visibility: row.visibility,
        status: row.status,
      };
    },
  };
}

/**
 * Writes through a temporary file and renames, so a reader never observes a
 * partial artifact and a crash leaves no half-written digest-addressed object.
 */
function writeAtomically(target: string, bytes: Buffer): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.partial`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    let written = 0;
    while (written < bytes.byteLength) {
      written += writeSync(descriptor, bytes, written, bytes.byteLength - written);
    }
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

function readAndVerify(target: string, digest: string): boolean {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    return false;
  }
  if (!stats.isFile()) {
    return false;
  }
  return createHash('sha256').update(readFileSync(target)).digest('hex') === digest;
}

export function artifactPathUnder(root: string, storageKey: string): string {
  return join(resolve(root), storageKey);
}