import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGoalAdmissionInput } from '../dist/admission/build.js';
import {
  RequestPayloadConflictError,
  RequestRecordError,
  digestAdmissionInput,
  readAdmissionRequestRecord,
  resolveAdmissionRequestId,
} from '../dist/admission/request-record.js';
import { loadFixtureManifest } from '../dist/fixture/manifest.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CANONICAL = join(REPO_ROOT, 'archive/plans/contracts/fixture-manifest.json');

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'threadline-admit-'));
}

async function canonicalManifest(t) {
  try {
    return await loadFixtureManifest(CANONICAL);
  } catch {
    t.skip(`canonical manifest not present at ${CANONICAL}`);
    return null;
  }
}

test('admission payload takes the accepted freshness value, never the changed one', async (t) => {
  const manifest = await canonicalManifest(t);
  if (manifest === null) return;

  const input = buildGoalAdmissionInput(manifest, {
    projectId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
  });

  assert.equal(input.fixtureId, 'inventory-export-v1');
  assert.ok(input.goalText.startsWith(manifest.acceptedGoal));
  for (const rule of manifest.rules) assert.ok(input.goalText.includes(rule));
  assert.equal(input.requirements.length, 1);
  const requirement = input.requirements[0];
  assert.equal(requirement.field, 'max_age_seconds');
  assert.equal(requirement.value, 600, 'first admission accepts the initial bound');
  assert.equal(requirement.minimum, 0);
  assert.equal(requirement.maximum, 3600);
  assert.equal(requirement.revision, 1);
  assert.notEqual(requirement.value, 60, 'the changed requirement must not be admitted up front');
});

test('criteria are exactly the declared protected cases, labelled from their own fields', async (t) => {
  const manifest = await canonicalManifest(t);
  if (manifest === null) return;

  const input = buildGoalAdmissionInput(manifest, {
    projectId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
  });

  assert.equal(input.criteria.length, 6);
  const refs = input.criteria.map((criterion) => criterion.ref);
  assert.deepEqual(refs, manifest.protectedCases.filter(c=> c.phase === 'initial' || c.phase === 'both').map((c) => c.id));
  assert.ok(refs.includes('initial-mixed-offsets'));
  assert.ok(!refs.includes('held-out-compatible-v1'), 'the held-out case is not an initial criterion');

  for (const criterion of input.criteria) {
    assert.equal(criterion.kind, 'assertion');
    assert.equal(criterion.required, true);
    assert.ok(
      criterion.text.includes(criterion.ref),
      'criterion text must name the case it came from, not an invented description',
    );
  }
});

test('the payload never carries protected-case inputs or expected output', async (t) => {
  const manifest = await canonicalManifest(t);
  if (manifest === null) return;

  const serialised = JSON.stringify(
    buildGoalAdmissionInput(manifest, {
      projectId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    }),
  );

  assert.ok(!serialised.includes('expected_stdout'), 'no expected output may reach the client');
  assert.ok(!serialised.includes('expected_exit'), 'protected test definitions stay out of the payload');
  // The public CSV header is an accepted rule, not a held-out expected result.
});

test('the same payload reuses one request id; a changed payload refuses', async () => {
  const dir = await tempDir();
  const path = join(dir, 'request.json');
  const base = { projectId: '11111111-1111-4111-8111-111111111111', fixtureId: 'inventory-export-v1', requirements:[{field:'age',type:'integer',value:600,minimum:0,maximum:3600,revision:1}],criteria:[{kind:'assertion',ref:'fresh',text:'Fresh rows',required:true,expectedExitCode:0}] };

  let counter = 0;
  const uuidImpl = () => {
    counter += 1;
    return `33333333-3333-4333-8333-00000000000${counter}`;
  };

  const first = await resolveAdmissionRequestId(path, { ...base, goalText: 'goal A' }, { uuidImpl });
  const retry = await resolveAdmissionRequestId(path, { ...base, goalText: 'goal A' }, { uuidImpl });
  assert.equal(retry.requestId, first.requestId, 'a retry must reuse the durable request id');
  assert.equal(retry.requestDigest, first.requestDigest);
  assert.equal(counter, 1, 'no second id may be minted for the same payload');

  await assert.rejects(
    () => resolveAdmissionRequestId(path, { ...base, goalText: 'goal B' }, { uuidImpl }),
    (error) => error instanceof RequestPayloadConflictError,
    'changing the payload behind an existing id must be refused, not silently re-admitted',
  );
  assert.equal(counter, 1, 'a conflicting payload must not mint a new id');
});

test('the digest ignores key order but not values', async () => {
  const a = { projectId: 'p', requestId: 'r', fixtureId: 'f', goalText: 'g', requirements: [], criteria: [] };
  const reordered = { criteria: [], requirements: [], goalText: 'g', fixtureId: 'f', requestId: 'r', projectId: 'p' };
  const changed = { ...a, goalText: 'different' };

  assert.equal(digestAdmissionInput(a), digestAdmissionInput(reordered));
  assert.notEqual(digestAdmissionInput(a), digestAdmissionInput(changed));
});

test('a record is written owner-only and read back unchanged', async () => {
  const dir = await tempDir();
  const path = join(dir, 'nested', 'request.json');
  await resolveAdmissionRequestId(path, {
    projectId: '11111111-1111-4111-8111-111111111111',
    fixtureId: 'inventory-export-v1',
    goalText: 'goal',
    requirements: [{field:'age',type:'integer',value:600,minimum:0,maximum:3600,revision:1}],
    criteria: [{kind:'assertion',ref:'fresh',text:'Fresh rows',required:true,expectedExitCode:0}],
  });

  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.requestId, 'the stored record must carry the id');
  assert.ok(parsed.requestDigest, 'the stored record must carry the digest');

  const reread = await readAdmissionRequestRecord(path);
  assert.equal(reread.requestId, parsed.requestId);
  assert.equal(reread.requestDigest, parsed.requestDigest);
});

test('a corrupt record is refused rather than replaced', async () => {
  const dir = await tempDir();
  const path = join(dir, 'request.json');
  await writeFile(path, JSON.stringify({ requestId: 'not-a-uuid', requestDigest: 'x' }));
  await assert.rejects(
    () => readAdmissionRequestRecord(path),
    (error) => error instanceof RequestRecordError && /requestId UUID/.test(error.message),
  );
});
