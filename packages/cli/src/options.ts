import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

/**
 * Command-line surface of the terminal client.
 *
 * Kept free of Ink, of the transport client and of any backend knowledge so
 * that the accepted commands can be read in one place.
 */

/**
 * Mirrors the backend's default bind address. Only used when `--backend` is
 * absent; it is a convenience, not configuration authority.
 */
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:47821';
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const OPTION_SPEC = {
  backend: { type: 'string' },
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

export type CliCommand = 'tui' | 'health' | 'echo';

export interface CliInvocation {
  readonly command: CliCommand;
  readonly backendUrl: string;
  readonly requestTimeoutMs: number;
  /** Text for the `echo` command; `null` for every other command. */
  readonly echoText: string | null;
  readonly help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP_TEXT = `Threadline terminal client (M00 scaffold)

Usage:
  threadline [options] <command> [arguments]

Commands:
  tui                 Terminal interface. Connects, streams events, sends commands.
  health              Print the backend health report, then exit.
  echo <text...>      Send one development.echo command and print its acknowledgement
                      and the matching backend event, then exit.

Options:
  --backend <url>     Backend base URL (default ${DEFAULT_BACKEND_URL}).
  --timeout <ms>      Per-request timeout in milliseconds (default ${DEFAULT_REQUEST_TIMEOUT_MS}).
  -h, --help          Show this help.

This build is process-local. Commands and events are not stored and do not
survive a backend restart.`;

export function parseCliArgs(argv: readonly string[]): CliInvocation {
  const parsed = parseArgs({
    args: [...argv],
    options: OPTION_SPEC,
    allowPositionals: true,
    strict: true,
  });

  const { values, positionals } = parsed;
  const backendUrl = readBackendUrl(values.backend);
  const requestTimeoutMs = readTimeout(values.timeout);
  const name = positionals[0] ?? 'tui';

  if (name === 'tui') {
    if (positionals.length > 1) {
      throw new UsageError(`"tui" takes no arguments, received ${positionals.length - 1}.`);
    }
    return { command: 'tui', backendUrl, requestTimeoutMs, echoText: null, help: values.help };
  }

  if (name === 'health') {
    if (positionals.length > 1) {
      throw new UsageError(`"health" takes no arguments, received ${positionals.length - 1}.`);
    }
    return { command: 'health', backendUrl, requestTimeoutMs, echoText: null, help: values.help };
  }

  if (name === 'echo') {
    const words = positionals.slice(1);
    if (words.length === 0) {
      throw new UsageError('"echo" needs the text to send, for example: threadline echo hello');
    }
    return {
      command: 'echo',
      backendUrl,
      requestTimeoutMs,
      echoText: words.join(' '),
      help: values.help,
    };
  }

  throw new UsageError(`Unknown command "${name}". Run "threadline --help" for the list.`);
}

function readBackendUrl(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_BACKEND_URL;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new UsageError(`--backend must be an absolute URL, received "${value}".`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UsageError(`--backend must use http or https, received "${parsed.protocol}".`);
  }
  return value.replace(/\/+$/, '');
}

function readTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new UsageError(`--timeout must be a whole number of milliseconds, received "${value}".`);
  }
  const parsed = Number.parseInt(value.trim(), 10);
  if (parsed < 1 || parsed > 600_000) {
    throw new UsageError('--timeout must be between 1 and 600000 milliseconds.');
  }
  return parsed;
}
