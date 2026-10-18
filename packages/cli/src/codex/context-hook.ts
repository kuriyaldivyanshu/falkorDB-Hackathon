import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
import { parseArgs } from 'node:util';

import { installationPaths, DEFAULT_SERVICE_HOST, DEFAULT_SERVICE_PORT } from '@threadline/backend';
import { prepareContextInputSchema, uuidSchema, ThreadlineError, type ContextPacket } from '@threadline/shared';

import { createApiClient } from '../client.js';
import { createContextSurface } from '../context-surface.js';
import { CODEX_HOOK_INPUT_MAX_BYTES } from './events.js';
import { renderHookContextOutput } from './hook-output.js';

export const HOOK_DEFAULT_TIMEOUT_MS = 2_000;
export const HOOK_SELECTOR_MAX_BYTES = 64 * 1024;
const REPORT_RESERVE_MS = 150;
const FILE_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 1024 * 1024;
export const CONTEXT_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'] as const;
type HookEvent = typeof CONTEXT_HOOK_EVENTS[number];

const hookOptions = {
  home: { type: 'string' }, project: { type: 'string' }, 'token-file': { type: 'string' },
  'workspace-root': { type: 'string' }, 'context-input': { type: 'string' },
  'hook-timeout-ms': { type: 'string' },
} as const;

export function hookTimeout(raw: string | undefined): number {
  if (raw === undefined) return HOOK_DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) throw new Error('invalid_timeout');
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 250 || value > 5_000) throw new Error('invalid_timeout');
  return value;
}

export function hookAbsolutePath(value: string | undefined): string {
  if (value === undefined || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('invalid_path');
  return value;
}

/** Strict projection: selectors cannot provide routing, keys or native identity. */
export const hookSelectorsSchema = prepareContextInputSchema.pick({
  taskId: true, focus: true, conditions: true, maxBodyBytes: true,
}).strict();

/** Deadline races release listeners; cancellable operations share its signal. */
class HookDeadline {
  readonly controller = new AbortController();
  readonly endsAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(timeoutMs: number, startedAt: number) {
    this.endsAt = startedAt + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(), this.remaining());
  }
  remaining(): number { return Math.max(0, this.endsAt - performance.now()); }
  check(): void {
    if (this.remaining() <= 0 || this.controller.signal.aborted) throw new Error('deadline');
  }
  async run<T>(operation: Promise<T>): Promise<T> {
    if (this.remaining() <= 0 || this.controller.signal.aborted) {
      void operation.catch(() => undefined);
      throw new Error('deadline');
    }
    const signal = this.controller.signal;
    let abort: () => void = () => undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        abort = () => reject(new Error('deadline'));
        signal.addEventListener('abort', abort, { once: true });
      })]);
    } finally { signal.removeEventListener('abort', abort); }
  }
  close(): void { clearTimeout(this.timer); this.controller.abort(); }
}

/** O_NONBLOCK prevents a swapped FIFO from hanging open; fstat guards the fd. */
async function readRegularFile(path: string, maxBytes: number, deadline: HookDeadline): Promise<string> {
  const pending = open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW).then(async (handle) => {
    if (deadline.controller.signal.aborted) { await handle.close(); throw new Error('deadline'); }
    return handle;
  });
  const handle = await deadline.run(pending);
  try {
    const info = await deadline.run(handle.stat());
    if (!info.isFile() || info.size > maxBytes) throw new Error('invalid_file');
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used <= maxBytes) {
      const result = await deadline.run(handle.read(bytes, used, bytes.length - used, used));
      if (result.bytesRead === 0) break;
      used += result.bytesRead;
      if (used > maxBytes) throw new Error('file_bound');
    }
    deadline.check();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
  } finally { await handle.close(); }
}

async function readEnvelope(input: Readable, deadline: HookDeadline): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const signal = deadline.controller.signal;
    const cleanup = (): void => {
      input.pause();
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (): void => { cleanup(); reject(new Error('invalid_input')); };
    const onAbort = (): void => { cleanup(); reject(new Error('deadline')); };
    const onError = (): void => fail();
    const onData = (chunk: Buffer | string): void => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > CODEX_HOOK_INPUT_MAX_BYTES) { fail(); return; }
      chunks.push(data);
    };
    const onEnd = (): void => { cleanup(); resolve(Buffer.concat(chunks)); };
    signal.addEventListener('abort', onAbort, { once: true });
    input.on('data', onData).once('end', onEnd).once('error', onError);
    if (signal.aborted) onAbort();
    else input.resume();
  });
  deadline.check();
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_input');
  return parsed as Record<string, unknown>;
}

/** One write; success means its callback succeeded, never host consumption. */
async function writePacket(output: Writable, line: string, deadline: HookDeadline): Promise<void> {
  deadline.check();
  await new Promise<void>((resolve, reject) => {
    const signal = deadline.controller.signal;
    let settled = false;
    const cleanup = (): void => {
      output.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) {
        // write callbacks can precede the stream's error event. Keep the local
        // listener until close; never install a global exception handler.
        output.once('close', () => { setImmediate(cleanup); });
        output.destroy();
        reject(new Error('stdout_uncertain'));
      } else { cleanup(); resolve(); }
    };
    const onError = (): void => finish(new Error('stdout_uncertain'));
    const onAbort = (): void => finish(new Error('deadline'));
    output.on('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    try { deadline.check(); output.write(line, finish); } catch { finish(new Error('stdout_uncertain')); }
  });
}

async function endpoint(home: string, deadline: HookDeadline): Promise<string> {
  // Only the non-secret client destination is needed. Do not invoke the
  // backend's synchronous config/secrets reader on a hook's critical path.
  const raw: unknown = JSON.parse(await readRegularFile(installationPaths(home).configFile, FILE_MAX_BYTES, deadline));
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_config');
  const config = raw as Record<string, unknown>;
  const host = process.env['THREADLINE_HOST'] || config['host'] || DEFAULT_SERVICE_HOST;
  const port = process.env['THREADLINE_PORT'] || config['port'] || DEFAULT_SERVICE_PORT;
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') throw new Error('invalid_config');
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid_config');
  return `http://${host === '::1' ? '[::1]' : host}:${String(port)}`;
}

/** No raw error, path, envelope, token or backend message reaches diagnostics. */
async function diagnostic(output: Writable, code: string, deadline?: HookDeadline): Promise<void> {
  const line = `threadline hook: ${code}\n`;
  // Also bound stderr backpressure, including failures found at the deadline.
  const time = Math.max(1, Math.min(25, deadline?.remaining() ?? 25));
  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => { output.removeListener('error', onError); };
    const done = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed) {
        output.once('close', () => { setImmediate(cleanup); });
        output.destroy();
      } else cleanup();
      resolve();
    };
    const onError = (): void => done(true);
    output.on('error', onError);
    timer = setTimeout(() => done(true), time);
    try { output.write(line, (error) => done(error != null)); } catch { done(true); }
  });
}

/** The recognized command always exits zero for ordinary adapter failures. */
export async function runCodexContextHook(
  argv: readonly string[],
  streams = { input: process.stdin as Readable, output: process.stdout as Writable, error: process.stderr as Writable },
): Promise<number> {
  const startedAt = performance.now();
  const invocationId = randomUUID();
  const prepareKey = `codex-hook:${invocationId}:prepare`;
  const reportKey = `codex-hook:${invocationId}:report`;
  let deadline: HookDeadline | undefined;
  let packet: ContextPacket | undefined;
  let outputStarted = false;
  let outputSucceeded = false;
  let report: ((state: 'emitted' | 'unknown' | 'refused') => Promise<unknown>) | undefined;
  try {
    const parsed = parseArgs({ args: [...argv], options: hookOptions, allowPositionals: true, strict: true, tokens: true });
    if (parsed.positionals.length !== 2 || parsed.positionals[0] !== 'codex-hook') throw new Error('invalid_arguments');
    const event = parsed.positionals[1];
    if (!(CONTEXT_HOOK_EVENTS as readonly string[]).includes(event ?? '')) throw new Error('unsupported_event');
    const flags = parsed.tokens.filter((token) => token.kind === 'option').map((token) => token.name);
    if (new Set(flags).size !== flags.length) throw new Error('invalid_arguments');
    const values = parsed.values;
    deadline = new HookDeadline(hookTimeout(values['hook-timeout-ms']), startedAt);
    const home = hookAbsolutePath(values.home);
    const tokenFile = hookAbsolutePath(values['token-file']);
    const rootPath = hookAbsolutePath(values['workspace-root']);
    const selectorPath = hookAbsolutePath(values['context-input']);
    const projectId = uuidSchema.parse(values.project);
    const envelope = await readEnvelope(streams.input, deadline);
    if (envelope['hook_event_name'] !== event) throw new Error('event_mismatch');
    const cwdPath = hookAbsolutePath(typeof envelope['cwd'] === 'string' ? envelope['cwd'] : undefined);
    const root = await deadline.run(realpath(rootPath));
    const cwd = await deadline.run(realpath(cwdPath));
    const rootInfo = await deadline.run(stat(root));
    const cwdInfo = await deadline.run(stat(cwd));
    const contained = relative(root, cwd);
    if (!rootInfo.isDirectory() || !cwdInfo.isDirectory() || isAbsolute(contained) || contained === '..' || contained.startsWith(`..${sep}`)) {
      throw new Error('workspace_guard');
    }
    const selectors = hookSelectorsSchema.parse(JSON.parse(await readRegularFile(selectorPath, HOOK_SELECTOR_MAX_BYTES, deadline)));
    const token = (await readRegularFile(tokenFile, FILE_MAX_BYTES, deadline)).trim();
    if (token.length === 0 || /\s/.test(token)) throw new Error('invalid_credential');
    const baseUrl = await endpoint(home, deadline);
    const activeDeadline = deadline;
    const surface = (reserve: number) => {
      activeDeadline.check();
      return createContextSurface(createApiClient({ baseUrl, token,
        timeoutMs: Math.max(1, Math.floor(activeDeadline.remaining() - reserve)),
        signal: activeDeadline.controller.signal, maxResponseBytes: RESPONSE_MAX_BYTES,
      }));
    };
    const result = await deadline.run(surface(REPORT_RESERVE_MS).prepare({
      ...selectors, projectId, nativeSessionId: null, idempotencyKey: prepareKey,
    }));
    if (result.kind === 'refused') throw new Error('context_refused');
    packet = result.packet;
    report = (state) => surface(0).recordOccurrence({ projectId, occurrenceId: result.packet.occurrenceId,
      idempotencyKey: reportKey, expectedState: 'prepared', state, boundary: 'adapter_report',
      ...(state === 'refused' ? { refusalReason: 'delivery_failed' as const } : {}),
    });
    if (packet.manifest.projectId !== projectId || packet.manifest.taskId !== (selectors.taskId ?? null)
      || packet.manifest.bodyBytes !== Buffer.byteLength(packet.body, 'utf8')
      || packet.manifest.maxBodyBytes !== selectors.maxBodyBytes
      || packet.manifest.renderDigest !== createHash('sha256').update(packet.body).digest('hex')) {
      throw new Error('invalid_packet');
    }
    const rendered = renderHookContextOutput({ event: (event as HookEvent) === 'SessionStart' ? 'sessionStart' : 'userPromptSubmit',
      text: packet.body, maxBytes: selectors.maxBodyBytes, onOverflow: 'refuse' });
    if (rendered.kind !== 'context') throw new Error('output_refused');
    deadline.check(); // Even completed preparation is withheld if time ran out.
    outputStarted = true;
    await writePacket(streams.output, rendered.stdout, deadline);
    outputSucceeded = true;
    try { await deadline.run(report('emitted')); }
    catch { await diagnostic(streams.error, 'report_uncertain_after_local_write', deadline); }
  } catch (error) {
    if (packet !== undefined && report !== undefined && !outputSucceeded && (deadline?.remaining() ?? 0) > 0) {
      try { await deadline?.run(report(outputStarted ? 'unknown' : 'refused')); } catch { /* prepared/unknown audit stays uncertain */ }
    }
    const safeReasons = new Set(['invalid_timeout', 'invalid_path', 'invalid_arguments', 'unsupported_event',
      'invalid_input', 'deadline', 'invalid_file', 'file_bound', 'event_mismatch', 'workspace_guard',
      'invalid_credential', 'invalid_config', 'invalid_packet', 'output_refused', 'context_refused']);
    const reason = error instanceof ThreadlineError ? error.code
      : error instanceof Error && safeReasons.has(error.message) ? error.message : 'invalid_configuration_or_input';
    await diagnostic(streams.error, outputStarted ? 'stdout_uncertain_no_emitted_report' : `context_withheld:${reason}`, deadline);
  } finally {
    streams.input.pause();
    streams.input.destroy();
    deadline?.close();
  }
  return 0;
}
