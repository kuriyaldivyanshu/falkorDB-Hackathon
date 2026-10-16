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
  backend: { type:'string' },
  project: { type:'string' },
  request: { type:'string' },
  'request-record': { type:'string' },
  'accept-fixture': { type:'string' },
  // Run control (M02). Every identity is supplied explicitly; none is inferred.
  task: { type: 'string' },
  profile: { type: 'string' },
  workspace: { type: 'string' },
  'context-window': { type: 'string' },
  'request-id': { type: 'string' },
  'expect-revision': { type: 'string' },
  'expect-requirement-revision': { type: 'string' },
  reason: { type: 'string' },
  timeout: { type: 'string' },
  'fixture-manifest': { type: 'string' },
  credential: { type: 'string' },
  'show-store-readiness': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

export type CliCommand =
  | 'provider:setup'
  | 'provider:list'
  | 'tui'
  | 'health'
  | 'echo'
  | 'fixture'
  | 'init'
  | 'admit'
  | 'inspect'
  | 'run:prepare'
  | 'run:start'
  | 'run:inspect'
  | 'run:cancel';

/** The full identity needed to start one run. Nothing here is defaulted. */
export interface StartRunRequest {
  readonly projectId: string;
  readonly requestId: string;
  readonly taskId: string;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly expectedRequirementRevision: number;
}

export interface CliInvocation {
  readonly contextWindowTokens: number | null;
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
  readonly start: StartRunRequest | null;
  /** Run id for `run:inspect` / `run:cancel`. */
  readonly runId: string | null;
  readonly cancelReason: string | null;
  readonly help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const HELP_TEXT = `Threadline terminal client (M02)

Usage:
  threadline [options] <command> [arguments]

Commands:
  tui                 Terminal interface. Connects, streams events, sends commands.
  health              Print the backend health report, then exit.
  provider:setup     Choose a provider, enter a masked key and validate/save it.
  provider:list      Show saved provider metadata without keys.
  echo <text...>      Send one development.echo command and print its acknowledgement
                      and the matching backend event, then exit.
  fixture             Load the authored fixture manifest and print exactly what a
                      human would be accepting. No backend is contacted.
  init                Validate the owner session and list authorized projects.
  admit               Preview and explicitly accept the initial fixture goal/criteria.
  inspect             Read current task/criteria/source authority, or a receipt.
  run:prepare         Prepare real profile/candidate IDs without inference. Requires
                      --project and --context-window (declared model capacity).
  run:start           Ask the backend to start one Builder run. Requires --project,
                      --task, --profile, --workspace, --request-id and both
                      expected revisions. Nothing is inferred.
  run:inspect <id>   Read the backend's durable run, claim, budget and attempts.
  run:cancel <id>    Request cancellation. An acknowledgement is not proof that
                      provider compute stopped.

Options:
  --backend <url>         Backend base URL (default ${DEFAULT_BACKEND_URL}).
  --timeout <ms>          Per-request timeout in ms (default ${DEFAULT_REQUEST_TIMEOUT_MS}).
  --fixture-manifest <p>  Manifest to load (default ${DEFAULT_FIXTURE_MANIFEST_PATH}).
  --credential <p>        Local owner session credential (default ${DEFAULT_CREDENTIAL_PATH}).
  --show-store-readiness  Print per-component store readiness with health.
  --project <id>          Target project for run:start.
  --task <id>             Accepted task id for run:start.
  --profile <id>          Provider profile id for run:start.
  --workspace <id>        Registered candidate workspace id for run:start.
  --request-id <uuid>     Durable idempotency key for run:start. Reuse on retry.
  --expect-revision <n>   Optimistic concurrency against current authority.
  --expect-requirement-revision <n>  Optimistic concurrency for requirements.
  --reason <text>         Cancellation reason recorded by the backend.
  --request <uuid>        With inspect, read this admission receipt.
  --request-record <p>    Durable retry record (default .threadline/admission.json).
  --accept-fixture <s>    Explicit noninteractive acceptance of these exact bytes.
  -h, --help              Show this help.

Starting or inspecting a run requires a local owner session; without one the
backend refuses. No command on this client performs inference: run control only
requests that the backend do work it has already authorized.

Durable commands require a private local credential and a storage-ready backend:
  --project <uuid>            Target an authorized project.
  --request <uuid>            With inspect, read this admission receipt.
  --request-record <p>        Durable retry record (default .threadline/admission.json).
  --accept-fixture <sha256>   Explicit noninteractive acceptance of these exact bytes.

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
    contextWindowTokens: values['context-window'] === undefined ? null : readRevision('--context-window', values['context-window']),
    help: values.help,
  };
  const name = positionals[0] ?? 'tui';

  if (name === 'run:prepare') {
    requireOption('--project', values.project);
    readRevision('--context-window', values['context-window']);
    return { ...common, command: name, echoText: null, start: null, runId: null, cancelReason: null };
  }

  if (name === 'run:start') {
    return {
      command: name,
      echoText: null,
      start: readStartRequest(values),
      runId: null,
      cancelReason: null,
      ...common,
    };
  }

  if (name === 'run:inspect' || name === 'run:cancel') {
    const runId = positionals[1];
    if (runId === undefined || runId.length === 0) {
      throw new UsageError(`"${name}" needs the run id, for example: threadline ${name} <run-id>`);
    }
    if (positionals.length > 2) {
      throw new UsageError(`"${name}" takes one run id, received ${positionals.length - 2} extra arguments.`);
    }
    return {
      command: name,
      echoText: null,
      start: null,
      runId,
      cancelReason: name === 'run:cancel' ? requireOption('--reason', values.reason) : null,
      ...common,
    };
  }

  if (name === 'provider:setup' || name === 'provider:list' || name === 'tui' || name === 'health' || name === 'fixture' || name === 'init' || name === 'admit' || name === 'inspect') {
    if (positionals.length > 1) {
      throw new UsageError(`"${name}" takes no arguments, received ${positionals.length - 1}.`);
    }
    return { command: name, echoText: null, start: null, runId: null, cancelReason: null, ...common };
  }

  if (name === 'echo') {
    const words = positionals.slice(1);
    if (words.length === 0) {
      throw new UsageError('"echo" needs the text to send, for example: threadline echo hello');
    }
    return { command: 'echo', echoText: words.join(' '), start: null, runId: null, cancelReason: null, ...common };
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

function requireOption(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new UsageError(`${flag} is required.`);
  }
  return value;
}

function readStartRequest(values: {
  project?: string | undefined;
  task?: string | undefined;
  profile?: string | undefined;
  workspace?: string | undefined;
  'request-id'?: string | undefined;
  'expect-revision'?: string | undefined;
  'expect-requirement-revision'?: string | undefined;
}): StartRunRequest {
  return {
    projectId: requireOption('--project', values.project),
    requestId: requireOption('--request-id', values['request-id']),
    taskId: requireOption('--task', values.task),
    profileId: requireOption('--profile', values.profile),
    workspaceId: requireOption('--workspace', values.workspace),
    expectedRevision: readRevision('--expect-revision', values['expect-revision']),
    expectedRequirementRevision: readRevision('--expect-requirement-revision', values['expect-requirement-revision']),
  };
}

function readRevision(flag: string, value: string | undefined): number {
  const raw = requireOption(flag, value);
  if (!/^\d+$/.test(raw.trim())) {
    throw new UsageError(`${flag} must be a non-negative integer, received "${raw}".`);
  }
  return Number.parseInt(raw.trim(), 10);
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
