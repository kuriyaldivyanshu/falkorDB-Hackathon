import { sanitizeContentV3, SANITIZER_VERSION_V3, isSensitiveContentKeyV3, memoryDocumentSchema, ThreadlineError } from '@threadline/shared';

import type { TxClient } from './storage/pg.js';

export const ADMISSION_POLICY_REVISION = '0';
export const ADMISSION_SCANNER_VERSION = SANITIZER_VERSION_V3;
export const ADMISSION_LIMITS = Object.freeze({ textBytes: 65536, memoryDocumentBytes: 128 * 1024,
  envelopeBytes: 1_048_576, entries: 4096 });
export const MEMORY_DOCUMENT_MAX_BYTES = ADMISSION_LIMITS.memoryDocumentBytes;

function refuse(): never {
  throw new ThreadlineError('invalid_request', 'Input could not pass the bounded content admission policy.', { field: 'content' });
}

/** The deterministic scanner is shared with the server and pre-transport
 * adapter. Reductions are refused: authored meaning and retry identity never
 * silently change. Credentials belong to authentication, outside this input. */
export function assertSafeText(text: string): void {
  if (!text.length) return;
  if (Buffer.byteLength(text) > ADMISSION_LIMITS.textBytes) {
    throw new ThreadlineError('invalid_request', 'Text exceeds the current 65536-byte admission limit.', { field: 'content', limit: ADMISSION_LIMITS.textBytes });
  }
  if (text.includes('\0')) refuse();
  const result = sanitizeContentV3({ format: 'text', text }, {
    policyRevision: ADMISSION_POLICY_REVISION, maxInputBytes: ADMISSION_LIMITS.textBytes, maxOutputBytes: ADMISSION_LIMITS.textBytes,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeJson(value: unknown, profile?: 'observed_under' | 'applicability'): void {
  const text = JSON.stringify(value);
  const result = sanitizeContentV3({ format: 'json', text, ...(profile ? { profile } : {}) }, {
    policyRevision: ADMISSION_POLICY_REVISION, maxInputBytes: ADMISSION_LIMITS.textBytes, maxOutputBytes: ADMISSION_LIMITS.textBytes, maxDepth: 8, maxEntries: 1024,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeAdmissionInput(input: unknown): void {
  let entries = 0, bytes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++entries > ADMISSION_LIMITS.entries || depth > 12) refuse();
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > ADMISSION_LIMITS.envelopeBytes || value.includes('\0')) refuse();
      assertSafeText(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(entry === undefined ? null : entry, depth + 1);
    } else if (value !== null && typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) refuse();
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue; // JSON object properties are omitted.
        if (isSensitiveContentKeyV3(key)) refuse();
        bytes += Buffer.byteLength(key);
        if (bytes > ADMISSION_LIMITS.envelopeBytes) refuse();
        // Profile validation also inspects dynamic parameter names; leaf-only
        // scanning would miss credentials hidden under an innocuous value.
        if (key === 'content') assertSafeJson(entry);
        if (key === 'observedUnder') assertSafeJson(entry, 'observed_under');
        if (key === 'applicability') assertSafeJson(entry, 'applicability');
        if (key === 'bytesBase64') {
          if (typeof entry !== 'string' || entry.length > Math.ceil(ADMISSION_LIMITS.envelopeBytes / 3) * 4
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry)) refuse();
          let text: string;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(entry, 'base64')); }
          catch { refuse(); }
          visit(text, depth + 1);
        } else {
          assertSafeText(key);
          visit(entry, depth + 1);
        }
      }
    } else if (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) refuse();
  };
  visit(input, 0);
}


/** The larger limit belongs only to the existing structured memory document.
 * Validate its original object, including keys, without flattening independently
 * bounded fields into one scanner text item. Ordinary source text stays64KiB. */
export function assertSafePublication(text: string, kind: 'text' | 'memory_document'): void {
  if (kind === 'text') return assertSafeText(text);
  if (Buffer.byteLength(text) > MEMORY_DOCUMENT_MAX_BYTES) refuse();
  let document: unknown;
  try { document = JSON.parse(text); } catch { refuse(); }
  if (!memoryDocumentSchema.strict().safeParse(document).success) refuse();
  assertSafeAdmissionInput(document);
}

/** One predicate and parameter order for execution, release and qualification.
 * There is no project.initialize producer; unsupported future kinds gain no
 * tenant-level attestation exception. */
export const CURRENT_OPERATION_ADMISSION_SQL = `a.tenant_id=o.tenant_id AND a.id=o.admission_id
  AND a.project_id=o.project_id AND a.principal_id=o.actor_principal_id AND a.token_id=o.actor_token_id
  AND a.state='accepted' AND a.policy_revision=$4 AND a.sanitizer_version=$5`;
export const CURRENT_ADMISSION_PARAMETERS = [ADMISSION_POLICY_REVISION, ADMISSION_SCANNER_VERSION] as const;

export async function hasOperationAdmission(tx: TxClient, tenantId: string, projectId: string, operationId: string): Promise<boolean> {
  const rows = await tx.rows(`SELECT o.id FROM threadline_memory.operations o
    JOIN threadline_memory.ingress_admissions a ON ${CURRENT_OPERATION_ADMISSION_SQL}
    WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.id=$3`,
    [tenantId, projectId, operationId, ...CURRENT_ADMISSION_PARAMETERS]);
  return rows.length === 1;
}
