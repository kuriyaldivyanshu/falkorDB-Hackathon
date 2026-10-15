import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { isGoalAdmissionInput, isUuid, type GoalAdmissionInput } from '@threadline/shared';

/**
 * Durable identity for one admission attempt.
 *
 * The backend's `requestId` is the idempotency key. It is allocated once, kept
 * on disk and reused on every retry of the same payload, so a timeout or an
 * unknown outcome can never turn into a second admission under a fresh id.
 *
 * The M00 transport `commandId` is a different thing entirely: it identifies one
 * HTTP delivery and is allocated by the backend per request.
 */

export class RequestRecordError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`Admission request record ${path}: ${problem}`);
    this.name = 'RequestRecordError';
    this.path = path;
  }
}

/** Raised when a retry would change the payload behind an existing request id. */
export class RequestPayloadConflictError extends Error {
  readonly recordPath: string;
  readonly existingRequestId: string;

  constructor(recordPath: string, existingRequestId: string) {
    super(
      `${recordPath} already holds request ${existingRequestId} for a different payload. ` +
        'Reusing that id with changed content would be rejected by the backend, and minting a new id ' +
        'would silently admit the task twice. Resolve the existing request or remove the record deliberately.',
    );
    this.name = 'RequestPayloadConflictError';
    this.recordPath = recordPath;
    this.existingRequestId = existingRequestId;
  }
}

export interface AdmissionRequestRecord {
  readonly requestId: string;
  readonly requestDigest: string;
  readonly projectId: string;
  readonly fixtureId: string;
  readonly createdAt: string;
  /** The exact payload bound to this id. Retries must send it unchanged. */
  readonly input: GoalAdmissionInput;
}

export interface RequestRecordOptions {
  readonly cwd?: string;
  readonly readFileImpl?: typeof readFile;
  readonly writeFileImpl?: typeof writeFile;
  readonly mkdirImpl?: typeof mkdir;
  readonly uuidImpl?: () => string;
  readonly now?: () => Date;
}

/** Canonical digest: key order must not change the identity of a payload. */
export function digestAdmissionInput(input: GoalAdmissionInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
}

export function resolveRequestRecordPath(recordPath: string, cwd: string = process.cwd()): string {
  return isAbsolute(recordPath) ? recordPath : resolve(cwd, recordPath);
}

/**
 * Returns the stored record for this admission, or null when none exists.
 *
 * A record whose id or digest is malformed is refused rather than replaced:
 * overwriting it could turn one interrupted admission into two.
 */
export async function readAdmissionRequestRecord(
  recordPath: string,
  options: RequestRecordOptions = {},
): Promise<AdmissionRequestRecord | null> {
  const path = resolveRequestRecordPath(recordPath, options.cwd);
  const read = options.readFileImpl ?? readFile;

  let text: string;
  try {
    text = await read(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new RequestRecordError(path, `could not be read (${describe(error)}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new RequestRecordError(path, 'is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RequestRecordError(path, 'is not a record object.');
  }
  const record = parsed as Record<string, unknown>;
  const requestId = record['requestId'];
  if (!isUuid(requestId)) {
    throw new RequestRecordError(path, 'has no valid requestId UUID.');
  }
  const requestDigest = record['requestDigest'];
  if (typeof requestDigest !== 'string' || requestDigest.length === 0) {
    throw new RequestRecordError(path, 'has no requestDigest.');
  }
  const input = record['input'];
  if (!isGoalAdmissionInput(input)) {
    throw new RequestRecordError(path, 'has no input payload.');
  }
  if (input.requestId !== requestId || input.projectId !== record['projectId'] || input.fixtureId !== record['fixtureId'] ||
      digestAdmissionInput({...input,requestId:'00000000-0000-4000-8000-000000000000'}) !== requestDigest)
    throw new RequestRecordError(path,'payload or digest is inconsistent.');
  return {
    requestId,
    requestDigest,
    projectId: String(record['projectId'] ?? ''),
    fixtureId: String(record['fixtureId'] ?? ''),
    createdAt: String(record['createdAt'] ?? ''),
    input,
  };
}

/**
 * Returns the request id to use for this payload, creating a record when none
 * exists.
 *
 * Reuse rules:
 * - no record: mint a new UUID and bind it to this payload;
 * - record with the same digest: reuse the id, so a retry stays idempotent;
 * - record with a different digest: refuse, because a new id would silently
 *   admit a second task.
 */
export async function resolveAdmissionRequestId(
  recordPath: string,
  payload: Omit<GoalAdmissionInput, 'requestId'>,
  options: RequestRecordOptions = {},
): Promise<AdmissionRequestRecord> {
  const path = resolveRequestRecordPath(recordPath, options.cwd);
  const probe = { ...payload, requestId: '00000000-0000-4000-8000-000000000000' };
  const digest = digestAdmissionInput(probe);

  const existing = await readAdmissionRequestRecord(recordPath, options);
  if (existing !== null) {
    if (existing.requestDigest !== digest) {
      throw new RequestPayloadConflictError(path, existing.requestId);
    }
    return existing;
  }

  const makeUuid = options.uuidImpl ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const requestId = makeUuid();
  if (!isUuid(requestId)) {
    throw new RequestRecordError(path, `generated a request id that is not a UUID: "${requestId}".`);
  }

  const record: AdmissionRequestRecord = {
    requestId,
    requestDigest: digest,
    projectId: payload.projectId,
    fixtureId: payload.fixtureId,
    createdAt: now().toISOString(),
    input: { ...payload, requestId },
  };

  const write = options.writeFileImpl ?? writeFile;
  const makeDir = options.mkdirImpl ?? mkdir;
  await makeDir(dirname(path), { recursive: true });
  try { await write(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag:'wx' }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
      return resolveAdmissionRequestId(recordPath,payload,options);
    throw error;
  }
  return record;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === undefined ? error.message : `${error.message} (${code})`;
  }
  return typeof error;
}
