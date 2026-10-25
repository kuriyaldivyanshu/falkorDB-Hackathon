import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { ConfigurationError, ownerPolicyV3Schema } from '@threadline/shared';

import { installationPaths, projectPreferencesPath } from './environment.js';

export const MAX_POLICY_BYTES = 32_768;
const MAX_POLICY_LINES = 1024;
const OWNER_FILE = 'threadline.toml';
const PROJECT_FILE = '.threadline.toml';

type Field<T> = { readonly fallback: T; readonly read: (value: unknown) => T | undefined };
type Fields = Readonly<Record<string, Field<unknown>>>;
type Values<F extends Fields> = { readonly [K in keyof F]: F[K] extends Field<infer T> ? T : never };
type SectionValues<S extends Readonly<Record<string, Fields>>> = { readonly [K in keyof S]: Values<S[K]> };
type PartialSections<S extends Readonly<Record<string, Fields>>> = { readonly [K in keyof S]?: Partial<Values<S[K]>> };

function fixed<T extends string | number | boolean>(fallback: T): Field<T> {
  return { fallback, read: value => value === fallback ? fallback : undefined };
}
function integer(fallback: number, min: number, max: number): Field<number> {
  return { fallback, read: value => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined };
}
function boolean(fallback: boolean): Field<boolean> {
  return { fallback, read: value => typeof value === 'boolean' ? value : undefined };
}
function common<T>(fallback: T, schema: { safeParse(value: unknown): { success: boolean; data?: T } }): Field<T> {
  return { fallback, read: value => { const result = schema.safeParse(value); return result.success ? result.data : undefined; } };
}
const exclusions: Field<readonly string[]> = {
  fallback: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key'],
  read: value => Array.isArray(value) && value.length <= 64 && value.every(entry =>
    typeof entry === 'string' && Buffer.byteLength(entry) <= 256 && entry.length > 0
    && !/[\x00-\x1f\x7f]/.test(entry) && !isAbsolute(entry) && !entry.split('/').includes('..')) ? [...value] as string[] : undefined,
};
const ceilings = ownerPolicyV3Schema.shape.ceilings.shape;
// File syntax is local configuration, not an owner identity or effective policy
// contract. Shared contract validators remain the source of ceiling bounds.
const ownerSections = {
  ceilings: {
    manual_record: common(false, ceilings.manualRecord),
    checkpoint_callbacks: fixed(false),
    max_payload_bytes: common(65536, ceilings.maxPayloadBytes),
    max_batch_records: common(20, ceilings.maxBatchRecords),
    retention_days: common(30, ceilings.retentionDays),
  },
  retrieval: {
    mode: fixed('on_demand'), allow_agent_requests: boolean(true), allow_explicit_user_requests: boolean(true),
    automatic_session_start: fixed(false), automatic_each_message: fixed(false), automatic_task_change: fixed(false),
    automatic_after_compaction: fixed(false), background_prefetch: fixed(false),
    max_candidates: integer(40, 1, 256), optional_wait_ms: integer(300, 0, 5000),
  },
  context: {
    recall_max_tokens: integer(2000, 1, 16384), followup_max_tokens: integer(1000, 1, 8192),
    active_target_tokens: integer(4000, 1, 32768), mandatory_overflow: fixed('report_incomplete'),
  },
  capture: {
    enabled: fixed(false), process_at: fixed('turn_end'), capture_environment_values: fixed(false), exclude_paths: exclusions,
    exclude_threadline_output: fixed(true), on_filter_failure: fixed('drop_and_record_gap'),
  },
  admission: { shared_decisions: fixed('review'), agent_assertions: fixed('candidate'), automatic_permanent_deletion: fixed(false) },
  processing: { incremental: fixed(true), reuse_completed_jobs: fixed(true), optional_ai_enabled: fixed(false) },
  compaction: {
    checkpoint_when_capture_enabled: boolean(true), failure_policy: fixed('request_stop_if_supported'),
    deadline_ms: integer(1500, 250, 5000), retrieve_after_compaction: fixed(false),
  },
  notifications: { enabled: fixed(false) },
  diagnostics: { include_memory_content: fixed(false), telemetry: fixed(false) },
} as const;
const preferenceSections = {
  retrieval: {
    allow_agent_requests: fixed(false), allow_explicit_user_requests: fixed(false),
    max_candidates: ownerSections.retrieval.max_candidates, optional_wait_ms: ownerSections.retrieval.optional_wait_ms,
  },
  context: {
    recall_max_tokens: ownerSections.context.recall_max_tokens, followup_max_tokens: ownerSections.context.followup_max_tokens,
    active_target_tokens: ownerSections.context.active_target_tokens,
  },
  capture: { enabled: fixed(false), exclude_paths: exclusions },
} as const;

export type ProductPolicySettings = SectionValues<typeof ownerSections> & { readonly schema_version: 1 };
export type ProjectPreferences = PartialSections<typeof preferenceSections> & { readonly schema_version: 1 };
export interface LoadedProductPolicy {
  readonly state: 'restrictive-defaults' | 'configured';
  /** Validation is not policy approval/activation; M04-02 owns revision fencing. */
  readonly activation: 'unactivated';
  readonly settings: ProductPolicySettings;
}
export interface LoadedProjectPreferences {
  readonly state: 'absent' | 'configured';
  readonly trust: 'untrusted-preferences';
  /** A bounded candidate, never merged into authority by this parser. */
  readonly settings: ProjectPreferences;
}

/** No credentials, filesystem paths or parser excerpts enter diagnostics. */
function invalid(file: string, key: string, reason: string): never {
  throw new ConfigurationError([{ field: `${file}#${key}`, problem: reason,
    hint: 'Repair the named policy file/key and retry. Existing files and approved policy are preserved.' }]);
}
function table(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function decode(text: string, file: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > MAX_POLICY_BYTES || text.split('\n').length > MAX_POLICY_LINES) invalid(file, 'document', 'exceeds the bounded policy size.');
  let document: unknown;
  try { document = parseToml(text, { maxDepth: 8, unsafeKeyBehaviour: 'throw' }); }
  catch { invalid(file, 'document', 'must be valid bounded TOML; check syntax and duplicate keys.'); }
  if (!table(document)) invalid(file, 'document', 'must be a policy table.');
  if (document.schema_version !== 1) invalid(file, 'schema_version', 'must specify supported schema_version = 1.');
  return document;
}
function validate<S extends Readonly<Record<string, Fields>>>(text: string, file: string, schema: S, defaults: boolean): unknown {
  const document = decode(text, file);
  const output: Record<string, unknown> = { schema_version: 1 };
  for (const key of Object.keys(document)) {
    if (key !== 'schema_version' && !Object.hasOwn(schema, key)) invalid(file, 'document', 'contains an unsupported setting; remove unknown or credential/identity/connection fields.');
  }
  for (const [section, fields] of Object.entries(schema)) {
    const submitted = document[section];
    if (submitted === undefined && !defaults) continue;
    if (submitted !== undefined && !table(submitted)) invalid(file, section, 'must be a table.');
    const values = (submitted ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(values)) if (!Object.hasOwn(fields, key)) invalid(file, section, 'contains an unsupported setting.');
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) {
      if (!Object.hasOwn(values, key)) { if (defaults) result[key] = structuredClone(field.fallback); continue; }
      const parsed = field.read(values[key]);
      if (parsed === undefined) invalid(file, `${section}.${key}`, 'has an unsupported value, type or bound.');
      result[key] = parsed;
    }
    output[section] = result;
  }
  return deepFreeze(output);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}

export function parseProductPolicy(text: string): ProductPolicySettings {
  return validate(text, OWNER_FILE, ownerSections, true) as ProductPolicySettings;
}
export function parseProjectPreferences(text: string): ProjectPreferences {
  return validate(text, PROJECT_FILE, preferenceSections, false) as ProjectPreferences;
}

/** Resolves one explicit path only. Never walks upward looking for preferences,
 * opens secret files, writes samples, follows symlinks or treats EACCES as absent. */
function readPolicyFile(path: string, anchor: string, file: string): string | null {
  if (!isAbsolute(anchor)) invalid(file, 'document', 'requires an explicit absolute directory.');
  const uid = process.geteuid?.();
  if (uid === undefined) invalid(file, 'document', 'requires filesystem ownership verification on this platform.');
  const ancestors: { path: string; dev: number; ino: number }[] = [];
  let descriptor: number | undefined;
  try {
    const absolute = resolve(anchor);
    let current = parsePath(absolute).root;
    for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, part);
      let entry;
      try { entry = lstatSync(current); }
      catch (error) { if (code(error) === 'ENOENT') return null; throw error; }
      if (!entry.isDirectory() || entry.isSymbolicLink()) invalid(file, 'document', 'requires regular directories without symlinks.');
      if (current === absolute && (entry.uid !== uid || (entry.mode & 0o022) !== 0)) invalid(file, 'document', 'requires an owner-controlled directory without group/other write access.');
      ancestors.push({ path: current, dev: entry.dev, ino: entry.ino });
    }
    let before;
    try { before = lstatSync(path); }
    catch (error) { if (code(error) === 'ENOENT') return null; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || (before.mode & 0o022) !== 0) invalid(file, 'document', 'requires an owner-controlled regular file without symlinks or group/other write access.');
    if (before.size > MAX_POLICY_BYTES) invalid(file, 'document', 'exceeds the bounded policy size.');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) invalid(file, 'document', 'changed during policy loading; retry with a stable file.');
    const buffer = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let used = 0;
    while (used < buffer.length) { const bytes = readSync(descriptor, buffer, used, buffer.length - used, null); if (bytes === 0) break; used += bytes; }
    const after = fstatSync(descriptor), named = lstatSync(path);
    if (used > MAX_POLICY_BYTES || after.size !== used || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || named.dev !== opened.dev || named.ino !== opened.ino
      || ancestors.some(item => { const stat = lstatSync(item.path); return stat.isSymbolicLink() || stat.dev !== item.dev || stat.ino !== item.ino; })) invalid(file, 'document', 'changed during bounded policy loading; retry with a stable file.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)); }
    catch { return invalid(file, 'document', 'must contain valid UTF-8 TOML.'); }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    return invalid(file, 'document', 'could not be read safely; check existence, ownership and permissions.');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function code(error: unknown): unknown { return (error as { code?: unknown } | null)?.code; }

export function loadProductPolicy(home: string, options: { readonly previouslyApproved?: boolean } = {}): LoadedProductPolicy {
  const text = readPolicyFile(installationPaths(home).policyFile, home, OWNER_FILE);
  if (text === null && options.previouslyApproved) invalid(OWNER_FILE, 'document', 'is missing after prior approval; retain the trusted revision and reconcile before activation.');
  return deepFreeze({ state: text === null ? 'restrictive-defaults' : 'configured', activation: 'unactivated',
    settings: parseProductPolicy(text ?? 'schema_version = 1\n') });
}
export function loadProjectPreferences(workspaceRoot: string): LoadedProjectPreferences {
  const path = projectPreferencesPath(workspaceRoot);
  const text = readPolicyFile(path, dirname(path), PROJECT_FILE);
  return deepFreeze({ state: text === null ? 'absent' : 'configured', trust: 'untrusted-preferences',
    settings: text === null ? { schema_version: 1 } : parseProjectPreferences(text) });
}
