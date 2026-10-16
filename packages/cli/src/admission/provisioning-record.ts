import { createHash, randomUUID } from 'node:crypto';
import {mkdir,lstat,readdir,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/**
 * Durable operation identity for provisioning mutations (M05.2/M05.3).
 *
 * `model.select` and `input.submit` are mutating operations that take an
 * `operationId`, so they obey the same rule as checkpoint submissions: an id is
 * allocated once per distinct intent and reused on a retry, because retrying with
 * a fresh id would create a second mutation instead of resuming the first. The
 * backend answers that second case `replayed`, which is the observable proof.
 *
 * The file is a keyed collection rather than a single slot. Two different
 * messages are two different intents, not one intent that changed; collapsing
 * them would make the second message look like a changed payload of the first
 * and refuse it.
 *
 * The digest is taken over the payload with the id excluded, so the same intent
 * is recognised as the same intent. Message text is hashed rather than embedded,
 * so the record never becomes a place where the operator's words are kept in the
 * clear.
 */

/** What the caller proposes, and what the digest is taken over. */
export type ProvisioningIntent =
  | {
      readonly kind: 'model.select';
      readonly projectId: string;
      readonly providerId: string;
      readonly modelId: string;
      readonly contextWindowTokens: number;
      readonly maxOutputTokens: number;
    }
  | {
      readonly kind: 'input.submit';
      readonly projectId: string;
      readonly inputKind: 'initial' | 'follow_up';
      readonly text: string;
    };

export interface ProvisioningRecord {
  readonly operationId: string;
  readonly intentDigest: string;
  readonly createdAt: string;
  /** The intent with message text removed; the digest covers the text. */
  readonly intent: Omit<ProvisioningIntent, 'text'> | ProvisioningIntent;
}

interface ProvisioningRecordFile {
  readonly version: 1;
  readonly entries: readonly ProvisioningRecord[];
}

/** Raised when a record file exists but cannot be understood. */
export class ProvisioningRecordError extends Error {
  constructor(readonly recordLabel: string, cause: unknown) {
    super(`The operation record ${recordLabel} could not be read.`);
    this.cause = cause;
    this.name = 'ProvisioningRecordError';
  }
}

export interface ProvisioningRecordOptions {
  readonly cwd?: string;
  readonly now?: () => Date;
  readonly uuidImpl?: () => string;
  /** False allocates an id without persisting it, for dry runs. */
  readonly write?: boolean;
}

function recordPathFor(recordPath: string, cwd?: string): string {
  return isAbsolute(recordPath) ? recordPath : cwd === undefined ? recordPath : resolve(cwd, recordPath);
}

/** The record's own name, for messages. Never the resolved absolute path. */
export function provisioningRecordLabel(recordPath: string): string {
  return basename(recordPath);
}

/**
 * Canonical digest over the intent.
 *
 * The operation id is excluded on purpose: the same payload under a different id
 * is the same intent, and including it would make a legitimate retry look like a
 * changed payload.
 */
export function digestProvisioningIntent(intent: ProvisioningIntent): string {
  const canonical = intent.kind === 'model.select'
    ? JSON.stringify({
        kind: intent.kind,
        projectId: intent.projectId,
        providerId: intent.providerId,
        modelId: intent.modelId,
        contextWindowTokens: intent.contextWindowTokens,
        maxOutputTokens: intent.maxOutputTokens,
      })
    : JSON.stringify({
        kind: intent.kind,
        projectId: intent.projectId,
        inputKind: intent.inputKind,
        textDigest: createHash('sha256').update(intent.text).digest('hex'),
        textLength: intent.text.length,
      });
  return createHash('sha256').update(canonical).digest('hex');
}

/** The stored intent, with the message text dropped from what is written to disk. */
function redact(intent: ProvisioningIntent): ProvisioningRecord['intent'] {
  if (intent.kind !== 'input.submit') return intent;
  return {
    kind: intent.kind,
    projectId: intent.projectId,
    inputKind: intent.inputKind,
    text: `(sha256 ${digestProvisioningIntent(intent)})`,
  };
}

function isRecord(value: unknown): value is ProvisioningRecord {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry['operationId'] === 'string' && typeof entry['intentDigest'] === 'string';
}

/** Read owner-only immutable records without following filesystem links. */
async function readRecord(path:string):Promise<unknown>{
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>131072||stat.nlink!==1||(stat.mode&0o077)!==0)throw new Error('Unsafe operation record.');return JSON.parse(await handle.readFile('utf8')) as unknown;}finally{await handle.close();}
}
export async function readProvisioningRecords(recordPath:string,options:ProvisioningRecordOptions={}):Promise<readonly ProvisioningRecord[]>{
 const path=recordPathFor(recordPath,options.cwd);const records:ProvisioningRecord[]=[];
 try{
  // Read the older collection if present; corrupt or unsafe identity is never
  // treated as an excuse to mint a replacement operation.
  try{const legacy=await readRecord(path);const entries=Array.isArray(legacy)?legacy:(legacy as ProvisioningRecordFile).entries;
    if(!Array.isArray(entries)||!entries.every(isRecord))throw new Error('Invalid operation records.');records.push(...entries);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const directory=path+'.d';
  try{const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077)!==0)throw new Error('Unsafe record directory.');
   const files=(await readdir(directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));if(files.length>200)throw new Error('Operation record limit reached.');
   for(const file of files){const value=await readRecord(resolve(directory,file));if(!isRecord(value))throw new Error('Invalid operation identity.');records.push(value);}
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return records;
 }catch(error){throw new ProvisioningRecordError(provisioningRecordLabel(recordPath),error);}
}
export async function resolveProvisioningOperationId(recordPath:string,intent:ProvisioningIntent,options:ProvisioningRecordOptions={}):Promise<ProvisioningRecord>{
 const digest=digestProvisioningIntent(intent);const records=await readProvisioningRecords(recordPath,options);
 const existing=records.find(r=>r.intentDigest===digest);if(existing)return existing;
 if(records.length>=200)throw new ProvisioningRecordError(provisioningRecordLabel(recordPath),new Error('Operation record limit reached.'));
 const record:ProvisioningRecord={operationId:(options.uuidImpl??randomUUID)(),intentDigest:digest,createdAt:(options.now??(()=>new Date()))().toISOString(),intent:redact(intent)};
 if(options.write===false)return record;
 const directory=recordPathFor(recordPath,options.cwd)+'.d';await mkdir(dirname(directory),{recursive:true,mode:0o700});await mkdir(directory,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
 const stat=await lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077)!==0)throw new ProvisioningRecordError(provisioningRecordLabel(recordPath),new Error('Unsafe record directory.'));
 const target=resolve(directory,digest+'.json');const temporary=resolve(directory,randomUUID()+'.tmp');
 const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
 try{await handle.writeFile(JSON.stringify(record)+'\n');await handle.sync();}finally{await handle.close();}
 try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')process.emitWarning('Could not clean a staged operation record.');});}
 const winner=await readRecord(target);if(!isRecord(winner)||winner.intentDigest!==digest)throw new ProvisioningRecordError(provisioningRecordLabel(recordPath),new Error('Operation identity conflict.'));
 return winner;
}
