import { z } from 'zod';

import { sanitizerResultV3Schema, type SanitizerResultV3 } from './sources.js';
import { byteBoundedText, decimalStringSchema, utf8ByteLength } from './validation.js';

export const SANITIZER_VERSION_V3 = 'threadline-deterministic-1';
export const SANITIZATION_LIMITS_V3 = {
  maxInputBytes: 1024 * 1024, maxOutputBytes: 65536, maxDepth: 8,
  maxEntries: 1024, maxPolicyPaths: 64, maxPathBytes: 4096,
} as const;
export const SANITIZATION_FIELDS_V3 = [
  'id', 'projectId', 'sessionId', 'agent', 'taskId', 'sourceId', 'versionId',
  'kind', 'type', 'title', 'name', 'label', 'text', 'content', 'body', 'statement',
  'description', 'summary', 'objective', 'progress', 'state', 'outcome',
  'observation', 'uncertainty', 'reason', 'conditions', 'steps', 'index',
  'prerequisites', 'parameters', 'value', 'blockers', 'openQuestions', 'nextSteps',
  'metadata', 'records', 'items', 'tags', 'topic', 'ticket', 'feature', 'date',
  'url', 'uri', 'reference', 'references', 'path', 'paths', 'file', 'cwd',
  'args', 'arguments', 'argv', 'code', 'language', 'status', 'count', 'durationMs',
] as const;
export type SanitizationFieldV3 = (typeof SANITIZATION_FIELDS_V3)[number];
export const sanitizationPolicyV3Schema = z.strictObject({
  policyRevision: decimalStringSchema,
  maxInputBytes: z.number().int().min(1).max(SANITIZATION_LIMITS_V3.maxInputBytes).default(262144),
  maxOutputBytes: z.number().int().min(1).max(SANITIZATION_LIMITS_V3.maxOutputBytes).default(65536),
  maxDepth: z.number().int().min(1).max(SANITIZATION_LIMITS_V3.maxDepth).default(6),
  maxEntries: z.number().int().min(1).max(SANITIZATION_LIMITS_V3.maxEntries).default(256),
  allowedFields: z.array(z.enum(SANITIZATION_FIELDS_V3)).max(SANITIZATION_FIELDS_V3.length)
    .default([...SANITIZATION_FIELDS_V3]),
  excludedPaths: z.array(byteBoundedText(1024)).max(SANITIZATION_LIMITS_V3.maxPolicyPaths).default([]),
  sensitiveKeys: z.array(z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/)).max(64).default([]),
});
export type SanitizationPolicyV3 = z.infer<typeof sanitizationPolicyV3Schema>;
export const sanitizationInputV3Schema = z.strictObject({
  format: z.enum(['text', 'json', 'path', 'url']),
  text: z.string().min(1).max(SANITIZATION_LIMITS_V3.maxInputBytes),
  sourcePath: z.string().min(1).max(SANITIZATION_LIMITS_V3.maxPathBytes).optional(),
});
export type SanitizationInputV3 = z.infer<typeof sanitizationInputV3Schema>;

type Refusal = 'sensitive' | 'unsupported' | 'uncertain' | 'scanner_failed' | 'policy_denied';
class Refused extends Error {
  constructor(readonly code: Refusal) { super('Content withheld.'); }
}
const DROP = Symbol('discarded');
const credentialFiles = new Set(['.ssh', '.aws', '.azure', '.kube', '.gnupg', '.git-credentials',
  '.npmrc', '.netrc', '.pypirc', 'keychains', 'credentials', 'credentials.json',
  'credentials.yaml', 'application_default_credentials.json', 'login data', 'cookies',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']);
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const normalizeKey = (key: string): string => key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const privateKeys = new Set(['env', 'environment', 'environmentvariables', 'environ', 'headers',
  'credentials', 'credentialstore', 'analysis', 'reasoning', 'thinking', 'chainofthought']);
const sensitiveKey = (key: string, additional: ReadonlySet<string>): boolean =>
  privateKeys.has(key) || additional.has(key) ||
  /(?:password|passwd|pwd|secret|token|apikey|accesskey|privatekey|authorization|cookie|credential)s?$/.test(key);
const credentialPatterns = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{4,}/i,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|cookie|private[_-]?key)["']?\s*[:=]/i,
  /--(?:password|passwd|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret)(?:[=\s]|$)/i,
  /(?:^|\n)\s*(?:export\s+|set\s+)?[A-Z_][A-Z0-9_]*\s*=/,
  /<(?:analysis|thinking|reasoning)>/i,
];

/** Examine data properties without invoking user getters; no environment/files
 * are read. Proxy/reflection failures are caught by the public fail-closed API. */
function plainData(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Refused('unsupported');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Refused('unsupported');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.has(key))) throw new Refused('unsupported');
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) throw new Refused('unsupported');
    result[key] = descriptor.value;
  }
  return result;
}
function policyStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) throw new Refused('policy_denied');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || length > limit) throw new Refused('policy_denied');
  const output: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string')
      throw new Refused('policy_denied');
    output.push(descriptor.value);
  }
  return output;
}
function decoded(value: string): string {
  let current = value.normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(current)) throw new Refused('uncertain');
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(current); i++) {
    try { current = decodeURIComponent(current); } catch { throw new Refused('uncertain'); }
  }
  current = current.normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (/%[0-9a-f]{2}/i.test(current) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u.test(current)) throw new Refused('uncertain');
  return current;
}
function trimPathEnd(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === '.' || value[end - 1] === ' ')) end--;
  return value.slice(0, end);
}
function trimReferenceDots(value: string): string {
  const pieces: string[] = [];
  let index = 0, retained = 0;
  while (index < value.length) {
    if (value[index] !== '.') { index++; continue; }
    const start = index;
    while (index < value.length && value[index] === '.') index++;
    if (index === value.length || /[\s),;!?\]}\x60]/.test(value[index]!)) {
      pieces.push(value.slice(retained, start));
      retained = index;
    }
  }
  pieces.push(value.slice(retained));
  return pieces.join('');
}
function pathIdentity(value: string): string {
  const normalized = decoded(value).replace(/\\/g, '/').toLowerCase();
  if (/^[a-z]:[^/]/.test(normalized) || normalized.startsWith('//?/') ||
    normalized.startsWith('//./') || normalized.startsWith('/??/')) throw new Refused('uncertain');
  const parts: string[] = [];
  for (const component of normalized.split('/')) {
    const raw = component.trimEnd();
    if (raw === '..') { if (parts.length > 0) parts.pop(); else throw new Refused('uncertain'); continue; }
    // Windows alternate streams select the same base credential file. Keep
    // a drive prefix, but classify every other component before its colon.
    const base = /^[a-z]:$/.test(raw) ? raw : raw.split(':')[0]!;
    const part = trimPathEnd(base);
    if (part !== '' && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
function excludedPath(value: string, configured: readonly string[]): boolean {
  const identity = pathIdentity(value);
  const parts = identity.split('/');
  if (parts.some((part) => credentialFiles.has(part) || /\.env(?:[._-]|$)/.test(part) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(part))) return true;
  if (/\/\.config\/(?:gcloud|gh|rclone)(?:\/|$)/.test(identity)) return true;
  return configured.some((path) => {
    const excluded = pathIdentity(path);
    return excluded === '/' || identity === excluded || identity.startsWith(excluded + '/') ||
      (!/^(?:[\\/]|[A-Za-z]:)/.test(path) && (identity.endsWith(excluded) || identity.includes(excluded + '/')));
  });
}
function secretText(text: string, policy: SanitizationPolicyV3): boolean {
  const scan = decoded(text);
  if (credentialPatterns.some((pattern) => pattern.test(scan)) || /\bhttps?:\/\/[^\s"'<>]*[?#]/i.test(scan)) return true;
  const additional = new Set(policy.sensitiveKeys.map(normalizeKey));
  for (const match of scan.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{0,63})["']?\s*[:=]/g)) {
    if (sensitiveKey(normalizeKey(match[1]!), additional)) return true;
  }
  for (const match of scan.matchAll(/--([A-Za-z][A-Za-z0-9_-]{0,63})(?=[=\s]|$)/g)) {
    if (sensitiveKey(normalizeKey(match[1]!), additional)) return true;
  }
  // Ambiguous short credential/header flags cannot retain their companion.
  if (/(?:^|\s)-(?:p|u|H|b)(?:\S*|\s)/.test(scan)) return true;
  // Path references are content too, even when embedded in a text field.
  if (/\.env(?:[^a-z0-9]|$)|\.ssh(?:[\\/\s]|$)|\.aws(?:[\\/\s]|$)/i.test(scan)) return true;
  const references = trimReferenceDots(scan.replace(/\\/g, '/').toLowerCase());
  let referenceMatches = 0;
  // Text fragments cannot establish a parent directory. Conservatively match
  // configured basenames as complete references, including names with spaces.
  for (const configured of policy.excludedPaths) {
    const identity = pathIdentity(configured);
    if (identity === '/') return true;
    const basename = identity.slice(identity.lastIndexOf('/') + 1);
    let offset = references.indexOf(basename);
    while (offset !== -1) {
      if (++referenceMatches > 256) throw new Refused('policy_denied');
      const before = offset === 0 ? '' : references[offset - 1]!;
      const after = references[offset + basename.length] ?? '';
      if ((before === '' || !/[a-z0-9_.-]/.test(before)) &&
        (after === '' || !/[a-z0-9_.-]/.test(after))) return true;
      offset = references.indexOf(basename, offset + 1);
    }
  }
  let examined = 0;
  for (const match of scan.matchAll(/[^\s"'<>]+/g)) {
    const candidate = match[0].replace(/^[`(\[{]+|[`),;!?\]}]+$/g, '');
    if (candidate.includes('://') && candidate.includes('@')) return true;
    if (!/[\\/.]/.test(candidate) && policy.excludedPaths.length === 0 &&
      !credentialFiles.has(candidate.toLowerCase())) continue;
    if (++examined > 256) throw new Refused('policy_denied');
    if (excludedPath(candidate, policy.excludedPaths)) return true;
  }
  return false;
}
function safeUrl(text: string, policy: SanitizationPolicyV3, changed: { value: boolean }): string {
  let url: URL;
  try { url = new URL(text); } catch { throw new Refused('unsupported'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Refused('unsupported');
  if (excludedPath(url.pathname, policy.excludedPaths) ||
    /\/(?:password|secret|token|credentials?)(?:\/|$)/i.test(decoded(url.pathname))) throw new Refused('sensitive');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') changed.value = true;
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  if (secretText(url.href, policy)) throw new Refused('sensitive');
  return url.href;
}
/** Cheap lexical bounds before JSON.parse; strings/escapes cannot fake depth.
 * Parsing is then bounded by input bytes and a conservative token ceiling. */
function jsonPreflight(text: string, policy: SanitizationPolicyV3): void {
  let depth = 0, quoted = false, escaped = false, work = 0;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { depth++; work++; }
    else if (char === '}' || char === ']') depth--;
    else if (char === ':' || char === ',') work++;
    if (depth < 0 || depth > policy.maxDepth || work > policy.maxEntries * 3) throw new Refused('unsupported');
  }
  if (depth !== 0 || quoted) throw new Refused('unsupported');
}

/** Pure deterministic filtering of explicitly selected, bounded content. JSON
 * arrives as text so bytes/depth are checked before parsing/traversal. Policies
 * must come from the owner's trusted configuration; parsing is not permission.
 * No raw content, secret digests, paths or exception messages are emitted on
 * refusal. The adapter and backend must both call this implementation before
 * hashing/persistence. Arbitrary unknown secrets cannot be proven absent. */
export function sanitizeContentV3(input: unknown, policyInput: unknown): SanitizerResultV3 {
  let revision = '0';
  const reject = (reason: Refusal): SanitizerResultV3 => ({
    status: 'rejected', policyRevision: revision, scannerVersion: SANITIZER_VERSION_V3,
    reason, rawRetained: false,
  });
  try {
    const rawPolicy = plainData(policyInput, new Set(['policyRevision', 'maxInputBytes', 'maxOutputBytes',
      'maxDepth', 'maxEntries', 'allowedFields', 'excludedPaths', 'sensitiveKeys']));
    for (const [field, limit] of [['allowedFields', SANITIZATION_FIELDS_V3.length],
      ['excludedPaths', SANITIZATION_LIMITS_V3.maxPolicyPaths], ['sensitiveKeys', 64]] as const) {
      if (rawPolicy[field] !== undefined) rawPolicy[field] = policyStrings(rawPolicy[field], limit);
    }
    const parsedPolicy = sanitizationPolicyV3Schema.safeParse(rawPolicy);
    if (!parsedPolicy.success) return reject('policy_denied');
    const policy = parsedPolicy.data;
    revision = policy.policyRevision;
    // Validate configured lexical exclusions even if this input contains no path.
    for (const path of policy.excludedPaths) pathIdentity(path);
    const parsed = sanitizationInputV3Schema.safeParse(plainData(input, new Set(['format', 'text', 'sourcePath'])));
    if (!parsed.success) return reject('unsupported');
    const data = parsed.data;
    if (utf8ByteLength(data.text) > policy.maxInputBytes) return reject('policy_denied');
    if (data.sourcePath !== undefined && (utf8ByteLength(data.sourcePath) > SANITIZATION_LIMITS_V3.maxPathBytes ||
      excludedPath(data.sourcePath, policy.excludedPaths) || secretText(data.sourcePath, policy))) return reject('sensitive');
    const changed = { value: false };
    const additional = new Set(policy.sensitiveKeys.map(normalizeKey));
    const allowed = new Set(policy.allowedFields.map(normalizeKey));
    let entries = 0;
    const visit = (value: unknown, depth: number, field: string): Json | typeof DROP => {
      if (++entries > policy.maxEntries || depth > policy.maxDepth) throw new Refused('unsupported');
      if (typeof value === 'string') {
        if (['path', 'paths', 'file', 'cwd'].includes(field)) return excludedPath(value, policy.excludedPaths) || secretText(value, policy) ? DROP : value;
        if (['url', 'uri', 'reference', 'references'].includes(field) || /^https?:\/\//i.test(value)) return safeUrl(value, policy, changed);
        return secretText(value, policy) ? DROP : value;
      }
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Refused('unsupported');
        return value;
      }
      if (Array.isArray(value)) {
        const output: Json[] = [];
        for (const item of value) {
          if (typeof item === 'string' && sensitiveKey(normalizeKey(decoded(item)), additional)) return DROP;
          const safe = visit(item, depth + 1, field);
          // Never retain the companion value of a removed command argument.
          if (safe === DROP) return DROP;
          output.push(safe);
        }
        return output;
      }
      if (typeof value !== 'object') throw new Refused('unsupported');
      // A named parameter is one semantic unit: dropping only its selector
      // would leave an unlabelled secret value. Arrays propagate this discard.
      for (const [selector, selected] of Object.entries(value)) {
        if (['name', 'key', 'field', 'label'].includes(normalizeKey(decoded(selector)))) {
          if (typeof selected !== 'string') throw new Refused('unsupported');
          if (sensitiveKey(normalizeKey(decoded(selected)), additional) || secretText(selected, policy)) {
            changed.value = true;
            return DROP;
          }
        }
      }
      const output: { [key: string]: Json } = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        const normalized = normalizeKey(decoded(key));
        if (sensitiveKey(normalized, additional)) { changed.value = true; continue; }
        if (!allowed.has(normalized)) throw new Refused('unsupported');
        const safe = visit(child, depth + 1, normalized);
        if (safe === DROP) changed.value = true;
        else output[key] = safe;
      }
      return output;
    };
    let output: string;
    switch (data.format) {
      case 'text':
        if (secretText(data.text, policy)) return reject('sensitive');
        output = data.text; break;
      case 'path':
        if (excludedPath(data.text, policy.excludedPaths) || secretText(data.text, policy)) return reject('sensitive');
        output = data.text; break;
      case 'url': output = safeUrl(data.text, policy, changed); break;
      case 'json': {
        jsonPreflight(data.text, policy);
        let value: unknown;
        try { value = JSON.parse(data.text); } catch { return reject('unsupported'); }
        const safe = visit(value, 1, '');
        if (safe === DROP) return reject('sensitive');
        output = JSON.stringify(safe); break;
      }
    }
    if (utf8ByteLength(output) > policy.maxOutputBytes || output.length === 0) return reject('policy_denied');
    return sanitizerResultV3Schema.parse({
      status: changed.value ? 'reduced' : 'safe', policyRevision: revision,
      scannerVersion: SANITIZER_VERSION_V3, payload: { text: output, mediaType: 'text/plain' },
      ...(changed.value ? { reason: 'sensitive_fields_removed' } : {}),
    });
  } catch (error) {
    return reject(error instanceof Refused ? error.code : 'scanner_failed');
  }
}
