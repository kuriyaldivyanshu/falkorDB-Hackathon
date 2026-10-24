import { z } from 'zod';

import {
  applicabilitySchema,
  memoryAuthoringV3Schema,
  memoryContentV3Schema,
  memoryRecordV3Schema,
  memoryMetadataInputV3Schema,
  memoryMetadataV3Schema,
  memoryAssociationInputV3Schema,
  memoryAssociationV3Schema,
  observedUnderSchema,
} from './memory.js';
import { sanitizerResultV3Schema, type SanitizerResultV3 } from './sources.js';
import { byteBoundedText, decimalStringSchema, utf8ByteLength } from './validation.js';

export const SANITIZER_VERSION_V3 = 'threadline-deterministic-2';
export const SANITIZATION_LIMITS_V3 = {
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 65536,
  maxDepth: 8,
  maxEntries: 1024,
  maxPolicyPaths: 64,
  maxPathBytes: 4096,
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
  'subtype', 'action', 'evidencePrecision', 'goal', 'procedureState', 'reviewRef',
  'supportedBy', 'openWork', 'unresolved', 'fromSessionId', 'toSessionId',
  'taskRevision', 'observedUnder', 'taskFamily', 'contractVersion', 'runtime',
  'tool', 'applicability', 'predicates', 'key', 'operator', 'values',
  'associations', 'field', 'provenance', 'confirmed', 'assertedByPrincipalId',
  'sourceVersionId', 'dateProvenance', 'protocolVersion', 'memoryId',
  'acceptance', 'acceptedAt', 'authority', 'basis', 'principalId',
  'ownerPrincipalId', 'ruleId', 'fence', 'policyRevision', 'privacyRevision',
  'privacyGeneration', 'graphEpoch',
  'supersededByVersionId', 'markers', 'pinned', 'stale', 'flaggedAt',
  'sourceVersionIds', 'conflictIds', 'createdAt', 'requestId',
  'progressVersionIds', 'outcomes', 'precision', 'limitations',
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
/** Profiles select existing contracts; they never grant capture authority.
 * Only observed-under parameters admit dynamic string keys. */
export const SANITIZATION_PROFILES_V3 = [
  'memory', 'observed_under', 'applicability', 'associations', 'metadata',
] as const;
const profileSchemas = {
  memory: z.union([memoryAuthoringV3Schema, memoryContentV3Schema, memoryRecordV3Schema]),
  observed_under: observedUnderSchema.strict(),
  applicability: applicabilitySchema.strict(),
  associations: z.array(z.union([memoryAssociationInputV3Schema, memoryAssociationV3Schema])).max(32),
  metadata: z.union([memoryMetadataInputV3Schema, memoryMetadataV3Schema]),
};
export const sanitizationInputV3Schema = z.strictObject({
  format: z.enum(['text', 'json', 'path', 'url']),
  profile: z.enum(SANITIZATION_PROFILES_V3).optional(),
  text: z.string().min(1).max(SANITIZATION_LIMITS_V3.maxInputBytes),
  sourcePath: z.string().min(1).max(SANITIZATION_LIMITS_V3.maxPathBytes).optional(),
});
export type SanitizationInputV3 = z.infer<typeof sanitizationInputV3Schema>;

type Refusal = 'sensitive' | 'unsupported' | 'uncertain' | 'scanner_failed' | 'policy_denied';
class Refused extends Error {
  constructor(readonly code: Refusal) {
    super('Content withheld.');
  }
}
const DROP = Symbol('discarded');
const escapedEntities: Readonly<Record<string, string>> = {
  quot: '"',
  apos: "'",
  colon: ':',
  equals: '=',
  sol: '/',
  bsol: '\\',
  amp: '&',
};
const credentialFiles = new Set([
  '.ssh', '.aws', '.azure', '.kube', '.gnupg', '.git-credentials',
  '.npmrc', '.netrc', '.pypirc', 'keychains', 'credentials', 'credentials.json',
  'credentials.yaml', 'application_default_credentials.json', 'login data', 'cookies',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.pgpass', 'pgpass.conf',
  '.pg_service.conf', '.my.cnf', '.mylogin.cnf', '.vault-token', '.vault',
  '.terraform.d', 'terraform.tfstate', 'terraform.tfstate.backup',
  'credentials.tfrc.json', '.terraformrc', '.1password', '1password',
  '1password.sqlite', '.op', 'opvault', 'agilekeychain',
]);
type Exclusion = { identity: string; relative: boolean };
type ScannerPolicy = SanitizationPolicyV3 & {
  sensitive: ReadonlySet<string>;
  exclusions: readonly Exclusion[];
  referenceNames: readonly string[];
};
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const normalizeKey = (key: string): string => key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const privateKeys = new Set([
  'env', 'environment', 'environmentvariables', 'environ', 'headers',
  'credentials', 'credentialstore', 'analysis', 'reasoning', 'thinking', 'chainofthought',
]);
/** Deliberately conservative across camel case, separators and ID/value suffixes.
 * NFKC is not a Unicode-confusable/homoglyph detector. */
function sensitiveKey(key: string, additional: ReadonlySet<string>): boolean {
  const segmented = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  const normalized = normalizeKey(key);
  return segmented.some((part) => ['pass', 'pwd', 'pin', 'auth', 'auths'].includes(part)) ||
    segmented.some((part) => /^(?:pass|pwd|pin|auth)(?:key|id|value|code|header|s)+$/.test(part)) ||
    /(?:pass|pwd|pin|auth)(?:key|id|value|code|header|s)+$|auth$/.test(normalized) ||
    privateKeys.has(normalized) || additional.has(normalized) ||
    /password|passwd|passphrase|secret|token|apikey|accesskey|privatekey|authorization|cookie|credential/.test(normalized) ||
    /^(?:pass|pwd|pin|auth)(?:key|id|value|code|s)*$/.test(normalized) ||
    /^(?:client|user|db|database|service|http|proxy)(?:pass|pwd|pin|auth)(?:key|id|value|code|s)*$/.test(normalized);
}
const credentialPatterns = [
  /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12}|gh[pousr]_[A-Za-z0-9]{16}|github_pat_[A-Za-z0-9_]{20}|(?:AKIA|ASIA)[A-Z0-9]{16})/,
  /\b(?:hvs|hvb|hvr)\.[A-Za-z0-9_-]{12}/,
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
/** Fixed decoding rounds are scan-only; the original bytes are never rewritten
 * into output. Residual recognized encodings are refused instead of guessed. */
function decoded(value: string): string {
  let current = value;
  for (let round = 0; round < 4; round++) {
    let next = current.normalize('NFKC').replace(/\p{Cf}/gu, '');
    next = next.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_match, unicode: string | undefined, hex: string | undefined) =>
        String.fromCharCode(Number.parseInt(unicode ?? hex!, 16)));
    next = next.replace(/\\([\\"':=/_ -])/g, '$1');
    next = next.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));|&(quot|apos|colon|equals|sol|bsol|amp);/gi,
      (_match, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
        if (named !== undefined) return escapedEntities[named.toLowerCase()]!;
        const code = Number.parseInt(hex ?? decimal!, hex === undefined ? 10 : 16);
        if (code > 0x10ffff) throw new Refused('uncertain');
        return String.fromCodePoint(code);
      });
    if (/%[0-9a-f]{2}/i.test(next)) {
      try {
        next = decodeURIComponent(next);
      } catch {
        throw new Refused('uncertain');
      }
    }
    if (next === current) break;
    current = next;
  }
  if (/%[0-9a-f]{2}|\\[ux]|&#|&(?:quot|apos|colon|equals|sol|bsol|amp);/i.test(current) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u.test(current)) throw new Refused('uncertain');
  return current;
}
function trimPathEnd(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === '.' || value[end - 1] === ' ')) end--;
  return value.slice(0, end);
}
function pathIdentity(value: string): string {
  const lexical = value.replace(/\\/g, '/').toLowerCase();
  if (lexical.startsWith('//?/') || lexical.startsWith('//./')) throw new Refused('uncertain');
  const normalized = decoded(value).replace(/\\/g, '/').toLowerCase();
  if (/^[a-z]:[^/]/.test(normalized) || normalized.startsWith('//?/') ||
    normalized.startsWith('//./') || normalized.startsWith('/??/')) throw new Refused('uncertain');
  const parts: string[] = [];
  for (const component of normalized.split('/')) {
    const raw = component.trimEnd();
    if (raw === '..') {
      if (parts.length > 0) parts.pop();
      else throw new Refused('uncertain');
      continue;
    }
    // Windows alternate streams select the same base credential file. Keep
    // a drive prefix, but classify every other component before its colon.
    const base = /^[a-z]:$/.test(raw) ? raw : raw.split(':')[0]!;
    const part = trimPathEnd(base);
    if (part !== '' && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
function excludedPath(value: string, configured: readonly Exclusion[]): boolean {
  const identity = pathIdentity(value);
  const parts = identity.split('/');
  if (parts.some((part) => credentialFiles.has(part) || /\.env(?:[._-]|$)/.test(part) ||
    /\.(?:pem|key|p12|pfx|keystore)$/.test(part))) return true;
  if (/\/\.config\/(?:gcloud|gh|rclone|op|1password)(?:\/|$)/.test(identity) ||
    /\/\.docker\/(?:config\.json|contexts)(?:\/|$)/.test(identity) ||
    /\/(?:postgresql|mysql)\/(?:pgpass\.conf|my\.ini)(?:\/|$)/.test(identity) ||
    /\/(?:1password|op)\/(?:config|data)(?:\/|$)/.test(identity)) return true;
  return configured.some(({ identity: excluded, relative }) => {
    return excluded === '/' || identity === excluded || identity.startsWith(excluded + '/') ||
      (relative && (identity.endsWith(excluded) || identity.includes(excluded + '/')));
  });
}
/** JWT segment checks touch each segment at most three times. The fixed-size
 * prefix detectors above never greedily scan a suffix at every candidate. */
function jwtToken(token: string): boolean {
  const parts = token.split('.');
  for (let index = 0; index + 2 < parts.length; index++) {
    const first = parts[index]!;
    let start = first.length;
    while (start > 0 && /[A-Za-z0-9_-]/.test(first[start - 1]!)) start--;
    const header = first.slice(start);
    if (!header.startsWith('eyJ') || header.length < 11) continue;
    const payload = parts[index + 1]!;
    const signature = parts[index + 2]!;
    if (payload.length >= 8 && /^[A-Za-z0-9_-]+$/.test(payload) &&
      /^[A-Za-z0-9_-]{8}/.test(signature)) return true;
  }
  return false;
}
function referenceToken(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && /[`(\[{]/.test(token[start]!)) start++;
  while (end > start && /[`),;!?\]}]/.test(token[end - 1]!)) end--;
  return token.slice(start, end);
}
/** Assignment gaps contain only delimiters, so gaps examined after identifier
 * runs are disjoint. Quoted spans are also disjoint and use the same classifier.
 * Closing selectors are accepted conservatively without evaluating expressions. */
function assignmentSeparator(scan: string, end: number, closingQuotes: boolean): string | undefined {
  while (end < scan.length) {
    const char = scan[end]!;
    if (/\s/.test(char) || char === ']' || char === ')' ||
      (closingQuotes && (char === '"' || char === "'"))) end++;
    else break;
  }
  return scan[end] === ':' || scan[end] === '=' ? scan[end] : undefined;
}
function secretAssignment(scan: string, additional: ReadonlySet<string>): boolean {
  for (const match of scan.matchAll(/[A-Za-z0-9_.\\/-]+/g)) {
    const word = match[0];
    if (/^-(?:p|u|H|b)/.test(word)) return true;
    const sensitive = sensitiveKey(word, additional);
    if (word.startsWith('--') && sensitive) return true;
    const uppercase = /^[A-Z_][A-Z0-9_]*$/.test(word);
    if (!sensitive && !uppercase) continue;
    const separator = assignmentSeparator(scan, match.index + word.length, true);
    if (separator !== undefined && (sensitive || (uppercase && separator === '='))) return true;
  }
  for (const quote of ['"', "'"]) {
    let start = scan.indexOf(quote);
    while (start !== -1) {
      const end = scan.indexOf(quote, start + 1);
      if (end === -1) break;
      const key = scan.slice(start + 1, end);
      if (sensitiveKey(key, additional) && assignmentSeparator(scan, end + 1, false) !== undefined) return true;
      // Adjacent spans share only the delimiter, so prose apostrophes cannot
      // hide a later quoted selector and each character is classified once.
      start = end;
    }
  }
  return false;
}
/** Withhold a known authentication label with a following span, rather than
 * guessing whether punctuation/encoding wraps a credential. Immediate lexical
 * path continuations do not constitute separated authentication syntax. */
function authenticationSpan(scan: string): boolean {
  for (const match of scan.matchAll(/(?:^|[^A-Za-z0-9])(?:Bearer|Basic)(?=$|[^A-Za-z0-9])/gi)) {
    const end = match.index + match[0].length;
    const after = scan[end];
    if (after === undefined) continue;
    const before = match[0][0]!;
    if (after === '/' || after === '\\' ||
      (after === '.' && (before === '/' || before === '\\'))) continue;
    return true;
  }
  return false;
}
/** Each pass consumes disjoint spans/tokens. No regex restarts a variable
 * suffix search at every whitespace, newline, quote or URI prefix. */
function secretText(text: string, policy: ScannerPolicy): boolean {
  const scan = decoded(text);
  if (/<(?:analysis|thinking|reasoning)>/i.test(scan)) return true;
  if (secretAssignment(scan, policy.sensitive) || authenticationSpan(scan)) return true;
  const references = scan.replace(/\\/g, '/').toLowerCase();
  // Fixed-size store list and policy list (<=64); indexOf advances past matches.
  if (policy.exclusions.some(({ identity }) => identity === '/')) return true;
  for (const name of policy.referenceNames) {
    let offset = references.indexOf(name);
    while (offset !== -1) {
      const before = references[offset - 1] ?? '';
      const after = references[offset + name.length] ?? '';
      if (!/[a-z0-9_.-]/.test(before) && !/[a-z0-9_-]/.test(after)) return true;
      offset = references.indexOf(name, offset + name.length);
    }
  }
  for (const match of scan.matchAll(/[^\s"'<>]+/g)) {
    const token = match[0];
    const candidate = referenceToken(token);
    if (credentialPatterns.some((pattern) => pattern.test(token)) || jwtToken(candidate)) return true;
    if (candidate.includes('://') && /[@?#]/.test(candidate)) return true;
    if (/[\\/.]/.test(candidate) && excludedPath(candidate, policy.exclusions)) return true;
  }
  // PEM headers contain spaces and are bounded independently of token length.
  return /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----/i.test(scan);
}
function safeUrl(text: string, policy: ScannerPolicy, changed: { value: boolean }): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Refused('unsupported');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Refused('unsupported');
  if (excludedPath(url.pathname, policy.exclusions) ||
    /\/(?:password|secret|token|credentials?)(?:\/|$)/i.test(decoded(url.pathname))) throw new Refused('sensitive');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') changed.value = true;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (secretText(url.href, policy)) throw new Refused('sensitive');
  return url.href;
}
/** Cheap lexical bounds before JSON.parse; strings/escapes cannot fake depth.
 * Parsing is then bounded by input bytes and a conservative token ceiling. */
function jsonPreflight(text: string, policy: SanitizationPolicyV3): void {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let work = 0;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      depth++;
      work++;
    } else if (char === '}' || char === ']') depth--;
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
 * hashing/persistence. Profile validation precedes reduction; consumers must
 * validate reduced JSON again before using it as a typed contract. Oversized
 * output is refused, never truncated. Known authentication labels with following
 * separated or uncertain spans are withheld, without interpreting wrappers.
 * Short credential/header flags and inline
 * query-bearing URLs are conservatively withheld; URL format strips authority
 * credentials, query and fragment. Arbitrary secrets and Unicode homoglyphs
 * cannot be proven absent. */
export function sanitizeContentV3(input: unknown, policyInput: unknown): SanitizerResultV3 {
  let revision = '0';
  const reject = (reason: Refusal): SanitizerResultV3 => ({
    status: 'rejected',
    policyRevision: revision,
    scannerVersion: SANITIZER_VERSION_V3,
    reason,
    rawRetained: false,
  });
  try {
    // Obtain only an own data revision before validating the rest of the policy.
    // This is an audit label, never evidence that the policy was authorized.
    if (policyInput !== null && typeof policyInput === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(policyInput, 'policyRevision');
      if (descriptor !== undefined && 'value' in descriptor &&
        typeof descriptor.value === 'string' && decimalStringSchema.safeParse(descriptor.value).success) {
        revision = descriptor.value;
      }
    }
    const rawPolicy = plainData(policyInput, new Set(['policyRevision', 'maxInputBytes', 'maxOutputBytes',
      'maxDepth', 'maxEntries', 'allowedFields', 'excludedPaths', 'sensitiveKeys']));
    for (const [field, limit] of [['allowedFields', SANITIZATION_FIELDS_V3.length],
      ['excludedPaths', SANITIZATION_LIMITS_V3.maxPolicyPaths], ['sensitiveKeys', 64]] as const) {
      if (rawPolicy[field] !== undefined) rawPolicy[field] = policyStrings(rawPolicy[field], limit);
    }
    const parsedPolicy = sanitizationPolicyV3Schema.safeParse(rawPolicy);
    if (!parsedPolicy.success) return reject('policy_denied');
    // Normalize bounded policy paths once, rather than once per content token.
    const exclusions = parsedPolicy.data.excludedPaths.map((path) => ({
      identity: pathIdentity(path),
      relative: !/^(?:[\\/]|[A-Za-z]:)/.test(path),
    }));
    const policy: ScannerPolicy = {
      ...parsedPolicy.data,
      sensitive: new Set(parsedPolicy.data.sensitiveKeys.map(normalizeKey)),
      exclusions,
      referenceNames: [...credentialFiles, ...exclusions.map(({ identity }) =>
        identity.slice(identity.lastIndexOf('/') + 1))],
    };
    revision = policy.policyRevision;
    const parsed = sanitizationInputV3Schema.safeParse(plainData(input, new Set(['format', 'text', 'sourcePath', 'profile'])));
    if (!parsed.success) return reject('unsupported');
    const data = parsed.data;
    if (data.profile !== undefined && data.format !== 'json') return reject('unsupported');
    if (utf8ByteLength(data.text) > policy.maxInputBytes) return reject('policy_denied');
    if (data.sourcePath !== undefined && (utf8ByteLength(data.sourcePath) > SANITIZATION_LIMITS_V3.maxPathBytes ||
      excludedPath(data.sourcePath, policy.exclusions) || secretText(data.sourcePath, policy))) return reject('sensitive');
    const changed = { value: false };
    const additional = policy.sensitive;
    const allowed = new Set(policy.allowedFields.map(normalizeKey));
    let entries = 0;
    const visit = (value: unknown, depth: number, field: string, location: string): Json | typeof DROP => {
      if (++entries > policy.maxEntries || depth > policy.maxDepth) throw new Refused('unsupported');
      if (typeof value === 'string') {
        if (['path', 'paths', 'file', 'cwd'].includes(field)) return excludedPath(value, policy.exclusions) || secretText(value, policy) ? DROP : value;
        if (['url', 'uri', 'reference', 'references', 'reviewref'].includes(field) || /^https?:\/\//i.test(value)) {
          try {
            if (/^https?:\/\//i.test(value)) return safeUrl(value, policy, changed);
            if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith('//')) return DROP;
            return secretText(value, policy) || excludedPath(value, policy.exclusions) ? DROP : value;
          } catch (error) {
            if (error instanceof Refused) return DROP;
            throw error;
          }
        }
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
          if (typeof item === 'string' && sensitiveKey(decoded(item), additional)) return DROP;
          const safe = visit(item, depth + 1, field, location);
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
          if (sensitiveKey(decoded(selected), additional) || secretText(selected, policy)) {
            changed.value = true;
            return DROP;
          }
        }
      }
      const dynamicParameters = data.profile === 'observed_under' && location === 'parameters';
      if (dynamicParameters && Object.keys(value).length > 64) throw new Refused('unsupported');
      const output: { [key: string]: Json } = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        const normalized = normalizeKey(decoded(key));
        if (sensitiveKey(decoded(key), additional)) {
          changed.value = true;
          continue;
        }
        if (dynamicParameters) {
          if (utf8ByteLength(key) > 128 || typeof child !== 'string' || utf8ByteLength(child) > 512) throw new Refused('unsupported');
          if (secretText(key, policy)) {
            changed.value = true;
            continue;
          }
        } else if (!allowed.has(normalized)) throw new Refused('unsupported');
        const childLocation = location === '' ? normalized : location + '.' + normalized;
        const safe = visit(child, depth + 1, normalized, childLocation);
        if (safe === DROP) changed.value = true;
        else output[key] = safe;
      }
      return output;
    };
    let output: string;
    switch (data.format) {
      case 'text':
        if (secretText(data.text, policy)) return reject('sensitive');
        output = data.text;
        break;
      case 'path':
        if (excludedPath(data.text, policy.exclusions) || secretText(data.text, policy)) return reject('sensitive');
        output = data.text;
        break;
      case 'url':
        output = safeUrl(data.text, policy, changed);
        break;
      case 'json': {
        jsonPreflight(data.text, policy);
        let value: unknown;
        try {
          value = JSON.parse(data.text);
        } catch {
          return reject('unsupported');
        }
        if (data.profile !== undefined && !profileSchemas[data.profile].safeParse(value).success) return reject('unsupported');
        const safe = visit(value, 1, '', '');
        if (safe === DROP) return reject('sensitive');
        output = JSON.stringify(safe);
        break;
      }
    }
    if (utf8ByteLength(output) > policy.maxOutputBytes || output.length === 0) return reject('policy_denied');
    return sanitizerResultV3Schema.parse({
      status: changed.value ? 'reduced' : 'safe',
      policyRevision: revision,
      scannerVersion: SANITIZER_VERSION_V3,
      payload: {
        text: output,
        mediaType: 'text/plain',
      },
      ...(changed.value ? { reason: 'sensitive_fields_removed' } : {}),
    });
  } catch (error) {
    return reject(error instanceof Refused ? error.code : 'scanner_failed');
  }
}
