import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

/**
 * Command-line surface of the Threadline client.
 *
 * The accepted commands are the memory product's operations. There is no TUI,
 * no provider setup, no run control and no fixture admission; a command that
 * does not exist is a usage error, and an operation that is not implemented in
 * this build is answered by the service as an explicit unsupported capability.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type CliCommand =
  | 'init'
  | 'serve'
  | 'status'
  | 'capabilities'
  | 'project:add'
  | 'project:list'
  | 'project:grants'
  | 'source:append'
  | 'source:inspect'
  | 'source:read'
  | 'history'
  | 'version'
  | 'help';

const OPTION_SPEC = {
  home: { type: 'string' },
  port: { type: 'string' },
  root: { type: 'string' },
  label: { type: 'string' },
  join: { type: 'string' },
  project: { type: 'string' },
  kind: { type: 'string' },
  file: { type: 'string' },
  origin: { type: 'string' },
  revision: { type: 'string' },
  delivery: { type: 'string' },
  'media-type': { type: 'string' },
  visibility: { type: 'string' },
  offset: { type: 'string' },
  'max-bytes': { type: 'string' },
  limit: { type: 'string' },
  kinds: { type: 'string' },
  session: { type: 'string' },
  cursor: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

export interface CliInvocation {
  readonly command: CliCommand;
  readonly home: string | undefined;
  readonly port: number | undefined;
  readonly json: boolean;
  readonly root: string | null;
  readonly label: string | null;
  readonly joinProjectId: string | null;
  readonly projectId: string | null;
  readonly kind: string | null;
  readonly file: string | null;
  readonly origin: string | null;
  readonly revision: string | null;
  readonly delivery: string | null;
  readonly mediaType: string | null;
  readonly visibility: 'project' | 'principal' | null;
  readonly sourceId: string | null;
  readonly offset: number | null;
  readonly maxBytes: number | null;
  readonly limit: number | null;
  readonly kinds: readonly string[] | null;
  readonly nativeSessionId: string | null;
  readonly cursor: string | null;
  readonly help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const SHELL_COMMANDS: readonly CliCommand[] = [
  'init',
  'serve',
  'status',
  'capabilities',
  'project:add',
  'project:list',
  'project:grants',
  'source:append',
  'source:inspect',
  'source:read',
  'history',
  'version',
  'help',
];

export const HELP_TEXT = `Threadline — Codex-first local memory and coordination

Usage:
  threadline [options] <command> [arguments]

Service:
  init                 Initialize this installation: apply the memory schema, create
                       the local owner credential and record configuration.
  serve                Run the local memory service in this terminal. Codex owns
                       inference; this process only stores and serves memory.
  status               Print service health, component readiness and storage state.
  capabilities         List the operations this build actually supports. Everything
                       not listed as supported is explicitly unavailable.

Projects:
  project:add --root <path>            Associate a workspace root with a project.
                                       Options: --label <text>, --join <projectId>.
  project:list                         List projects this credential can access.
  project:grants --project <id>        List grants for one project.

Sources and history:
  source:append --project <id> --kind <kind> --file <path>
                       Append one authored or captured record. Delivery identity is
                       derived from the file content unless --delivery is given;
                       repeating it is stable, changing the bytes refuses.
                       Options: --origin <key>, --revision <rev>, --media-type <type>,
                       --visibility project|principal.
  source:inspect --project <id> <sourceId>
                       Read one source catalog entry. No bytes are shown.
  source:read --project <id> <sourceId> [--offset <n>] [--max-bytes <n>]
                       Read one bounded byte range; default writes the decoded text
                       to stdout. At most 32768 original bytes per read.
  history --project <id> [--limit <n>] [--kinds a,b] [--session <id>] [--cursor <c>]
                       Page through ingested sources in project order. The cursor
                       is opaque; changing filters starts a new page.

  version              Print client and protocol versions.
  help                 Show this help.

Options:
  --home <dir>         Installation root (default: $THREADLINE_HOME or ~/.threadline).
  --port <n>           Override the service port for "serve".
  --json               Print machine-readable JSON instead of text.
  -h, --help           Show this help.

The service is loopback-only. Credentials live in the installation root; nothing
here reads a coding repository's .env file.`;

function readInteger(flag: string, raw: string | undefined, minimum: number, maximum: number): number | null {
  if (raw === undefined) {
    return null;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new UsageError(`${flag} needs a whole number.`);
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`${flag} must be between ${String(minimum)} and ${String(maximum)}.`);
  }
  return parsed;
}

function requireOption(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new UsageError(`${flag} is required.`);
  }
  return value;
}

export function parseCliArgs(argv: readonly string[]): CliInvocation {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTION_SPEC; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'The arguments could not be parsed.');
  }
  const { values, positionals } = parsed;

  const name = positionals[0] ?? 'help';
  if (!(SHELL_COMMANDS as readonly string[]).includes(name)) {
    throw new UsageError(`Unknown command "${name}". Run "threadline help" for the supported commands.`);
  }
  const command = name as CliCommand;

  const visibilityRaw = values.visibility;
  if (visibilityRaw !== undefined && visibilityRaw !== 'project' && visibilityRaw !== 'principal') {
    throw new UsageError('--visibility must be "project" or "principal".');
  }

  const base: CliInvocation = {
    command,
    home: values.home,
    port: readInteger('--port', values.port, 1, 65_535) ?? undefined,
    json: values.json,
    root: values.root ?? null,
    label: values.label ?? null,
    joinProjectId: values.join ?? null,
    projectId: values.project ?? null,
    kind: values.kind ?? null,
    file: values.file ?? null,
    origin: values.origin ?? null,
    revision: values.revision ?? null,
    delivery: values.delivery ?? null,
    mediaType: values['media-type'] ?? null,
    visibility: visibilityRaw === undefined ? null : visibilityRaw,
    sourceId: positionals[1] ?? null,
    offset: readInteger('--offset', values.offset, 0, Number.MAX_SAFE_INTEGER),
    maxBytes: readInteger('--max-bytes', values['max-bytes'], 1, 32_768),
    limit: readInteger('--limit', values.limit, 1, 100),
    kinds:
      values.kinds === undefined
        ? null
        : values.kinds
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
    nativeSessionId: values.session ?? null,
    cursor: values.cursor ?? null,
    help: values.help,
  };

  switch (command) {
    case 'project:add':
      requireOption('--root', values.root);
      break;
    case 'project:grants':
      requireOption('--project', values.project);
      break;
    case 'source:append':
      requireOption('--project', values.project);
      requireOption('--kind', values.kind);
      requireOption('--file', values.file);
      break;
    case 'source:inspect':
    case 'source:read':
      requireOption('--project', values.project);
      if (positionals[1] === undefined || positionals[1].length === 0) {
        throw new UsageError(`"${command}" needs the source id, for example: threadline ${command} --project <uuid> <sourceId>`);
      }
      if (positionals.length > 2) {
        throw new UsageError(`"${command}" takes one source id.`);
      }
      break;
    case 'history':
      requireOption('--project', values.project);
      break;
    default:
      if (positionals.length > 1) {
        throw new UsageError(`"${command}" takes no positional arguments, received ${String(positionals.length - 1)}.`);
      }
  }

  return base;
}
