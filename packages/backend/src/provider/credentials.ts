import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isProviderCheck, isSetupProvider, ThreadlineError, type ProviderCheck, type SetupProvider } from '@threadline/shared';

export interface SavedCredential { readonly model: string; readonly apiKey: string; readonly revision: string; readonly validation: ProviderCheck; readonly lastCheck?: ProviderCheck }
export interface CredentialFile { readonly version: 1; readonly active: SetupProvider | null; readonly accounts: Partial<Record<SetupProvider, SavedCredential>> }
const empty = (): CredentialFile => ({ version: 1, active: null, accounts: {} });
export function defaultProviderDirectory(): string {
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Threadline', 'providers')
    : join(homedir(), '.config', 'threadline', 'providers');
}
function existsWithoutFollowing(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function unsafe(): never { throw new ThreadlineError('service_unavailable', 'Provider credential storage is unsafe or invalid. Use an owner-only directory outside synced folders.'); }
function assertPrivate(path: string, directory: boolean): void {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) ||
    s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0) unsafe();
}
/** Owner-only plaintext storage. No encryption or OS-keychain guarantee is implied. */
export function createCredentialVault(directory: string) {
  const root = resolve(directory), path = join(root, 'accounts.json');
  return {
    read(): CredentialFile | null {
      if (!existsWithoutFollowing(root)) return null;
      assertPrivate(root, true);
      if (!existsWithoutFollowing(path)) return null;
      assertPrivate(path, false);
      if (lstatSync(path).size > 64 * 1024) unsafe();
      let value: unknown; try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { unsafe(); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) unsafe();
      const v = value as Record<string, unknown>;
      if (v.version !== 1 || (v.active !== null && !isSetupProvider(v.active)) || !v.accounts || typeof v.accounts !== 'object' || Array.isArray(v.accounts)) unsafe();
      for (const [id, entry] of Object.entries(v.accounts)) {
        if (!isSetupProvider(id) || !entry || typeof entry !== 'object') unsafe();
        const a = entry as Record<string, unknown>;
        if (typeof a.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(a.revision) || typeof a.apiKey !== 'string' || !validKey(a.apiKey) || typeof a.model !== 'string' || !validModel(a.model) ||
          !isProviderCheck(a.validation) || a.validation.state !== 'valid' || (a.lastCheck !== undefined && !isProviderCheck(a.lastCheck))) unsafe();
      }
      const file = value as CredentialFile;
      if (file.active && !file.accounts[file.active]) unsafe();
      return file;
    },
    write(file: CredentialFile): void {
      mkdirSync(root, { recursive: true, mode: 0o700 }); assertPrivate(root, true);
      if (existsWithoutFollowing(path)) assertPrivate(path, false);
      const temporary = join(root, `.accounts-${randomUUID()}.tmp`);
      let fd: number | null = null;
      try {
        fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, JSON.stringify(file)); fsyncSync(fd); closeSync(fd); fd = null;
        renameSync(temporary, path);
        // Persist publication without allowing post-publication cleanup to mask success.
        let parent: number | null = null;
        try { parent = openSync(dirname(path), constants.O_RDONLY); fsyncSync(parent); }
        catch { process.emitWarning('Provider credentials were published, but directory synchronization failed.'); }
        finally { if (parent !== null) closeSync(parent); }
      } catch { throw new ThreadlineError('service_unavailable', 'Could not save provider credentials. The previous selection has not been activated.'); }
      finally { if (fd !== null) closeSync(fd); try { unlinkSync(temporary); } catch { /* Publication moves the temporary name. */ } }
    },
    empty,
  };
}
export function validKey(key: string): boolean { return key.length >= 8 && key.length <= 8192 && /^[\x21-\x7e]+$/.test(key); }
export function validModel(model: string): boolean { return model.length > 0 && model.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model); }
