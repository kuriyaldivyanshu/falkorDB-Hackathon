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
import { open as openAsync } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { ThreadlineError } from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';

/**
 * Immutable source-byte store.
 *
 * Permitted captured bytes are written once, content-addressed, and never
 * mutated afterwards. SQL owns the catalog, ordering and availability of a
 * Source; this module owns the bytes and nothing else, so a storage-key mistake
 * cannot mint catalog authority.
 *
 * Two guarantees are enforced here rather than assumed:
 *
 * - a stored object is only ever reached through the resolved root, so a
 *   catalog value can never address an arbitrary path;
 * - a read verifies the whole object against its recorded digest before any
 *   slice is returned, so corruption is reported instead of served.
 */

export interface SourceFileStoreDeps {
  /** Absolute, owner-only directory. Created with mode 0700 when absent. */
  readonly root: string;
  readonly logger?: Logger;
}

export interface PublishSourceBytesInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly digest: string;
  readonly bytes: Buffer;
  readonly maxBytes: number;
}

export interface StoredSourceBytes {
  readonly storageKey: string;
  readonly digest: string;
  readonly byteSize: number;
}

export interface ReadSourceBytesInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly storageKey: string;
  readonly digest: string;
  readonly byteSize: number;
  readonly maxBytes: number;
}

export interface SourceByteRange {
  readonly start: number;
  readonly end: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  readonly bytes: Buffer;
}

export interface SourceFileStore {
  /** Publishes bytes for a catalog row. Republishing the same digest is stable. */
  publish(input: PublishSourceBytesInput): Promise<StoredSourceBytes>;
  read(input: ReadSourceBytesInput): Promise<Buffer>;
  readRange(input: ReadSourceBytesInput & { readonly start: number; readonly end: number }): Promise<SourceByteRange>;
  /** Removes bytes for a project during an authorized deletion. */
  remove(tenantId: string, projectId: string, storageKey: string): Promise<boolean>;
  /** Whether the root exists and is writable, as a readiness fact. */
  probe(): Promise<boolean>;
  readonly root: string;
}

export function createSourceFileStore(deps: SourceFileStoreDeps): SourceFileStore {
  const logger = deps.logger ?? silentLogger;
  const root = resolve(deps.root);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const absolutePathFor = (storageKey: string): string => {
    const candidate = resolve(root, storageKey);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new ThreadlineError('internal_error', 'A source storage key escaped the source root.');
    }
    return candidate;
  };

  const store: SourceFileStore = {
    root,

    async probe(): Promise<boolean> {
      try {
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const probeName = resolve(root, `.probe-${randomUUID()}`);
        const descriptor = openSync(probeName, 'wx', 0o600);
        closeSync(descriptor);
        unlinkSync(probeName);
        return true;
      } catch {
        return false;
      }
    },

    async publish(input: PublishSourceBytesInput): Promise<StoredSourceBytes> {
      if (!/^[0-9a-f]{64}$/.test(input.digest)) {
        throw new ThreadlineError('internal_error', 'A source digest must be a SHA-256 hex value.');
      }
      if (input.bytes.byteLength < 1) {
        throw new ThreadlineError('invalid_request', 'A source must contain bytes.');
      }
      if (input.bytes.byteLength > input.maxBytes) {
        throw new ThreadlineError('invalid_request', 'The source exceeds the maximum size.', {
          limit: input.maxBytes,
          received: input.bytes.byteLength,
        });
      }
      // The digest is recomputed here rather than trusted from the caller: the
      // catalog row and the stored bytes must describe the same object.
      const actual = createHash('sha256').update(input.bytes).digest('hex');
      if (actual !== input.digest) {
        throw new ThreadlineError('internal_error', 'The offered source digest does not match its bytes.');
      }

      const storageKey = `${input.tenantId}/${input.projectId}/${input.digest.slice(0, 2)}/${input.digest}`;
      const target = absolutePathFor(storageKey);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });

      const existing = readVerified(target, input.digest, input.bytes.byteLength);
      if (existing !== null) {
        return { storageKey, digest: input.digest, byteSize: existing.byteLength };
      }
      if (fileExists(target)) {
        // A digest-addressed object exists but does not hold those bytes. That is
        // corruption, not a publish conflict, and overwriting it could destroy
        // the only copy of another source.
        throw new ThreadlineError('storage_unavailable', 'Stored source bytes do not match their digest.', {
          reason: 'source_bytes_corrupted',
        });
      }

      writeAtomically(target, input.bytes);
      if (readVerified(target, input.digest, input.bytes.byteLength) === null) {
        throw new ThreadlineError('storage_unavailable', 'The source bytes did not verify after writing.', {
          reason: 'source_bytes_unverifiable',
        });
      }
      logger.log({
        level: 'info',
        message: 'Published immutable source bytes.',
        fields: { digest: input.digest, byteSize: input.bytes.byteLength },
      });
      return { storageKey, digest: input.digest, byteSize: input.bytes.byteLength };
    },

    async read(input: ReadSourceBytesInput): Promise<Buffer> {
      const bytes = await readVerifiedAsync(absolutePathFor(input.storageKey), input.digest, input.byteSize);
      if (bytes === null || bytes.byteLength > input.maxBytes) {
        throw new ThreadlineError('source_unavailable', 'The stored source bytes are unavailable or mismatched.', {
          reason: bytes === null ? 'source_bytes_mismatch' : 'source_bytes_oversized',
        });
      }
      return bytes;
    },

    async readRange(
      input: ReadSourceBytesInput & { readonly start: number; readonly end: number },
    ): Promise<SourceByteRange> {
      if (!Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.end) || input.start < 0 || input.end < input.start) {
        throw new ThreadlineError('invalid_request', 'The requested byte range is not valid.', {
          start: input.start,
          end: input.end,
        });
      }
      if (input.start > input.byteSize) {
        throw new ThreadlineError('invalid_request', 'The requested range starts past the end of the source.', {
          start: input.start,
          totalBytes: input.byteSize,
        });
      }
      // The very buffer that was verified is sliced: a second read could observe
      // a replacement between verification and delivery.
      const bytes = await readVerifiedAsync(absolutePathFor(input.storageKey), input.digest, input.byteSize);
      if (bytes === null || bytes.byteLength > input.maxBytes) {
        throw new ThreadlineError('source_unavailable', 'The stored source bytes are unavailable or mismatched.', {
          reason: 'source_bytes_mismatch',
        });
      }
      const bounded = Math.min(input.end, input.byteSize);
      return {
        start: input.start,
        end: bounded,
        totalBytes: input.byteSize,
        // True when the source holds bytes beyond the returned window; a read
        // that stops exactly at the end of the source is complete, not cut.
        truncated: bounded < input.byteSize,
        bytes: bytes.subarray(input.start, bounded),
      };
    },

    async remove(tenantId: string, projectId: string, storageKey: string): Promise<boolean> {
      const prefix = `${tenantId}/${projectId}/`;
      if (!storageKey.startsWith(prefix)) {
        throw new ThreadlineError('internal_error', 'A deletion targeted a storage key outside the project.');
      }
      try {
        unlinkSync(absolutePathFor(storageKey));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return false;
        }
        throw new ThreadlineError('storage_unavailable', 'Could not remove stored source bytes.', {
          reason: error instanceof Error ? error.name : typeof error,
        });
      }
    },
  };
  return store;
}

/**
 * Writes through a temporary file and renames, so a reader never observes a
 * partial object and a crash leaves only an inert `.partial` name.
 */
function writeAtomically(target: string, bytes: Buffer): void {
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
      // The temporary name is unique per process; a leftover is inert.
    }
    throw new ThreadlineError('storage_unavailable', 'Could not publish source bytes.', {
      reason: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** Reads the whole object and verifies size and digest before returning it. */
function readVerified(path: string, digest: string, expectedSize: number): Buffer | null {
  try {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.size !== expectedSize) {
        return null;
      }
      const bytes = readFileSync(descriptor);
      if (bytes.length !== before.size || createHash('sha256').update(bytes).digest('hex') !== digest) {
        return null;
      }
      return bytes;
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new ThreadlineError('storage_unavailable', 'Could not read source bytes.', {
      reason: error instanceof Error ? error.name : typeof error,
    });
  }
}

function fileExists(path: string): boolean {
  try {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    closeSync(descriptor);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    // A symlink or a permission problem is treated as "something is there";
    // publish must not overwrite an object it cannot verify.
    return true;
  }
}

/** Async per-request verification; no cross-request cache can outlive denial. */
async function readVerifiedAsync(path: string, digest: string, expectedSize: number): Promise<Buffer | null> {
  try {
    const file = await openAsync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== expectedSize) return null;
      const bytes = await file.readFile();
      return bytes.length === stat.size && createHash('sha256').update(bytes).digest('hex') === digest ? bytes : null;
    } finally { await file.close(); }
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ThreadlineError('storage_unavailable','Could not verify source bytes.');
  }
}
