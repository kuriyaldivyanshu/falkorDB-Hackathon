import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const READ_ONLY_TOOL_NAMES = ['workspace.read', 'workspace.search', 'workspace.inspect'] as const;
export type ReadOnlyToolName = (typeof READ_ONLY_TOOL_NAMES)[number];
export const WORKSPACE_LIMITS = Object.freeze({
  readBytes: 32_768, fileBytes: 50 * 1024 * 1024, scanBytes: 50 * 1024 * 1024,
  scannedEntries: 1000, depth: 16, matches: 30, queryCharacters: 512,
});

export class WorkspaceError extends Error {
  constructor(readonly code: 'invalid_input' | 'path_denied' | 'file_changed' | 'unsupported_encoding' | 'limit_exceeded' | 'unavailable', message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface WorkspaceReader {
  /** Authorization is rechecked on every invocation; root comes from trusted registration. */
  invoke(name: ReadOnlyToolName, input: unknown): Promise<WorkspaceResult>;
}
export type WorkspaceResult =
  | { kind: 'read'; path: string; digest: string; totalBytes: number; offset: number; returnedBytes: number; truncated: boolean; text: string }
  | { kind: 'inspect'; files: readonly { path: string; bytes: number }[]; scannedEntries: number; truncated: boolean }
  | { kind: 'search'; matches: readonly { path: string; line: number; text: string; lineTruncated: boolean; digest: string }[]; scannedFiles: number; scannedBytes: number; truncated: boolean };

interface FileEntry { path: string; bytes: number }
const denied = (component: string): boolean => component.startsWith('.') || component === 'node_modules' || /\.(pem|key)$/i.test(component);
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sameFile = (a: BigIntStats, b: BigIntStats): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** No shell, provider, database or implicit workspace discovery belongs in this module. */
export function createWorkspaceReader(options: { root: string; authorize: () => Promise<void> }): WorkspaceReader {
  const root = resolve(options.root);

  const rootIdentity = async (): Promise<BigIntStats> => {
    const stats = await lstat(root, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(root) !== root)
      throw new WorkspaceError('path_denied', 'Workspace root must be a registered real directory without symlink ancestors.');
    return stats;
  };

  const safePath = async (path: string): Promise<string> => {
    if (!path || path.length > 1024 || isAbsolute(path) || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path))
      throw new WorkspaceError('path_denied', 'Use a nonempty workspace-relative path.');
    const components = path.split('/');
    if (components.some(part => !part || part === '..' || part === '.' || denied(part)))
      throw new WorkspaceError('path_denied', 'Hidden, secret, dependency and traversal paths are unavailable.');
    let current = root;
    for (const component of components) {
      current = join(current, component);
      if ((await lstat(current)).isSymbolicLink()) throw new WorkspaceError('path_denied', 'Symlinks are unavailable.');
    }
    const canonical = await realpath(current);
    if (canonical !== current || relative(root, canonical).startsWith(`..${sep}`) || isAbsolute(relative(root, canonical)))
      throw new WorkspaceError('path_denied', 'Path leaves its registered workspace.');
    return current;
  };

  const readBytes = async (path: string): Promise<Buffer> => {
    const beforeRoot = await rootIdentity();
    const target = await safePath(path);
    const before = await lstat(target, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new WorkspaceError('path_denied', 'Only regular, singly linked files are readable.');
    if (before.size > BigInt(WORKSPACE_LIMITS.fileBytes)) throw new WorkspaceError('limit_exceeded', 'File exceeds the bounded file-read limit.');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!sameFile(before, await handle.stat({ bigint: true }))) throw new WorkspaceError('file_changed', 'File changed before opening.');
      const bytes = Buffer.alloc(Number(before.size));
      let position = 0;
      while (position < bytes.length) {
        const chunk = await handle.read(bytes, position, bytes.length - position, position);
        if (chunk.bytesRead === 0) throw new WorkspaceError('file_changed', 'File shortened during read.');
        position += chunk.bytesRead;
      }
      if (!sameFile(before, await handle.stat({ bigint: true })) || (await safePath(path)) !== target || !sameFile(before, await lstat(target, { bigint: true })))
        throw new WorkspaceError('file_changed', 'File changed during read.');
      const afterRoot = await rootIdentity();
      if (beforeRoot.ino !== afterRoot.ino || beforeRoot.dev !== afterRoot.dev)
        throw new WorkspaceError('file_changed', 'Workspace changed during read.');
      decode(bytes);
      return bytes;
    } finally { await handle.close(); }
  };

  const scan = async (): Promise<{ files: FileEntry[]; scannedEntries: number; truncated: boolean }> => {
    const originalRoot = await rootIdentity();
    const files: FileEntry[] = [];
    let scannedEntries = 0, totalBytes = 0, truncated = false;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > WORKSPACE_LIMITS.depth) { truncated = true; return; }
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (++scannedEntries > WORKSPACE_LIMITS.scannedEntries) { truncated = true; return; }
        if (denied(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute).split(sep).join('/');
        if (entry.isSymbolicLink()) continue;
        const checked = await safePath(path);
        const stats = await lstat(checked);
        if (stats.isDirectory()) await walk(checked, depth + 1);
        else if (stats.isFile() && stats.nlink === 1) {
          totalBytes += stats.size;
          if (totalBytes > WORKSPACE_LIMITS.scanBytes) { truncated = true; return; }
          files.push({ path, bytes: stats.size });
        }
        if (truncated) return;
      }
    };
    await walk(root, 0);
    const afterRoot = await rootIdentity();
    if (originalRoot.ino !== afterRoot.ino || originalRoot.dev !== afterRoot.dev)
      throw new WorkspaceError('file_changed', 'Workspace changed during enumeration.');
    return { files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), scannedEntries: Math.min(scannedEntries, WORKSPACE_LIMITS.scannedEntries), truncated };
  };

  return {
    async invoke(name, input): Promise<WorkspaceResult> {
      await options.authorize();
      if (!record(input)) throw new WorkspaceError('invalid_input', 'Tool input must be an object.');
      try {
        if (name === 'workspace.read') {
          keys(input, ['path', 'offset', 'maxBytes']);
          const path = string(input.path, 'path');
          const offset = integer(input.offset ?? 0, 0, WORKSPACE_LIMITS.fileBytes);
          const maxBytes = integer(input.maxBytes ?? WORKSPACE_LIMITS.readBytes, 1, WORKSPACE_LIMITS.readBytes);
          const bytes = await readBytes(path);
          if (offset > bytes.length) throw new WorkspaceError('invalid_input', 'Offset exceeds file size.');
          // Avoid returning broken UTF-8 at the range boundaries.
          if (offset < bytes.length && ((bytes[offset] ?? 0) & 0xc0) === 0x80)
            throw new WorkspaceError('invalid_input', 'Offset must start at a UTF-8 character boundary.');
          let end = Math.min(bytes.length, offset + maxBytes);
          while (end > offset && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
          if (end === offset && offset < bytes.length) throw new WorkspaceError('invalid_input', 'maxBytes cannot fit the next UTF-8 character.');
          const fileDigest = digest(bytes);
          const result = (): WorkspaceResult => ({ kind: 'read', path, digest: fileDigest, totalBytes: bytes.length, offset, returnedBytes: end - offset, truncated: end < bytes.length, text: decode(bytes.subarray(offset, end)) });
          while (Buffer.byteLength(JSON.stringify(result())) > WORKSPACE_LIMITS.readBytes) {
            end = offset + Math.floor((end - offset) * 0.9);
            while (end > offset && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
          }
          return result();
        }
        if (name === 'workspace.inspect') {
          keys(input, ['maxFiles']);
          const maxFiles = integer(input.maxFiles ?? 100, 1, WORKSPACE_LIMITS.scannedEntries);
          const listing = await scan();
          const files = listing.files.slice(0, maxFiles);
          let truncated = listing.truncated || listing.files.length > maxFiles;
          while (Buffer.byteLength(JSON.stringify(files)) > WORKSPACE_LIMITS.readBytes - 1024) { files.pop(); truncated = true; }
          return { kind: 'inspect', files, scannedEntries: listing.scannedEntries, truncated };
        }
        if (name !== 'workspace.search') throw new WorkspaceError('invalid_input', 'Unknown read-only tool.');
        keys(input, ['query', 'maxResults']);
        const query = string(input.query, 'query');
        if (query.includes('\n') || query.includes('\r') || query.length > WORKSPACE_LIMITS.queryCharacters) throw new WorkspaceError('invalid_input', 'Search query is too long.');
        const maximum = integer(input.maxResults ?? WORKSPACE_LIMITS.matches, 1, WORKSPACE_LIMITS.matches);
        const listing = await scan();
        const matches: {path: string; line: number; text: string; lineTruncated: boolean; digest: string}[] = [];
        let scannedFiles = 0, scannedBytes = 0;
        for (const file of listing.files) {
          if (scannedBytes + file.bytes > WORKSPACE_LIMITS.scanBytes)
            return { kind: 'search', matches, scannedFiles, scannedBytes, truncated: true };
          const bytes = await readBytes(file.path);
          scannedFiles += 1; scannedBytes += bytes.length;
          if (scannedBytes > WORKSPACE_LIMITS.scanBytes) throw new WorkspaceError('limit_exceeded', 'Workspace changed beyond search byte limits.');
          const fileDigest = digest(bytes);
          const contents = decode(bytes);
          let start = 0, line = 0;
          while (start <= contents.length) {
            line += 1;
            const newline = contents.indexOf('\n', start);
            const end = newline < 0 ? contents.length : newline;
            const text = contents.slice(start, end);
            if (text.includes(query)) {
              if (matches.length === maximum) return { kind: 'search', matches, scannedFiles, scannedBytes, truncated: true };
              const match = { path: file.path, line, text: text.slice(0, 512), lineTruncated: text.length > 512, digest: fileDigest };
              if (Buffer.byteLength(JSON.stringify([...matches, match])) > WORKSPACE_LIMITS.readBytes - 1024)
                return { kind: 'search', matches, scannedFiles, scannedBytes, truncated: true };
              matches.push(match);
            }
            if (newline < 0) break;
            start = newline + 1;
          }
        }
        return { kind: 'search', matches, scannedFiles, scannedBytes, truncated: listing.truncated };
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        throw new WorkspaceError('unavailable', 'Workspace could not be read; no host path or driver details are disclosed.');
      }
    },
  };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new WorkspaceError('invalid_input', 'Unknown tool input field.');
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length) throw new WorkspaceError('invalid_input', `${field} must be a nonempty string.`);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new WorkspaceError('invalid_input', 'Numeric tool argument is outside its permitted bounds.');
  return value;
}
function decode(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary');
    return text;
  } catch { throw new WorkspaceError('unsupported_encoding', 'Only UTF-8 text without NUL bytes is supported.'); }
}
