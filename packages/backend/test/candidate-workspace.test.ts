import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANDIDATE_MARKER, digestSeedTree, prepareCandidateWorkspace } from '../src/workspace/candidate.js';
import { createWorkspaceReader } from '../src/workspace/read-only.js';

// Tests run from packages/backend/dist/test, so the repository root is four levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED = join(REPO_ROOT, 'fixtures/inventory-export-v1/seed');

// The workspace reader refuses a root with a symlinked ancestor, and on macOS
// the temporary directory lives under a symlinked /var, so resolve it first.
const tempDir = async (): Promise<string> => realpath(await mkdtemp(join(tmpdir(), 'threadline-candidate-')));

const treeDigest = async (root: string): Promise<string> => {
  const hash = createHash('sha256');
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolute); continue; }
      hash.update(join(directory.slice(root.length), entry.name));
      hash.update(await readFile(absolute));
    }
  };
  await walk(root);
  return hash.digest('hex');
};

test('a candidate is a separate real directory built from the seed', async () => {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate-run-1');
  const prepared = await prepareCandidateWorkspace({ runId: 'run-1', candidateRoot, seedRoot: SEED });

  assert.equal(prepared.reused, false);
  assert.equal(prepared.root, candidateRoot);
  assert.equal(prepared.marker.runId, 'run-1');
  assert.match(prepared.marker.seedDigest, /^[0-9a-f]{64}$/);

  const stats = await stat(candidateRoot);
  assert.ok(stats.isDirectory());
  assert.ok(!candidateRoot.includes(`${SEED}/`), 'the candidate is not inside the seed');

  const entrypoint = await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8');
  assert.match(entrypoint, /updatedAt/, 'the authored exporter reached the candidate');

  const marker = JSON.parse(await readFile(join(candidateRoot, CANDIDATE_MARKER), 'utf8')) as Record<string, unknown>;
  assert.equal(marker['runId'], 'run-1');
  assert.equal((await stat(join(candidateRoot, CANDIDATE_MARKER))).mode & 0o777, 0o600);
});

test('the original seed bytes are unchanged by candidate preparation', async () => {
  const before = await treeDigest(SEED);
  const root = await tempDir();
  await prepareCandidateWorkspace({ runId: 'run-a', candidateRoot: join(root, 'c-a'), seedRoot: SEED });
  await prepareCandidateWorkspace({ runId: 'run-b', candidateRoot: join(root, 'c-b'), seedRoot: SEED });
  assert.equal(await treeDigest(SEED), before, 'the seed is the immutable original');
});

test('preparing the same run twice reuses the identical candidate', async () => {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate-reuse');
  const first = await prepareCandidateWorkspace({ runId: 'run-reuse', candidateRoot, seedRoot: SEED });
  const entrypointBefore = await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8');

  const second = await prepareCandidateWorkspace({ runId: 'run-reuse', candidateRoot, seedRoot: SEED });
  assert.equal(second.reused, true);
  assert.equal(second.marker.seedDigest, first.marker.seedDigest);
  assert.equal(second.marker.createdAt, first.marker.createdAt, 'reuse must not rewrite the marker');
  assert.equal(await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8'), entrypointBefore);
  assert.deepEqual((await readdir(root)).filter(n => n.includes('staging')), [], 'no staging directory is left behind');
});

test('a different run or a different seed refuses rather than replacing an existing candidate', async () => {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate-conflict');
  await prepareCandidateWorkspace({ runId: 'run-owner', candidateRoot, seedRoot: SEED });
  const owned = await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8');

  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: 'another-run', candidateRoot, seedRoot: SEED }),
    (error) => error instanceof Error && /candidate_conflict|different run|different seed/.test(String(error)),
  );
  assert.equal(await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8'), owned, 'the existing candidate is untouched');

  const otherSeed = join(root, 'seed-b');
  await mkdir(join(otherSeed, 'src'), { recursive: true });
  await writeFile(join(otherSeed, 'src', 'exporter.mjs'), 'different template\n');
  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: 'run-owner', candidateRoot, seedRoot: otherSeed }),
    (error) => error instanceof Error && /different run|different seed/.test(String(error)),
  );
  assert.equal(await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8'), owned);
});

test('an edited seed produces a different digest and therefore a different candidate', async () => {
  const base = await tempDir();
  const seedA = join(base, 'seed-a');
  await mkdir(join(seedA, 'src'), { recursive: true });
  await writeFile(join(seedA, 'src', 'exporter.mjs'), 'template one\n');
  const seedB = join(base, 'seed-b');
  await mkdir(join(seedB, 'src'), { recursive: true });
  await writeFile(join(seedB, 'src', 'exporter.mjs'), 'template two\n');

  const digestA = await digestSeedTree(seedA);
  const digestB = await digestSeedTree(seedB);
  assert.notEqual(digestA.digest, digestB.digest);

  const candidateRoot = join(base, 'candidate');
  const first = await prepareCandidateWorkspace({ runId: 'run-1', candidateRoot, seedRoot: seedA });
  assert.equal(first.marker.seedDigest, digestA.digest);
});

test('a candidate that is the seed, or inside it, is refused', async () => {
  const root = await tempDir();
  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: 'run-x', candidateRoot: SEED, seedRoot: SEED }),
    (error) => error instanceof Error && /separate directories/.test(String(error)),
  );
  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: 'run-x', candidateRoot: join(SEED, 'candidate'), seedRoot: SEED }),
    (error) => error instanceof Error && /separate directories/.test(String(error)),
  );
  void root;
});

test('a symlink inside the seed is refused rather than copied', async () => {
  const root = await tempDir();
  const seed = join(root, 'seed');
  await mkdir(join(seed, 'src'), { recursive: true });
  await writeFile(join(seed, 'src', 'real.mjs'), 'real\n');
  await symlink(join(root, 'outside.txt'), join(seed, 'src', 'link.mjs'));

  await assert.rejects(
    () => digestSeedTree(seed),
    (error) => error instanceof Error && /symlink/.test(String(error)),
  );
  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: 'run-s', candidateRoot: join(root, 'c'), seedRoot: seed }),
    (error) => error instanceof Error && /symlink/.test(String(error)),
  );
});

test('the prepared candidate is readable through the bounded workspace reader', async () => {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate-readable');
  await prepareCandidateWorkspace({ runId: 'run-readable', candidateRoot, seedRoot: SEED });

  let authorized = 0;
  const reader = createWorkspaceReader({ root: candidateRoot, authorize: async () => { authorized += 1; } });

  const read = await reader.invoke('workspace.read', { path: 'src/exporter.mjs' });
  assert.equal(read.kind, 'read');
  assert.equal(read.path, 'src/exporter.mjs');
  assert.match(read.text, /updatedAt/);
  assert.match(read.digest, /^[0-9a-f]{64}$/);
  assert.ok(authorized > 0, 'every invocation re-authorizes');

  const inspect = await reader.invoke('workspace.inspect', {});
  assert.equal(inspect.kind, 'inspect');
  const paths = inspect.kind === 'inspect' ? inspect.files.map(f => f.path) : [];
  assert.ok(paths.includes('src/exporter.mjs'));
  assert.ok(!paths.some(p => p === CANDIDATE_MARKER), 'hidden marker files stay outside the model view');

  const search = await reader.invoke('workspace.search', { query: 'updatedAt' });
  assert.equal(search.kind, 'search');
  assert.ok((search.kind === 'search' ? search.matches : []).length > 0);
});

test('the registered candidate exposes no protected material to the model view', async () => {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate-no-secrets');
  await prepareCandidateWorkspace({ runId: 'run-nosecrets', candidateRoot, seedRoot: SEED });
  const reader = createWorkspaceReader({ root: candidateRoot, authorize: async () => {} });

  const listing = await reader.invoke('workspace.inspect', {});
  assert.equal(listing.kind, 'inspect');
  const paths = listing.kind === 'inspect' ? listing.files.map((f) => f.path) : [];
  assert.deepEqual(paths, ['src/exporter.mjs'], 'only the authored candidate source is visible');
  for (const forbidden of ['protected_cases', 'expected_stdout', 'seed', CANDIDATE_MARKER]) {
    assert.ok(!paths.some((p) => p.includes(forbidden)), `${forbidden} must not be in the model view`);
  }
  assert.ok(!paths.some((p) => p.endsWith('.pem') || p.endsWith('.key')));
});

test('an interrupted staging copy is cleaned up and never published', async () => {
  const root = await tempDir();
  const seed = join(root, 'seed');
  await mkdir(join(seed, 'src'), { recursive: true });
  await writeFile(join(seed, 'src', 'exporter.mjs'), 'template\n');
  const candidateRoot = join(root, 'candidate');
  await prepareCandidateWorkspace({ runId: 'run-interrupt', candidateRoot, seedRoot: seed });

  const staging = `${candidateRoot}.staging-run-interrupt`;
  assert.ok((await stat(candidateRoot)).isDirectory(), 'the candidate was published');
  await assert.rejects(() => stat(staging), (error) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  assert.equal((await readFile(join(candidateRoot, 'src', 'exporter.mjs'), 'utf8')), 'template\n');
});

test('an empty run identity is refused', async () => {
  const root = await tempDir();
  await assert.rejects(
    () => prepareCandidateWorkspace({ runId: '  ', candidateRoot: join(root, 'c'), seedRoot: SEED }),
    (error) => error instanceof Error && /run identity is required/.test(String(error)),
  );
});

test('a seed directory swapped for a symlink after listing is refused before recursion', async t => {
  const fs = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const root = await tempDir(), seed = join(root, 'seed'), outside = join(root, 'outside');
  await mkdir(join(seed, 'src'), { recursive: true }); await mkdir(outside);
  await writeFile(join(outside, 'private.mjs'), 'outside seed');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = fs.readdir;
  const mock = t.mock.method(fs, 'readdir', async (...args: Parameters<typeof fs.readdir>) => {
    const entries = await Reflect.apply(original, fs, args);
    if (String(args[0]) === seed) { await fs.rm(join(seed, 'src'), { recursive: true }); await symlink(outside, join(seed, 'src')); }
    return entries;
  });
  syncBuiltinESMExports();
  try { await assert.rejects(digestSeedTree(seed), /seed changed/); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
