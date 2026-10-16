import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Candidate workspace preparation.
 *
 * A run's candidate is a separate real directory copied from the immutable
 * authored seed. The seed is never the candidate and is never written to: the
 * original template, the protected inputs and any expected result bodies stay
 * outside the registered view the model can read.
 *
 * Creation is idempotent under the run identity. An interrupted startup reuses
 * a matching candidate and refuses to replace one that does not match, so a
 * half-written directory from a previous attempt can never be mistaken for
 * another run's work.
 */

export const CANDIDATE_MARKER = '.threadline-candidate.json';

export const CANDIDATE_LIMITS = Object.freeze({
  maxFiles: 1_000,
  maxBytes: 50 * 1024 * 1024,
});

export type CandidatePreparationErrorCode =
  | 'path_denied'
  | 'seed_invalid'
  | 'seed_changed'
  | 'candidate_conflict'
  | 'limit_exceeded'
  | 'unavailable';

export class CandidatePreparationError extends Error {
  constructor(
    readonly code: CandidatePreparationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CandidatePreparationError';
  }
}

export interface CandidateMarker {
  readonly runId: string;
  readonly seedDigest: string;
  readonly candidateRoot: string;
  readonly createdAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface CandidatePreparation {
  readonly root: string;
  readonly marker: CandidateMarker;
  /** True when an identical existing candidate was reused instead of rebuilt. */
  readonly reused: boolean;
  /**
   * Injected registration port. The coordinator owns the authoritative binding
   * between this directory and the run; the filesystem side never invents one.
   */
  register?: (candidate: CandidatePreparation) => Promise<void>;
}

export interface PrepareCandidateOptions {
  /** Durable run identity. Two runs never share a candidate root. */
  readonly runId: string;
  /** Trusted host path. Never supplied by a model or a tool argument. */
  readonly candidateRoot: string;
  /** The immutable authored seed. */
  readonly seedRoot: string;
  readonly now?: () => Date;
  readonly register?: (candidate: CandidatePreparation) => Promise<void>;
}

/**
 * Digest of the seed tree.
 *
 * Covers relative paths and contents, so a moved or edited seed produces a
 * different identity rather than silently producing a different candidate.
 */
export async function digestSeedTree(seedRoot: string): Promise<{ digest: string; fileCount: number; totalBytes: number }> {
  const root = resolve(seedRoot);
  await assertRealDirectory(root, 'seed');
  const hash = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    const handle = await readdir(directory, { withFileTypes: true });
    for (const entry of handle.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.')) continue;
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        throw new CandidatePreparationError('seed_invalid', `The seed contains a symlink at ${path}.`);
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new CandidatePreparationError('seed_invalid', `The seed contains a non-regular entry at ${path}.`);
      }
      const stats = await lstat(absolute);
      fileCount += 1;
      totalBytes += stats.size;
      if (fileCount > CANDIDATE_LIMITS.maxFiles || totalBytes > CANDIDATE_LIMITS.maxBytes) {
        throw new CandidatePreparationError('limit_exceeded', 'The seed exceeds the bounded candidate size.');
      }
      const contents = await readFile(absolute);
      hash.update(`${path}\0${contents.length}\0`);
      hash.update(contents);
    }
  };

  await walk(root);
  return { digest: hash.digest('hex'), fileCount, totalBytes };
}

/**
 * Creates or reuses the run's candidate directory.
 *
 * The layout is built in a sibling staging directory and renamed into place,
 * so an interrupted copy leaves the staging directory behind rather than a
 * half-populated candidate that would look registered.
 */
export async function prepareCandidateWorkspace(options: PrepareCandidateOptions): Promise<CandidatePreparation> {
  const now = options.now ?? (() => new Date());
  if (options.runId.trim().length === 0) {
    throw new CandidatePreparationError('path_denied', 'A run identity is required.');
  }
  const seedRoot = resolve(options.seedRoot);
  const candidateRoot = resolve(options.candidateRoot);
  if (!isAbsolute(options.candidateRoot) || options.candidateRoot.length === 0) {
    throw new CandidatePreparationError('path_denied', 'The candidate root must be an absolute trusted path.');
  }
  if (isInside(candidateRoot, seedRoot) || isInside(seedRoot, candidateRoot)) {
    throw new CandidatePreparationError(
      'path_denied',
      'The candidate and the seed must be separate directories; the seed is never the candidate.',
    );
  }

  const seed = await digestSeedTree(seedRoot);
  const existing = await readMarker(candidateRoot);
  if (existing !== null) {
    if (existing.runId !== options.runId || existing.seedDigest !== seed.digest) {
      throw new CandidatePreparationError(
        'candidate_conflict',
        `The candidate directory already holds a different run or a different seed ` +
          `(run ${existing.runId}, seed ${existing.seedDigest.slice(0, 12)}). ` +
          'It is left untouched; choose a distinct candidate root for this run.',
      );
    }
    const reused: CandidatePreparation = { root: candidateRoot, marker: existing, reused: true, register: options.register };
    await options.register?.(reused);
    return reused;
  }

  const staging = `${candidateRoot}.staging-${options.runId}`;
  let marker: CandidateMarker;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await copySeed(seedRoot, staging);
    marker = {
      runId: options.runId,
      seedDigest: seed.digest,
      candidateRoot,
      createdAt: now().toISOString(),
      fileCount: seed.fileCount,
      totalBytes: seed.totalBytes,
    };
    await writeFile(join(staging, CANDIDATE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });

    // Re-verify the copy before publishing it, so a truncated candidate is never
    // handed to the coordinator as registered.
    const copied = await digestSeedTree(staging);
    if (copied.digest !== seed.digest) {
      throw new CandidatePreparationError('seed_changed', 'The copied candidate does not match the seed digest.');
    }
    await rename(staging, candidateRoot);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const prepared: CandidatePreparation = { root: candidateRoot, marker, reused: false, register: options.register };
  await options.register?.(prepared);
  return prepared;
}

async function copySeed(seedRoot: string, destination: string): Promise<void> {
  await cp(seedRoot, destination, {
    recursive: true,
    filter: (source) => !source.split(sep).pop()?.startsWith('.'),
    errorOnExist: true,
    force: false,
  });
  // `cp` follows the seed's regular files; confirm nothing executable or
  // device-like arrived through a platform quirk.
  await assertRealDirectory(destination, 'candidate');
}

async function readMarker(candidateRoot: string): Promise<CandidateMarker | null> {
  try {
    const raw = await readFile(join(candidateRoot, CANDIDATE_MARKER), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const marker = parsed as Record<string, unknown>;
    if (
      typeof marker['runId'] !== 'string' ||
      typeof marker['seedDigest'] !== 'string' ||
      typeof marker['candidateRoot'] !== 'string' ||
      typeof marker['createdAt'] !== 'string' ||
      typeof marker['fileCount'] !== 'number' ||
      typeof marker['totalBytes'] !== 'number'
    ) {
      return null;
    }
    return {
      runId: marker['runId'],
      seedDigest: marker['seedDigest'],
      candidateRoot: marker['candidateRoot'],
      createdAt: marker['createdAt'],
      fileCount: marker['fileCount'],
      totalBytes: marker['totalBytes'],
    };
  } catch {
    return null;
  }
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new CandidatePreparationError('seed_invalid', `The ${label} root must be a real directory.`);
  }
}

function isInside(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
