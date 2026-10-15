import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FixtureManifestError,
  loadFixtureManifest,
  previewFixture,
  toAcceptancePayload,
} from '../dist/fixture/manifest.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CANONICAL = join(REPO_ROOT, 'archive/plans/contracts/fixture-manifest.json');

async function tempManifest(body, name = 'fixture-manifest.json') {
  const dir = await mkdtemp(join(tmpdir(), 'threadline-fixture-'));
  const path = join(dir, name);
  await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return path;
}

const MINIMAL = {
  schema_version: 1,
  status: 'proposed-not-executed',
  fixture_id: 'inventory-export-v1',
  task_kind: 'inventory-export',
  entrypoint: 'src/exporter.mjs',
  reference_time: '2026-10-15T12:00:00Z',
  accepted_goal: 'Produce deterministic CSV.',
  initial_requirement: { revision: '1', max_age_seconds: 600 },
  changed_requirement: { revision: '2', max_age_seconds: 60 },
  allowed_human_change: { field: 'max_age_seconds', minimum: 0, maximum: 3600, admission: 'explicit acceptance' },
  rules: ['first rule', 'second rule'],
  protected_cases: [{ id: 'case-a' }, { id: 'case-b' }],
  verification_contract: { receipt_binding: ['candidate_digest', 'check_run_id'] },
};

test('acceptance payload carries only manifest values, never invented defaults', async () => {
  const path = await tempManifest(MINIMAL);
  const manifest = await loadFixtureManifest(path);

  const payload = toAcceptancePayload(manifest);
  assert.equal(payload.fixtureId, 'inventory-export-v1');
  assert.equal(payload.maxAgeSeconds, 600);
  assert.equal(payload.requirementRevision, '1');
  assert.deepEqual(payload.rules, ['first rule', 'second rule']);
  assert.equal(payload.fixtureDigest, manifest.digest);
  // The changed requirement is deliberately not what gets accepted at first admission.
  assert.notEqual(payload.maxAgeSeconds, 60);
});

test('digest tracks the exact bytes, so a manifest edit is detectable', async () => {
  const first = await loadFixtureManifest(await tempManifest(MINIMAL));
  const edited = await loadFixtureManifest(
    await tempManifest({ ...MINIMAL, accepted_goal: 'Produce different CSV.' }),
  );
  const same = await loadFixtureManifest(await tempManifest(MINIMAL));

  assert.notEqual(first.digest, edited.digest, 'an edited manifest must change the digest');
  assert.equal(first.digest, same.digest, 'identical content must produce an identical digest');
  assert.match(first.digest, /^[0-9a-f]{64}$/);
});

test('a malformed manifest is refused with the field, not silently accepted', async () => {
  const missingRules = await tempManifest({ ...MINIMAL, rules: undefined });
  await assert.rejects(
    () => loadFixtureManifest(missingRules),
    (error) => error instanceof FixtureManifestError && /"rules"/.test(error.message),
  );

  const wrongVersion = await tempManifest({ ...MINIMAL, schema_version: 2 });
  await assert.rejects(
    () => loadFixtureManifest(wrongVersion),
    (error) => error instanceof FixtureManifestError && /schema_version 2/.test(error.message),
  );

  const notJson = await tempManifest('{ this is not json');
  await assert.rejects(
    () => loadFixtureManifest(notJson),
    (error) => error instanceof FixtureManifestError && /not valid JSON/.test(error.message),
  );

  const badMaxAge = await tempManifest({
    ...MINIMAL,
    initial_requirement: { revision: '1', max_age_seconds: '600' },
  });
  await assert.rejects(
    () => loadFixtureManifest(badMaxAge),
    (error) => error instanceof FixtureManifestError && /max_age_seconds/.test(error.message),
  );
});

test('a missing manifest explains how to point at one', async () => {
  await assert.rejects(
    () => loadFixtureManifest(join(tmpdir(), 'threadline-does-not-exist', 'fixture-manifest.json')),
    (error) => error instanceof FixtureManifestError && /--fixture-manifest/.test(error.message),
  );
});

test('preview shows the goal, freshness value, rules and digest before acceptance', async () => {
  const manifest = await loadFixtureManifest(await tempManifest(MINIMAL));
  const text = previewFixture(manifest).join('\n');

  assert.match(text, /inventory-export-v1/);
  assert.match(text, /max_age_seconds = 600/);
  assert.match(text, new RegExp(manifest.digest));
  assert.match(text, /1\. first rule/);
  // Protected cases must be counted, never published as expected outputs.
  assert.match(text, /Protected cases declared: 2/);
  assert.match(text, /not published here/);
});

test('the canonical manifest still declares the acceptance fields the design fixes', {
  skip: false,
}, async (t) => {
  let available = true;
  try {
    await loadFixtureManifest(CANONICAL);
  } catch {
    available = false;
  }
  if (!available) {
    t.skip(`canonical manifest not present at ${CANONICAL}`);
    return;
  }

  const manifest = await loadFixtureManifest(CANONICAL);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.fixtureId, 'inventory-export-v1');
  assert.equal(manifest.taskKind, 'inventory-export');
  assert.equal(manifest.entrypoint, 'src/exporter.mjs');
  assert.equal(manifest.referenceTime, '2026-10-15T12:00:00Z');
  assert.equal(manifest.initialRequirement.maxAgeSeconds, 600);
  assert.equal(manifest.initialRequirement.revision, '1');
  assert.equal(manifest.changedRequirement.maxAgeSeconds, 60);
  assert.equal(manifest.allowedHumanChange.field, 'max_age_seconds');
  assert.equal(manifest.rules.length, 8, 'the design fixes eight accepted rules');
  assert.match(manifest.digest, /^[0-9a-f]{64}$/);
  assert.ok(
    manifest.receiptBindingFields.includes('verified_by_actor_id'),
    'receipt binding must include the service verifier identity',
  );
});
