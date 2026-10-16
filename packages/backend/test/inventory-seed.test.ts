import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

interface Case { id: string; phase: string; max_age_seconds?: number; input: unknown; expected_exit: number; expected_stdout: string; expected_error_code?: string }
const manifest = JSON.parse(await readFile(new URL('../../../../archive/plans/contracts/fixture-manifest.json', import.meta.url), 'utf8')) as { reference_time: string; protected_cases: Case[] };
const seed = fileURLToPath(new URL('../../../../fixtures/inventory-export-v1/seed/src/exporter.mjs', import.meta.url));
function run(input: unknown, maxAge = 600): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [seed, '--as-of', manifest.reference_time, '--max-age-seconds', String(maxAge)], {
      env: {}, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += String(bytes); });
    child.stderr.on('data', bytes => { stderr += String(bytes); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('authored seed exhibits the disclosed real UTC-format defect', async () => {
  const input = manifest.protected_cases.find(item => item.id === 'initial-mixed-offsets');
  assert.ok(input);
  const result = await run(input.input);
  assert.equal(result.code, 0);
  assert.notEqual(result.stdout, input.expected_stdout);
  assert.ok(result.stdout.includes('2026-10-15T11:59:10Z'));
  assert.ok(!result.stdout.includes('2026-10-15T11:59:10.000Z'));
});

test('seed preserves declared invalid-input diagnostics and emits no partial CSV', async () => {
  for (const item of manifest.protected_cases.filter(item => item.expected_exit !== 0)) {
    const result = await run(item.input);
    assert.equal(result.code, item.expected_exit, item.id);
    assert.equal(result.stdout, '', item.id);
    assert.equal((JSON.parse(result.stderr) as { code: string }).code, item.expected_error_code, item.id);
  }
});

test('seed obeys inclusive freshness, future exclusion, ASCII order and CSV quoting', async () => {
  const result = await run([
    { sku: 'z', qty: 1, updatedAt: '2026-10-15T11:50:00Z' },
    { sku: 'a,"b', qty: 2, updatedAt: '2026-10-15T11:59:00Z' },
    { sku: 'future', qty: 3, updatedAt: '2026-10-15T12:00:01Z' },
    { sku: 'old', qty: 4, updatedAt: '2026-10-15T11:49:59Z' },
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'sku,qty,updated_at_utc\n"a,""b",2,2026-10-15T11:59:00Z\nz,1,2026-10-15T11:50:00Z\n');
});
