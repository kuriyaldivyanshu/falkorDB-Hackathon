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
  // Source inspection and durable replay (M03).
  offset: { type: 'string' },
  'max-bytes': { type: 'string' },
  epoch: { type: 'string' },
  'after-seq': { type: 'string' },
  limit: { type: 'string' },
  // Checkpoint and plan (M04). `task` already exists for run control.
  run: { type: 'string' },
  progress: { type: 'string' },
  'next-action': { type: 'string' },
  'base-revision': { type: 'string' },
  step: { type: 'string', multiple: true },
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
  | 'run:cancel'
  | 'source:inspect'
  | 'source:read'
  | 'history:replay'
  | 'tactical:inspect'
  | 'tactical:checkpoint'
  | 'tactical:plan';

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
  /** Source id for `source:inspect` / `source:read`. */
  readonly sourceId: string | null;
  /** Byte range for `source:read`; defaults to the start of the Source. */
  readonly sourceOffset: number | null;
  readonly sourceMaxBytes: number | null;
  /** Durable replay cursor for `history:replay`. */
  readonly replayEpoch: string | null;
  readonly replayAfterSeq: number | null;
  readonly replayLimit: number | null;
  /** Task id for the `tactical:*` commands. */
  readonly checkpointTaskId: string | null;
  /** Run that binds the checkpoint, when one exists. */
  readonly checkpointRunId: string | null;
  readonly checkpointProgress: string | null;
  readonly checkpointNextAction: string | null;
  /** Repeatable `--step stepId[:status][=text]`. */
  readonly checkpointSteps: readonly string[] | null;
  /** Decimal-string revision token. Never parsed as a number. */
  readonly checkpointBaseRevision: string | null;
  readonly help: boolean;
}

/** `capture_policy.graph_replay_batch_events` and the shared range ceiling. */
const REPLAY_MAX_PAGE = 100;
const SOURCE_ROUTE_MAX_BYTES = 32_768;

function readBoundedInteger(flag: string, raw: string | undefined, minimum: number, maximum: number): number {
  if (raw === undefined || !/^-?\d+$/.test(raw.trim())) {
    throw new UsageError(`${flag} needs a whole number.`);
  }
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`${flag} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function readReplaySeq(raw: string | undefined): number {
  const value = raw === undefined ? 0 : readBoundedInteger('--after-seq', raw, 0, Number.MAX_SAFE_INTEGER);
  return value;
}

function readReplayLimit(raw: string | undefined): number | null {
  return raw === undefined ? null : readBoundedInteger('--limit', raw, 1, REPLAY_MAX_PAGE);
}

/**
 * A revision token is carried as a decimal string end to end.
 *
 * It is validated, never converted. Passing `--base-revision 7` is refused so an
 * operator is not left believing a value was carried when it would have rounded.
 */
function readRevisionToken(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new UsageError('--base-revision must be a decimal string such as 7, not a number expression.');
  }
  const value = raw.trim();
  // Canonical form and a length bound only. A decimal string never rounds, so
  // there is no floating-point threshold here either.
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new UsageError('--base-revision must be a canonical decimal string with no sign or leading zeros.');
  }
  if (value.length > 32) {
    throw new UsageError('--base-revision exceeds the supported length of 32 digits.');
  }
  return value;
}

function hasAnyCheckpointInput(values: Record<string, unknown>): boolean {
  return ['progress', 'next-action', 'base-revision', 'step', 'run'].some((key) => values[key] !== undefined);
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
  source:inspect --project <uuid> <source-id>
                   Read one captured Source's typed state. Absent, pending and
                   unreadable are reported separately; no physical path is shown.
  source:read --project <uuid> <source-id> [--offset <n>] [--max-bytes <n>]
                   Read one bounded byte range, at most 32768 original bytes.
  history:replay --project <uuid> --epoch <uuid> --after-seq <n> [--limit <n>]
                   Request one bounded durable replay page. A gap is reported
                   with refresh guidance rather than skipped.

  tactical:inspect --project <uuid> --task <uuid>
                   Read the current checkpoint pointer, manifest, freshness,
                   coverage and plan. A revision is a decimal string.
  tactical:checkpoint --project <uuid> --task <uuid> [--run <id>]
                   [--progress <text>] [--next-action <text>] [--base-revision <n>]
                   Record progress and the next action. The durable operation
                   identity is kept in --request-record, so a retry reuses it.
  tactical:plan --project <uuid> --task <uuid> [--run <id>]
                   --step <stepId>[:<status>][=<text>] [--base-revision <n>]
                   Patch plan steps by stable id. Unrelated steps are preserved.

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
  --request-record <p>    Durable retry record (admission.json; checkpoint.json for tactical commands).
  --accept-fixture <s>    Explicit noninteractive acceptance of these exact bytes.
  -h, --help              Show this help.

Starting or inspecting a run requires a local owner session; without one the
backend refuses. No command on this client performs inference: run control only
requests that the backend do work it has already authorized.

Durable commands require a private local credential and a storage-ready backend:
  --project <uuid>            Target an authorized project.
  --request <uuid>            With inspect, read this admission receipt.
  --request-record <p>        Durable retry record (admission.json; checkpoint.json for tactical commands).
  --accept-fixture <sha256>   Explicit noninteractive acceptance of these exact bytes.

"echo" remains process-local and non-durable. Closing the CLI never stops the
backend or removes persisted data. Manage the backend process in its own terminal.`;

export function parseCliArgs(argv: readonly string[]): CliInvocation {
  // Wrapped rather than annotated so the literal option keys still infer.
  // `parseArgs` raises a TypeError for an unknown flag or an ambiguous value
  // such as `--offset -1`; both are usage problems and exit as one.
  // Wrapped rather than annotated so the literal option keys still infer.
  // `parseArgs` raises a TypeError for an unknown flag or an ambiguous value
  // such as `--offset -1`; both are usage problems and exit as one.
  const parse = () => parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: true, strict: true });
  const parsed = (() => {
    try {
      return parse();
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : 'The arguments could not be parsed.');
    }
  })();

  const { values, positionals } = parsed;
  const common = {
    projectId: values.project ?? null,
    requestId: values.request ?? null,
    requestRecordPath: values['request-record'] ?? (positionals[0]?.startsWith('tactical:') ? '.threadline/checkpoint.json' : '.threadline/admission.json'),
    acceptedFixtureDigest: values['accept-fixture'] ?? null,
    backendUrl: readBackendUrl(values.backend),
    requestTimeoutMs: readTimeout(values.timeout),
    fixtureManifestPath: values['fixture-manifest'] ?? DEFAULT_FIXTURE_MANIFEST_PATH,
    credentialPath: values.credential ?? DEFAULT_CREDENTIAL_PATH,
    sourceId: null as string | null,
    sourceOffset: null as number | null,
    sourceMaxBytes: null as number | null,
    replayEpoch: null as string | null,
    replayAfterSeq: null as number | null,
    replayLimit: null as number | null,
    checkpointTaskId: null as string | null,
    checkpointRunId: null as string | null,
    checkpointProgress: null as string | null,
    checkpointNextAction: null as string | null,
    checkpointSteps: null as readonly string[] | null,
    checkpointBaseRevision: null as string | null,
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

  if (name === 'tactical:inspect' || name === 'tactical:checkpoint' || name === 'tactical:plan') {
    const projectId = values.project;
    if (projectId === undefined || projectId.length === 0) {
      throw new UsageError(`"${name}" needs --project <uuid> and --task <uuid>.`);
    }
    const task = values.task;
    if (task === undefined || task.length === 0) {
      throw new UsageError(`"${name}" needs --task <uuid> so the backend can resolve scope.`);
    }
    if (positionals.length > 1) throw new UsageError(`"${name}" takes no positional arguments.`);
    const baseRevision = readRevisionToken(values['base-revision']);
    if (name === 'tactical:inspect' && hasAnyCheckpointInput(values)) {
      throw new UsageError('"tactical:inspect" reports state only; use tactical:checkpoint or tactical:plan to change it.');
    }
    const steps = values.step === undefined ? null : [...values.step];
    if (name !== 'tactical:plan' && steps !== null) {
      throw new UsageError(`--step is only valid for "tactical:plan".`);
    }
    return {
      ...common, command: name, echoText: null, start: null, runId: null, cancelReason: null,
      checkpointTaskId: task,
      checkpointRunId: values.run ?? null,
      checkpointProgress: values.progress ?? null,
      checkpointNextAction: values['next-action'] ?? null,
      checkpointSteps: steps,
      checkpointBaseRevision: baseRevision,
    };
  }

  if (name === 'source:inspect' || name === 'source:read' || name === 'history:replay') {
    const projectId = values.project;
    if (projectId === undefined || projectId.length === 0) {
      throw new UsageError(`"${name}" needs --project <uuid>, for example: threadline ${name} --project <uuid> <id>`);
    }
    // `name` is narrowed to the three M03 commands by the enclosing condition.
    const base = { command: name as CliCommand, echoText: null, start: null, runId: null, cancelReason: null, ...common };
    if (name === 'history:replay') {
      const epoch = values.epoch;
      if (epoch === undefined || epoch.length === 0) {
        throw new UsageError('"history:replay" needs --epoch <uuid> from a previously returned cursor.');
      }
      const afterSeq = readReplaySeq(values['after-seq']);
      const limit = readReplayLimit(values.limit);
      if (positionals.length > 1) throw new UsageError(`"${name}" takes no positional arguments.`);
      return { ...base, replayEpoch: epoch, replayAfterSeq: afterSeq, replayLimit: limit };
    }
    const sourceId = positionals[1];
    if (sourceId === undefined || sourceId.length === 0) {
      throw new UsageError(`"${name}" needs the source id, for example: threadline ${name} --project <uuid> <source-id>`);
    }
    if (positionals.length > 2) {
      throw new UsageError(`"${name}" takes one source id, received ${positionals.length - 2} extra arguments.`);
    }
    const offset = values.offset === undefined ? null : readBoundedInteger('--offset', values.offset, 0, Number.MAX_SAFE_INTEGER);
    const maxBytes = values['max-bytes'] === undefined ? null : readBoundedInteger('--max-bytes', values['max-bytes'], 1, SOURCE_ROUTE_MAX_BYTES);
    if (name === 'source:inspect' && (offset !== null || maxBytes !== null)) {
      throw new UsageError('"source:inspect" reports state only; use "source:read" for a byte range.');
    }
    return { ...base, sourceId, sourceOffset: offset, sourceMaxBytes: maxBytes };
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
