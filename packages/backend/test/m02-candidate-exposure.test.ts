import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANDIDATE_MARKER, digestSeedTree, prepareCandidateWorkspace } from '../src/workspace/candidate.js';
import { WorkspaceError, createWorkspaceReader } from '../src/workspace/read-only.js';
import { READ_ONLY_FUNCTIONS, resolveReadOnlyFunction } from '../src/workspace/tools.js';

/**
 * M02 priority 5: the registered candidate is what the model's tools may read,
 * and exactly three read-only tools are exposed through explicit wire mappings.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED = join(REPO_ROOT, 'fixtures/inventory-export-v1/seed');

const tempDir = async (): Promise<string> => realpath(await mkdtemp(join(tmpdir(), 'threadline-b-cand-')));
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function candidate(runId = 'candidate-run'): Promise<string> {
  const root = await tempDir();
  const candidateRoot = join(root, 'candidate');
  await prepareCandidateWorkspace({ runId, candidateRoot, seedRoot: SEED });
  return candidateRoot;
}

test('the registered candidate reads the authored exporter with a real range, digest and truncation', async () => {
  const root = await candidate();
  const reader = createWorkspaceReader({ root, authorize: async () => {} });
  const onDisk = await readFile(join(root, 'src', 'exporter.mjs'));

  const whole = await reader.invoke('workspace.read', { path: 'src/exporter.mjs' });
  assert.equal(whole.kind, 'read');
  assert.equal(whole.digest, sha(onDisk), 'the digest must cover the whole file, not the range');
  assert.equal(whole.totalBytes, onDisk.length);
  assert.equal(whole.text, onDisk.toString('utf8'));
  assert.equal(whole.truncated, false);

  const ranged = await reader.invoke('workspace.read', { path: 'src/exporter.mjs', offset: 10, maxBytes: 40 });
  assert.equal(ranged.kind, 'read');
  assert.equal(ranged.offset, 10);
  assert.equal(ranged.returnedBytes, 40);
  assert.equal(ranged.truncated, true, 'a bounded range must report truncation');
  assert.equal(ranged.text, onDisk.subarray(10, 50).toString('utf8'));

  const capped = await reader.invoke('workspace.read', { path: 'src/exporter.mjs', maxBytes: 16 });
  assert.equal(capped.kind, 'read');
  assert.ok((capped.returnedBytes ?? 0) <= 16);
});

test('search and inspect see genuine candidate content', async () => {
  const root = await candidate();
  const reader = createWorkspaceReader({ root, authorize: async () => {} });

  const found = await reader.invoke('workspace.search', { query: 'updatedAt' });
  assert.equal(found.kind, 'search');
  const matches = found.kind === 'search' ? found.matches : [];
  assert.ok(matches.some((m) => m.path === 'src/exporter.mjs' && m.line > 0));

  const listing = await reader.invoke('workspace.inspect', {});
  assert.equal(listing.kind, 'inspect');
  const paths = listing.kind === 'inspect' ? listing.files.map((f) => f.path) : [];
  assert.deepEqual(paths, ['src/exporter.mjs']);
  assert.ok(!paths.includes(CANDIDATE_MARKER), 'the run marker stays outside the model view');
});

test('traversal, absolute, hidden, secret and symlink escapes are all denied', async () => {
  const root = await candidate();
  const outside = join(root, '..', 'outside.txt');
  await writeFile(outside, 'secret\n');
  await symlink(outside, join(root, 'src', 'link.mjs'));
  await writeFile(join(root, 'src', 'private.pem'), 'k\n');

  const reader = createWorkspaceReader({ root, authorize: async () => {} });
  for (const path of ['../outside.txt', '/etc/passwd', 'src/link.mjs', 'src/private.pem', 'src/.hidden', 'node_modules/x']) {
    await assert.rejects(
      () => reader.invoke('workspace.read', { path }),
      (error) => error instanceof WorkspaceError,
      `${path} must be denied`,
    );
  }
  // The candidate itself is untouched by the denial.
  const still = await reader.invoke('workspace.read', { path: 'src/exporter.mjs' });
  assert.equal(still.kind, 'read');
});

test('a hardlinked file is refused and NUL-bearing content is refused as unsupported', async () => {
  const root = await candidate();
  await link(join(root, 'src', 'exporter.mjs'), join(root, 'src', 'hard.mjs'));
  await writeFile(join(root, 'src', 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]));

  const reader = createWorkspaceReader({ root, authorize: async () => {} });
  await assert.rejects(() => reader.invoke('workspace.read', { path: 'src/hard.mjs' }),
    (error) => error instanceof WorkspaceError && /regular, singly linked/.test(error.message));
  await assert.rejects(() => reader.invoke('workspace.read', { path: 'src/binary.bin' }),
    (error) => error instanceof WorkspaceError && error.code === 'unsupported_encoding');
});

test('permission is re-authorized on every invocation and revocation stops the next read', async () => {
  const root = await candidate();
  let allowed = true;
  let checks = 0;
  const reader = createWorkspaceReader({
    root,
    authorize: async () => { checks += 1; if (!allowed) throw new Error('revoked'); },
  });

  assert.equal((await reader.invoke('workspace.read', { path: 'src/exporter.mjs' })).kind, 'read');
  assert.equal(checks, 1);
  await reader.invoke('workspace.search', { query: 'updatedAt' });
  await reader.invoke('workspace.inspect', {});
  assert.equal(checks, 3, 'authorization is per invocation, not per reader');

  allowed = false;
  await assert.rejects(() => reader.invoke('workspace.read', { path: 'src/exporter.mjs' }), /revoked/,
    'a revoked permission must stop the next read');
  // An inspect after revocation must not leak a file listing either.
  await assert.rejects(() => reader.invoke('workspace.inspect', {}), /revoked/);
});

test('the candidate holds no protected output, credential or backend state', async () => {
  const root = await candidate();
  const reader = createWorkspaceReader({ root, authorize: async () => {} });
  const listing = await reader.invoke('workspace.inspect', { maxFiles: 1000 });
  assert.equal(listing.kind, 'inspect');
  const paths = listing.kind === 'inspect' ? listing.files : [];
  assert.deepEqual(paths.map((f) => f.path), ['src/exporter.mjs']);

  // The candidate is a separate directory whose source content is an exact copy
  // of the seed. `digestSeedTree` skips dotfiles, so the run marker does not
  // affect the digest and equal digests prove nothing was altered or repaired.
  const seedDigest = await digestSeedTree(SEED);
  const candidateDigest = await digestSeedTree(root);
  assert.equal(candidateDigest.digest, seedDigest.digest,
    'the candidate must be a byte-exact copy of the authored seed content');
  assert.notEqual(root, SEED, 'the candidate is a separate directory, not the seed itself');

  // The manifest with its protected cases and expected output lives in the plans
  // tree. Nothing from it may be reachable inside the candidate.
  const probe = await reader.invoke('workspace.read', { path: 'protected_cases.json' })
    .then(() => 'readable', () => 'denied');
  assert.equal(probe, 'denied');
  const search = await reader.invoke('workspace.search', { query: 'expected_stdout' });
  assert.equal(search.kind === 'search' ? search.matches.length : -1, 0,
    'no expected output may be searchable inside the candidate');
});

test('exactly three read-only tools are exposed through explicit wire mappings', () => {
  assert.equal(READ_ONLY_FUNCTIONS.length, 3);
  const names = READ_ONLY_FUNCTIONS.map((tool) => tool.name);
  assert.deepEqual(names, ['workspace_read', 'workspace_search', 'workspace_inspect']);

  assert.equal(resolveReadOnlyFunction('workspace_read'), 'workspace.read');
  assert.equal(resolveReadOnlyFunction('workspace_search'), 'workspace.search');
  assert.equal(resolveReadOnlyFunction('workspace_inspect'), 'workspace.inspect');

  // Nothing else resolves, including names that exist elsewhere in the plan.
  for (const denied of [
    'workspace_apply_patch', 'workspace_run', 'memory_retrieve', 'task_request_completion',
    'task_update_plan', 'interaction_ask_user', 'memory_checkpoint', 'memory_refresh',
    'workspace_poll', 'memory_propose_decision', 'review_submit', '', 'toString', '__proto__',
  ]) {
    assert.equal(resolveReadOnlyFunction(denied), null, `${denied} must not resolve to a tool`);
  }

  // Each schema is strict and closed, so an unexpected argument cannot pass.
  for (const tool of READ_ONLY_FUNCTIONS) {
    assert.equal(tool.strict, true);
    assert.equal((tool.parameters as { additionalProperties?: boolean }).additionalProperties, false);
  }
});

test('the candidate keeps the authored UTC defect rather than a silently repaired exporter', async () => {
  const root = await candidate();
  const reader = createWorkspaceReader({ root, authorize: async () => {} });
  const result = await reader.invoke('workspace.read', { path: 'src/exporter.mjs' });
  assert.equal(result.kind, 'read');
  assert.ok(result.kind === 'read' && /updatedAt/.test(result.text));

  // The defect is the preserved offset text instead of ISO UTC milliseconds.
  const text = result.kind === 'read' ? result.text : '';
  assert.match(text, /toISOString|updated_at_utc/);
  assert.match(text, /updatedAt/, 'the timestamp handling that M02B05 discloses is still present');

  // The seed is byte-identical to the copy, so nothing repaired the template.
  const seedBytes = await readFile(join(SEED, 'src', 'exporter.mjs'), 'utf8');
  assert.equal(text, seedBytes, 'the candidate must be an exact copy of the authored template');
  void chmod;
});

void chmod;