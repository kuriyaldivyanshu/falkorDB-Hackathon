import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { isUuid } from '@threadline/shared';

/**
 * Durable operation identity for a checkpoint submission.
 *
 * This mirrors the existing admission request-record pattern exactly, because
 * the problem is the same one: a mutation that must survive a retry or a
 * restart without being applied twice.
 *
 * Two rules, both load-bearing:
 *
 * - **A retry reuses the id.** The id is bound to a digest of the submission. The
 *   same payload resubmitted — after a crash, a timeout, or a restart — sends
 *   the same id, so the backend replays the original outcome.
 * - **A changed payload never silently replaces the record.** The existing id is
 *   kept and the conflict is raised, because minting a fresh id would submit a
 *   second write while leaving the caller believing it retried the first.
 *
 * Revisions are carried as decimal strings. A revision is never converted to a
 * number here, so a `bigint` revision cannot round on the way to the wire.
 */

export class CheckpointRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointRecordError';
  }
}

export class CheckpointPayloadConflictError extends Error {
  constructor(readonly path: string, readonly operationId: string) {
    super(
      `The request record at ${path} already holds operation ${operationId} for a different submission. ` +
        'Reusing that id with changed content would be rejected by the backend, and minting a new id would ' +
        'submit a second write. Resolve the existing record or remove it deliberately.',
    );
    this.name = 'CheckpointPayloadConflictError';
  }
}

/** The caller-proposable part of a submission, which the digest is taken over. */
export interface CheckpointSubmissionBody {
  readonly projectId: string;
  readonly taskId: string;
  readonly runId?: string | null;
  readonly progress?: string;
  readonly nextAction?: string;
  readonly steps?: readonly { readonly stepId: string; readonly text?: string; readonly status?: string }[];
  /** Decimal string. Never a number. */
  readonly baseRevision?: string | null;
}

export interface CheckpointRequestRecord {
  readonly operationId: string;
  readonly submissionDigest: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly createdAt: string;
  readonly input: CheckpointSubmissionBody;
}

/** Resolves a record path against an optional cwd, tolerating an absolute path. */
function resolveRecordPath(recordPath: string, cwd?: string): string {
  if (isAbsolute(recordPath)) return recordPath;
  return cwd === undefined ? recordPath : resolve(cwd, recordPath);
}

export interface CheckpointRecordOptions {
  readonly cwd?: string;
  readonly now?: () => Date;
  readonly uuidImpl?: () => string;
  readonly write?: boolean;
}

/**
 * Digest over the submission with a fixed probe id.
 *
 * The id is excluded on purpose: the same payload under a different id is the
 * same intent, and including it would make a legitimate retry look like a
 * changed payload.
 */
export function digestCheckpointSubmission(body: CheckpointSubmissionBody): string {
  const canonical = JSON.stringify({
    projectId: body.projectId,
    taskId: body.taskId,
    runId: body.runId ?? null,
    progress: body.progress ?? null,
    nextAction: body.nextAction ?? null,
    steps: (body.steps ?? []).map((step) => ({ stepId: step.stepId, text: step.text ?? null, status: step.status ?? null })),
    baseRevision: body.baseRevision ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function readCheckpointRequestRecord(
  recordPath: string,
  options: CheckpointRecordOptions = {},
): Promise<CheckpointRequestRecord | null> {
  const path = resolveRecordPath(recordPath, options.cwd);
  let raw: string;
  try {
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {if(!(await handle.stat()).isFile())throw new Error('not_regular');raw=await handle.readFile('utf8');}
    finally{await handle.close();}
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw new CheckpointRecordError(`The request record at ${path} could not be read safely; no new operation was created.`);
  }
  try {
    const parsed = JSON.parse(raw) as CheckpointRequestRecord;
    if (!isUuid(parsed.operationId) || !/^[a-f0-9]{64}$/.test(parsed.submissionDigest) || !parsed.input || digestCheckpointSubmission(parsed.input)!==parsed.submissionDigest) {
      throw new CheckpointRecordError(`The request record at ${path} is not a readable checkpoint record.`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof CheckpointRecordError) throw error;
    throw new CheckpointRecordError(`The request record at ${path} is not valid JSON.`);
  }
}

/**
 * Returns the durable operation id for this submission.
 *
 * Reuses the recorded id for an identical payload and raises a conflict for a
 * changed one. It never overwrites a record.
 */
export async function resolveCheckpointOperationId(
  recordPath: string,
  body: CheckpointSubmissionBody,
  options: CheckpointRecordOptions = {},
): Promise<CheckpointRequestRecord> {
  const path = resolveRecordPath(recordPath, options.cwd);
  const digest = digestCheckpointSubmission(body);
  const existing = await readCheckpointRequestRecord(recordPath, options);

  if (existing !== null) {
    if (existing.submissionDigest !== digest) {
      throw new CheckpointPayloadConflictError(path, existing.operationId);
    }
    return existing;
  }

  const makeUuid = options.uuidImpl ?? randomUUID;
  const operationId = makeUuid();
  if (!isUuid(operationId)) {
    throw new CheckpointRecordError(`Generated an operation id that is not a UUID: "${operationId}".`);
  }
  const record: CheckpointRequestRecord = {
    operationId,
    submissionDigest: digest,
    projectId: body.projectId,
    taskId: body.taskId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    input: body,
  };
  if (options.write !== false) {
    await mkdir(dirname(path), { recursive: true,mode:0o700 });
    const temporary=`${path}.${randomUUID()}.tmp`;
    try {
      const handle=await open(temporary,'wx',0o600);
      try {await handle.writeFile(`${JSON.stringify(record,null,2)}\n`,'utf8');await handle.sync();}
      finally{await handle.close();}
      try {await link(temporary,path);}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        // Another process published first. Re-read its complete immutable record;
        // neither caller may overwrite it or submit under a losing identity.
        return resolveCheckpointOperationId(recordPath,body,options);
      }
      const directory=await open(dirname(path),'r');
      try{await directory.sync();}finally{await directory.close();}
    } finally {
      try{await unlink(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')
        process.emitWarning('A temporary checkpoint request record could not be removed.');}
    }
  }
  return record;
}