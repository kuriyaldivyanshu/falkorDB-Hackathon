import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CREDENTIAL_FILE_MODE,
  CredentialError,
  newBootstrapToken,
  readLocalSessionCredential,
  redactSecrets,
  writeLocalSessionCredential,
} from '../dist/credentials/local-session.js';

const SECRET = 'a-local-session-token-value-1234567890';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'threadline-cred-'));
}

test('a written credential is owner-only and round-trips', async () => {
  const dir = await tempDir();
  const path = join(dir, 'session.json');
  const issuedAt = new Date().toISOString();

  await writeLocalSessionCredential(path, {
    token: SECRET,
    issuedAt,
    backendUrl: 'http://127.0.0.1:47821',
  });

  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, CREDENTIAL_FILE_MODE, `expected 0600, got 0${mode.toString(8)}`);

  const loaded = await readLocalSessionCredential(path);
  assert.ok(loaded, 'a stored credential must be found again');
  assert.equal(loaded.token, SECRET);
  assert.equal(loaded.backendUrl, 'http://127.0.0.1:47821');
});

test('writing over an existing world-readable file restores owner-only permissions', async () => {
  const dir = await tempDir();
  const path = join(dir, 'session.json');
  await writeFile(path, '{}', { mode: 0o644 });
  await chmod(path, 0o644);

  await writeLocalSessionCredential(path, {
    token: SECRET,
    issuedAt: new Date().toISOString(),
    backendUrl: 'http://127.0.0.1:47821',
  });

  assert.equal((await stat(path)).mode & 0o777, CREDENTIAL_FILE_MODE);
});

test('a credential readable by group or other is refused, not quietly used', async () => {
  const dir = await tempDir();
  const path = join(dir, 'session.json');
  await writeFile(path, JSON.stringify({ token: SECRET, issuedAt: 'x', backendUrl: 'http://x' }));
  await chmod(path, 0o640);

  await assert.rejects(
    () => readLocalSessionCredential(path),
    (error) => error instanceof CredentialError && /readable beyond its owner/.test(error.message),
  );
});

test('an absent credential is null; a corrupt one is an explicit error', async () => {
  const dir = await tempDir();
  assert.equal(await readLocalSessionCredential(join(dir, 'nothing-here.json')), null);

  const bad = join(dir, 'bad.json');
  await writeFile(bad, 'not json at all');
  await chmod(bad, 0o600);
  await assert.rejects(
    () => readLocalSessionCredential(bad),
    (error) => error instanceof CredentialError && /not valid JSON/.test(error.message),
  );

  const noToken = join(dir, 'no-token.json');
  await writeFile(noToken, JSON.stringify({ issuedAt: 'x', backendUrl: 'http://x' }));
  await chmod(noToken, 0o600);
  await assert.rejects(
    () => readLocalSessionCredential(noToken),
    (error) => error instanceof CredentialError && /"token"/.test(error.message),
  );
});

test('the stored file never contains anything but the credential record', async () => {
  const dir = await tempDir();
  const path = join(dir, 'session.json');
  await writeLocalSessionCredential(path, {
    token: SECRET,
    issuedAt: new Date().toISOString(),
    backendUrl: 'http://127.0.0.1:47821',
  });
  const raw = await readFile(path, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['backendUrl', 'issuedAt', 'token']);
});

test('bootstrap tokens are long and unpredictable', () => {
  const tokens = new Set();
  for (let index = 0; index < 50; index += 1) {
    tokens.add(newBootstrapToken());
  }
  assert.equal(tokens.size, 50, 'tokens must not repeat');
  for (const token of tokens) {
    assert.ok(token.length >= 40, `token too short: ${token.length}`);
  }
});

test('redaction removes a bearer token from any text before it is displayed', () => {
  const line = `backend answered: token ${SECRET} was rejected`;
  const safe = redactSecrets(line, [SECRET]);
  assert.ok(!safe.includes(SECRET), 'the token must not survive redaction');
  assert.match(safe, /<redacted>/);
  assert.match(safe, /backend answered/);

  // Very short strings are not redacted: they would blank out unrelated text.
  assert.equal(redactSecrets('abc def', ['ab']), 'abc def');
});

test('the real backend bootstrap credential format is accepted without exposing its token',async()=>{
 const dir=await tempDir();const path=join(dir,'session.json');
 await writeFile(path,JSON.stringify({session_id:'11111111-1111-4111-8111-111111111111',created_at:'2026-10-15T00:00:00Z',token:SECRET}),{mode:0o600});
 const loaded=await readLocalSessionCredential(path);assert.equal(loaded.issuedAt,'2026-10-15T00:00:00Z');assert.equal(loaded.token,SECRET);
});

test('a credential symlink is refused',async()=>{
 const {symlink}=await import('node:fs/promises');const dir=await tempDir();const target=join(dir,'real.json'),link=join(dir,'linked.json');
 await writeLocalSessionCredential(target,{token:SECRET,issuedAt:'now',backendUrl:'http://localhost'});await symlink(target,link);
 await assert.rejects(()=>readLocalSessionCredential(link),CredentialError);
});
