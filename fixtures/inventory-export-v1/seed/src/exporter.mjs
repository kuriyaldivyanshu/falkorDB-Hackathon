#!/usr/bin/env node
// Authored imperfect seed: deliberately preserves input timestamp offsets.
// It is not a generated model failure. The native-agent demo task asks for UTC normalization.
import { readFileSync } from 'node:fs';

function fail(code) {
  process.stderr.write(`${JSON.stringify({ code })}\n`);
  process.exitCode = 2;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
const quote = value => /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--as-of' || args[2] !== '--max-age-seconds' || !/^\d+$/.test(args[3])) return fail('INVALID_ARGUMENT');
  const reference = timestamp(args[1]);
  const maxAge = Number(args[3]);
  if (reference === null || !Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > 3600) return fail('INVALID_ARGUMENT');
  let records;
  try { records = JSON.parse(readFileSync(0, 'utf8')); } catch { return fail('INVALID_INPUT'); }
  if (!Array.isArray(records)) return fail('INVALID_INPUT');
  const seen = new Set(), valid = [];
  for (const row of records) {
    if (typeof row !== 'object' || row === null || Array.isArray(row) || typeof row.sku !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(row.sku)) return fail('INVALID_RECORD');
    if (!Number.isInteger(row.qty) || row.qty < 0 || row.qty > 1000000000) return fail('INVALID_QUANTITY');
    if (seen.has(row.sku)) return fail('DUPLICATE_SKU');
    seen.add(row.sku);
    const instant = timestamp(row.updatedAt);
    if (instant === null) return fail('INVALID_TIMESTAMP');
    const age = reference - instant;
    if (age >= 0 && age <= maxAge * 1000) valid.push(row);
  }
  valid.sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
  // Deliberate defect: use row.updatedAt rather than new Date(...).toISOString().
  const lines = valid.map(row => `${quote(row.sku)},${row.qty},${quote(row.updatedAt)}`);
  process.stdout.write(['sku,qty,updated_at_utc', ...lines].join('\n') + '\n');
}
main();
