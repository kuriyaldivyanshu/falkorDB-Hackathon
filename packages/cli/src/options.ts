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

/**
 * The authored manifest, addressed by a configured development path.
 *
 * `archive/` is a working reference tree rather than a published package, so
 * the path is explicit and overridable instead of assumed.
 */
export const DEFAULT_FIXTURE_MANIFEST_PATH = 'archive/plans/contracts/fixture-manifest.json';

/** Owner-only local session credential. Never a database or provider secret. */
export const DEFAULT_CREDENTIAL_PATH = '.threadline/session.json';

const OPTION_SPEC = {
  backend: { type: 'string' },
  project: { type:'string' },
  request: { type:'string' },
  'request-record': { type:'string' },
  'accept-fixture': { type:'string' },
  timeout: { type: 'string' },
  'fixture-manifest': { type: 'string' },
  credential: { type: 'string' },
  'show-store-readiness': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

export type CliCommand = 'tui' | 'health' | 'echo' | 'fixture' | 'init' | 'admit' | 'inspect';

export interface CliInvocation {
  readonly command: CliCommand;
  readonly projectId: string | null;
  readonly requestId: string | null;
  readonly requestRecordPath: string;
  readonly acceptedFixtureDigest: string | null;
  readonly backendUrl: string;
  readonly requestTimeoutMs: number;
  /** Text for the `echo` command; `null` for every other command. */
  readonly echoText: string | null;
  readonly fixtureManifestPath: string;
  readonly credentialPath: string;
  /** Prints per-component store readiness after a successful health report. */
  readonly showStoreReadiness: boolean;
  readonly help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP_TEXT = `Threadline terminal client (M01)

Usage:
  threadline [options] <command> [arguments]

Commands:
  tui                 Terminal interface. Connects, streams events, sends commands.
  health              Print the backend health report, then exit.
  echo <text...>      Send one development.echo command and print its acknowledgement
                      and the matching backend event, then exit.
  fixture             Load the authored fixture manifest and print exactly what a
                      human would be accepting. No backend is contacted.

Options:
  --backend <url>         Backend base URL (default ${DEFAULT_BACKEND_URL}).
  --timeout <ms>          Per-request timeout in ms (default ${DEFAULT_REQUEST_TIMEOUT_MS}).
  --fixture-manifest <p>  Manifest to load (default ${DEFAULT_FIXTURE_MANIFEST_PATH}).
  --credential <p>        Local owner session credential (default ${DEFAULT_CREDENTIAL_PATH}).
  --show-store-readiness  Print per-component store readiness with health.
  -h, --help              Show this help.

Durable commands (require a private local credential and storage-ready backend):
  init       Validate the owner session and list authorized projects.
  admit      Preview and explicitly accept the initial fixture goal and criteria.
  inspect    Read current task/criteria/source authority, or a request receipt.
  --project <uuid>       Target an authorized project (auto-select only if exactly one).
  --request <uuid>       With inspect, read this admission receipt.
  --request-record <p>   Durable retry record (default .threadline/admission.json).
  --accept-fixture <sha256>  Explicit noninteractive acceptance of these exact manifest bytes.

"echo" remains process-local and non-durable. Closing the CLI never stops the
backend or removes persisted data. Manage the backend process in its own terminal.`;

export function parseCliArgs(argv: readonly string[]): CliInvocation {
  const parsed = parseArgs({
    args: [...argv],
    options: OPTION_SPEC,
    allowPositionals: true,
    strict: true,
  });

  const { values, positionals } = parsed;
  const common = {
    projectId: values.project ?? null,
    requestId: values.request ?? null,
    requestRecordPath: values['request-record'] ?? '.threadline/admission.json',
    acceptedFixtureDigest: values['accept-fixture'] ?? null,
    backendUrl: readBackendUrl(values.backend),
    requestTimeoutMs: readTimeout(values.timeout),
    fixtureManifestPath: values['fixture-manifest'] ?? DEFAULT_FIXTURE_MANIFEST_PATH,
    credentialPath: values.credential ?? DEFAULT_CREDENTIAL_PATH,
    showStoreReadiness: values['show-store-readiness'],
    help: values.help,
  };
  const name = positionals[0] ?? 'tui';

  if (name === 'tui' || name === 'health' || name === 'fixture' || name === 'init' || name === 'admit' || name === 'inspect') {
    if (positionals.length > 1) {
      throw new UsageError(`"${name}" takes no arguments, received ${positionals.length - 1}.`);
    }
    return { command: name, echoText: null, ...common };
  }

  if (name === 'echo') {
    const words = positionals.slice(1);
    if (words.length === 0) {
      throw new UsageError('"echo" needs the text to send, for example: threadline echo hello');
    }
    return { command: 'echo', echoText: words.join(' '), ...common };
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
