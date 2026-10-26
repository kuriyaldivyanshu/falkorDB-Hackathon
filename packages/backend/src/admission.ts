import { sanitizeContentV3, SANITIZER_VERSION_V3, isSensitiveContentKeyV3, memoryDocumentSchema, ThreadlineError } from '@threadline/shared';

import type { TxClient } from './storage/pg.js';

export const ADMISSION_POLICY_REVISION = '0';
export const ADMISSION_SCANNER_VERSION = SANITIZER_VERSION_V3;
export const ADMISSION_LIMITS = Object.freeze({ textBytes: 65536, memoryDocumentBytes: 128 * 1024,
  envelopeBytes: 1_048_576, entries: 4096 });
export const MEMORY_DOCUMENT_MAX_BYTES = ADMISSION_LIMITS.memoryDocumentBytes;

export interface AdmissionScannerPolicy { readonly revision: string; readonly excludedPaths: readonly string[] }

function refuse(): never {
  throw new ThreadlineError('invalid_request', 'Input could not pass the bounded content admission policy.', { field: 'content' });
}

/** The deterministic scanner is shared with the server and pre-transport
 * adapter. Reductions are refused: authored meaning and retry identity never
 * silently change. Credentials belong to authentication, outside this input. */
export function assertSafeText(text: string, policy?: AdmissionScannerPolicy): void {
  if (!text.length) return;
  if (Buffer.byteLength(text) > ADMISSION_LIMITS.textBytes) {
    throw new ThreadlineError('invalid_request', 'Text exceeds the current 65536-byte admission limit.', { field: 'content', limit: ADMISSION_LIMITS.textBytes });
  }
  if (text.includes('\0')) refuse();
  const result = sanitizeContentV3({ format: 'text', text }, {
    policyRevision: policy?.revision ?? ADMISSION_POLICY_REVISION, ...(policy ? {excludedPaths:[...policy.excludedPaths]} : {}), maxInputBytes: ADMISSION_LIMITS.textBytes, maxOutputBytes: ADMISSION_LIMITS.textBytes,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeJson(value: unknown, profile?: 'observed_under' | 'applicability', policy?: AdmissionScannerPolicy): void {
  const text = JSON.stringify(value);
  const result = sanitizeContentV3({ format: 'json', text, ...(profile ? { profile } : {}) }, {
    policyRevision: policy?.revision ?? ADMISSION_POLICY_REVISION, ...(policy ? {excludedPaths:[...policy.excludedPaths]} : {}), maxInputBytes: ADMISSION_LIMITS.textBytes, maxOutputBytes: ADMISSION_LIMITS.textBytes, maxDepth: 8, maxEntries: 1024,
  });
  if (result.status !== 'safe' || result.payload.text !== text) refuse();
}

export function assertSafeAdmissionInput(input: unknown, policy?: AdmissionScannerPolicy): void {
  let entries = 0, bytes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++entries > ADMISSION_LIMITS.entries || depth > 12) refuse();
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > ADMISSION_LIMITS.envelopeBytes || value.includes('\0')) refuse();
      assertSafeText(value, policy);
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
        if (key === 'content') assertSafeJson(entry, undefined, policy);
        if (key === 'observedUnder') assertSafeJson(entry, 'observed_under', policy);
        if (key === 'applicability') assertSafeJson(entry, 'applicability', policy);
        if (key === 'bytesBase64') {
          if (typeof entry !== 'string' || entry.length > Math.ceil(ADMISSION_LIMITS.envelopeBytes / 3) * 4
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry)) refuse();
          let text: string;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(entry, 'base64')); }
          catch { refuse(); }
          visit(text, depth + 1);
        } else {
          assertSafeText(key, policy);
          visit(entry, depth + 1);
        }
      }
    } else if (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) refuse();
  };
  visit(input, 0);
}

/** One logical-payload ceiling for admission and current-policy release. IDs,
 * counters and the structured document envelope keep their existing contracts. */
export function assertPolicyInputLimits(input: unknown, limits: {maxPayloadBytes:number;maxBatchRecords:number}): void {
  const value = input as Record<string,unknown>;
  const fits = (size:number):void => {
    if(size>limits.maxPayloadBytes)throw new ThreadlineError('invalid_request','Input exceeds the effective owner payload limit.',{field:'content'});
  };
  if(Array.isArray(value.records)) {
    if(value.records.length>limits.maxBatchRecords)throw new ThreadlineError('invalid_request','Source batch exceeds the effective owner limit.',{field:'records'});
    for(const record of value.records)fits(Buffer.from((record as {bytesBase64:string}).bytesBase64,'base64').byteLength);
  }
  for(const field of ['content','observedUnder','applicability','content_json','observed_under_json','applicability_json']) {
    const part=value[field];if(part!==undefined && part!==null)fits(Buffer.byteLength(field.endsWith('_json') && typeof part==='string' ? part : JSON.stringify(part)));
  }
  for(const field of ['title','family','taskFamily','task_family','action','observation','uncertainty','statement','reason','accept_reason']) {
    const part=value[field];if(typeof part==='string')fits(Buffer.byteLength(part));
  }
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

/** Qualification proves baseline or historically approved admission, not current
 * authorization. Workers separately require the current revision; release
 * rechecks the payload/dependencies under current policy. One parameter order.
 * There is no project.initialize producer; unsupported future kinds gain no
 * tenant-level attestation exception. */
export const QUALIFIED_OPERATION_ADMISSION_SQL = `a.tenant_id=o.tenant_id AND a.id=o.admission_id
  AND a.project_id=o.project_id AND a.principal_id=o.actor_principal_id AND a.token_id=o.actor_token_id
  AND a.state='accepted' AND a.sanitizer_version=$5
  AND (a.policy_revision=$4 OR EXISTS (SELECT 1 FROM threadline_memory.policy_revisions qualified
    WHERE qualified.tenant_id=a.tenant_id AND qualified.project_id=a.project_id AND qualified.revision=a.policy_revision))`;
export const QUALIFIED_ADMISSION_PARAMETERS = [ADMISSION_POLICY_REVISION, ADMISSION_SCANNER_VERSION] as const;

export async function hasOperationAdmission(tx: TxClient, tenantId: string, projectId: string, operationId: string): Promise<boolean> {
  const rows = await tx.rows(`SELECT o.id FROM threadline_memory.operations o
    JOIN threadline_memory.ingress_admissions a ON ${QUALIFIED_OPERATION_ADMISSION_SQL}
    WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.id=$3`,
    [tenantId, projectId, operationId, ...QUALIFIED_ADMISSION_PARAMETERS]);
  return rows.length === 1;
}
