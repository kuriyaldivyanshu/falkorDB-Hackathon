import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, stat, lstat, open, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Local storage for the Threadline application session credential.
 *
 * This is the user's own session with the local backend, not a database or
 * provider credential. It is read from an owner-only file, it is never written
 * into a log line, an activity row, a command argument or a URL, and it is
 * never echoed back by any command in this package.
 *
 * The file holds a bearer token. Anyone who can read the file can act as the
 * owner, so the mode is checked as well as set.
 */

export const CREDENTIAL_FILE_MODE = 0o600;

export class CredentialError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`Local credential ${path}: ${problem}`);
    this.name = 'CredentialError';
    this.path = path;
  }
}

export interface LocalSessionCredential {
  /** Bearer token for the local backend. Never rendered. */
  readonly token: string;
  readonly issuedAt: string;
  readonly backendUrl: string;
}

export interface CredentialStoreOptions {
  readonly cwd?: string;
  readonly readFileImpl?: typeof readFile;
  readonly writeFileImpl?: typeof writeFile;
  readonly statImpl?: typeof stat;
  readonly chmodImpl?: typeof chmod;
  readonly accessImpl?: typeof access;
  readonly mkdirImpl?: typeof mkdir;
}

export function resolveCredentialPath(credentialPath: string, cwd: string = process.cwd()): string {
  return isAbsolute(credentialPath) ? credentialPath : resolve(cwd, credentialPath);
}

/**
 * Returns the stored credential, or `null` when none has been created yet.
 *
 * A file that exists but is readable by group or other is refused rather than
 * used: quietly widening or ignoring the mode would let another local account
 * impersonate the owner.
 */
export async function readLocalSessionCredential(
  credentialPath: string,
  options: CredentialStoreOptions = {},
): Promise<LocalSessionCredential | null> {
  const path = resolveCredentialPath(credentialPath, options.cwd);
  const read = options.readFileImpl ?? readFile;
  const statFile = options.statImpl ?? lstat;

  let text: string;
  try {
    const stats = await statFile(path);
    if (!stats.isFile() || stats.isSymbolicLink() || (typeof process.getuid === 'function' && stats.uid !== process.getuid()))
      throw new CredentialError(path,'must be a regular file owned by the running user.');
    if ((stats.mode & 0o077) !== 0) throw new CredentialError(path,`is readable beyond its owner (mode ${modeToString(stats.mode)}). Run: chmod 600 ${path}`);
    if (options.readFileImpl) text = await read(path,'utf8');
    else {
      const handle = await open(path, (await import('node:fs')).constants.O_RDONLY | (await import('node:fs')).constants.O_NOFOLLOW);
      try {
        const actual = await handle.stat();
        if (actual.ino !== stats.ino || actual.dev !== stats.dev) throw new CredentialError(path,'changed during read.');
        text = await handle.readFile('utf8');
      } finally { await handle.close(); }
    }
  } catch (error) {
    if (isNotFound(error)) return null;
    if (error instanceof CredentialError) throw error;
    throw new CredentialError(path,`could not be read (${describe(error)}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CredentialError(path, 'is not valid JSON. Remove it and re-run the owner bootstrap.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CredentialError(path, 'does not contain a credential object.');
  }
  const record = parsed as Record<string, unknown>;
  const token = record['token'];
  if (typeof token !== 'string' || token.length === 0) {
    throw new CredentialError(path, 'has no "token" field.');
  }
  const issuedAt = record['issuedAt'] ?? record['created_at'];
  if (typeof issuedAt !== 'string') {
    throw new CredentialError(path, 'has no "issuedAt" field.');
  }
  const backendUrl = record['backendUrl'] ?? 'http://127.0.0.1:47821';
  if (typeof backendUrl !== 'string') {
    throw new CredentialError(path, 'has no "backendUrl" field.');
  }
  return { token, issuedAt, backendUrl };
}

/** Creates or replaces the credential with owner-only permissions. */
export async function writeLocalSessionCredential(
  credentialPath: string,
  credential: LocalSessionCredential,
  options: CredentialStoreOptions = {},
): Promise<string> {
  const path = resolveCredentialPath(credentialPath, options.cwd);
  const write = options.writeFileImpl ?? writeFile;
  const makeDir = options.mkdirImpl ?? mkdir;
  await makeDir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await write(temporary, `${JSON.stringify(credential,null,2)}\n`, { mode:CREDENTIAL_FILE_MODE,flag:'wx' });
  await rename(temporary,path);
  return path;
}

/**
 * Mints a candidate token for the local owner bootstrap.
 *
 * The backend decides whether to issue a session; this only produces
 * sufficiently random material for the owner to send it.
 */
export function newBootstrapToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Replaces a bearer token found in text with a fixed marker.
 *
 * Used before any backend or transport text reaches a log, an activity row or
 * an error message, so a server that echoes a token cannot leak it through the
 * interface.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 8) {
      result = result.split(secret).join('<redacted>');
    }
  }
  return result;
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

function modeToString(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}
