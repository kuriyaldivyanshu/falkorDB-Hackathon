import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceReader, WorkspaceError } from '../src/workspace/read-only.js';
import { READ_ONLY_FUNCTIONS, resolveReadOnlyFunction } from '../src/workspace/tools.js';

async function setup(t: test.TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'threadline-read-tools-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'candidate');
  await mkdir(root);
  let allowed = true, checks = 0;
  const reader = createWorkspaceReader({ root, authorize: async () => { checks += 1; if (!allowed) throw new Error('claim denied'); } });
  return { directory, root, reader, checks: () => checks, deny: () => { allowed = false; } };
}

test('read-only tools inspect/read/search a real candidate copy while preserving the authored seed', async t => {
  const { root, reader } = await setup(t);
  const actualSeed = new URL('../../../../fixtures/inventory-export-v1/seed/', import.meta.url);
  await cp(actualSeed, root, { recursive: true });
  const original = await readFile(new URL('src/exporter.mjs', actualSeed));
  const inspected = await reader.invoke('workspace.inspect', {});
  assert.equal(inspected.kind, 'inspect');
  if (inspected.kind === 'inspect') assert.ok(inspected.files.some(file => file.path === 'src/exporter.mjs'));
  const read = await reader.invoke('workspace.read', { path: 'src/exporter.mjs', offset: 0, maxBytes: 150 });
  assert.equal(read.kind, 'read');
  if (read.kind === 'read') {
    assert.equal(read.digest, createHash('sha256').update(original).digest('hex'));
    assert.equal(read.returnedBytes, 150); assert.equal(read.truncated, true);
  }
  const found = await reader.invoke('workspace.search', { query: 'row.updatedAt' });
  assert.equal(found.kind, 'search');
  if (found.kind === 'search') assert.ok(found.matches.some(match => match.path === 'src/exporter.mjs' && match.line > 0));
  assert.deepEqual(await readFile(new URL('src/exporter.mjs', actualSeed)), original);
});

test('every invocation rechecks current authorization before filesystem work', async t => {
  const fixture = await setup(t);
  await fixture.reader.invoke('workspace.inspect', {});
  fixture.deny();
  await assert.rejects(() => fixture.reader.invoke('workspace.read', { path: 'missing' }), /claim denied/);
  assert.equal(fixture.checks(), 2);
});

test('traversal, absolute paths, secret paths and shell-looking search text cannot escape', async t => {
  const { root, reader } = await setup(t);
  await writeFile(join(root, 'safe.txt'), 'literal $(touch nope)\n');
  for (const path of ['../secret', '/etc/passwd', 'safe/../../secret', '.env', '.git/config', 'node_modules/pkg', 'secret.key', 'safe\\..\\secret', 'safe.txt\0']) {
    await assert.rejects(() => reader.invoke('workspace.read', { path }), error => error instanceof WorkspaceError && error.code === 'path_denied');
  }
  const result = await reader.invoke('workspace.search', { query: '$(touch nope)' });
  assert.equal(result.kind, 'search');
  if (result.kind === 'search') assert.equal(result.matches.length, 1);
});

test('symlink files, symlink directories and hardlinks are not readable', async t => {
  const { directory, root, reader } = await setup(t);
  await writeFile(join(directory, 'outside.txt'), 'outside');
  await symlink(join(directory, 'outside.txt'), join(root, 'link.txt'));
  await symlink(directory, join(root, 'alias'));
  await link(join(directory, 'outside.txt'), join(root, 'hard.txt'));
  for (const path of ['link.txt', 'alias/outside.txt', 'hard.txt']) {
    await assert.rejects(() => reader.invoke('workspace.read', { path }), error => error instanceof WorkspaceError && error.code === 'path_denied');
  }
  const result = await reader.invoke('workspace.inspect', {});
  if (result.kind === 'inspect') assert.deepEqual(result.files, []);
});

test('unsupported UTF-8 and binary content are rejected explicitly', async t => {
  const { root, reader } = await setup(t);
  for (const [name, bytes] of [['bad', Buffer.from([0xff])], ['binary', Buffer.from([0x61, 0])]] as const) {
    await writeFile(join(root, name), bytes);
    await assert.rejects(() => reader.invoke('workspace.read', { path: name }), error => error instanceof WorkspaceError && error.code === 'unsupported_encoding');
  }
});

test('UTF-8 ranges retain character boundaries, exact byte metadata and full-file digest', async t => {
  const { root, reader } = await setup(t);
  await writeFile(join(root, 'unicode'), 'a😀b');
  const result = await reader.invoke('workspace.read', { path: 'unicode', maxBytes: 4 });
  if (result.kind === 'read') { assert.equal(result.text, 'a'); assert.equal(result.returnedBytes, 1); assert.equal(result.totalBytes, 6); }
  await assert.rejects(() => reader.invoke('workspace.read', { path: 'unicode', offset: 2 }), /UTF-8 character boundary/);
  await assert.rejects(() => reader.invoke('workspace.read', { path: 'unicode', offset: 7 }), /Offset exceeds/);
});

test('result, range, search and inspection limits are enforced with explicit truncation', async t => {
  const { root, reader } = await setup(t);
  await writeFile(join(root, 'many.txt'), '\u0001'.repeat(40_000));
  const range = await reader.invoke('workspace.read', { path: 'many.txt' });
  assert.ok(Buffer.byteLength(JSON.stringify(range)) <= 32768);
  if (range.kind === 'read') assert.equal(range.truncated, true);
  await writeFile(join(root, 'matches.txt'), 'hit\n'.repeat(50));
  const search = await reader.invoke('workspace.search', { query: 'hit', maxResults: 2 });
  if (search.kind === 'search') { assert.equal(search.matches.length, 2); assert.equal(search.truncated, true); }
  const inspect = await reader.invoke('workspace.inspect', { maxFiles: 1 });
  if (inspect.kind === 'inspect') { assert.equal(inspect.files.length, 1); assert.equal(inspect.truncated, true); }
  for (const input of [{ path: 'many.txt', maxBytes: 32769 }, { path: 'many.txt', offset: -1 }, { path: 'many.txt', unknown: true }])
    await assert.rejects(() => reader.invoke('workspace.read', input), WorkspaceError);
  await assert.rejects(() => reader.invoke('workspace.search', { query: 'x'.repeat(513) }), WorkspaceError);
});

test('only three read-only functions have provider wire mappings', () => {
  assert.equal(READ_ONLY_FUNCTIONS.length, 3);
  assert.equal(resolveReadOnlyFunction('workspace_read'), 'workspace.read');
  for (const name of ['workspace_run', 'workspace_apply_patch', 'task_request_completion', '__proto__']) assert.equal(resolveReadOnlyFunction(name), null);
});
