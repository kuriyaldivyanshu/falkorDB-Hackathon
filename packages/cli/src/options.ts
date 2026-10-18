import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

/**
 * Command-line surface of the Threadline client.
 *
 * The accepted commands are the memory product's operations. There is no TUI,
 * no provider setup, no run control and no fixture admission; a command that
 * does not exist is a usage error, and an operation that is not implemented in
 * this build is answered by the service as an explicit unsupported capability.
 *
 * Spelling follows one rule: a namespaced noun is written `noun:verb`
 * (`source:append`, `memory:correct`), a whole-object read repeats the noun
 * (`task:requirements`), and a process command is a bare word (`serve`, `mcp`).
 *
 * Every mutation requires a caller-supplied idempotency key. Mutations with a
 * head or revision to guard also require the caller's expected version or
 * revision — the CLI never derives an expected head, never invents an
 * idempotency key and never retries a guarded
 * mutation on its own. Content-bearing input arrives as one bounded JSON
 * document validated by the shared contract, rather than as a wide set of
 * loosely related flags.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/** A JSON input document is bounded so a command can never buffer a large file. */
export const MAX_INPUT_DOCUMENT_BYTES = 256 * 1024;
export const DEFAULT_OPERATION_WAIT_MS = 15_000;
export const MCP_DEFAULT_CONCURRENCY = 8;

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
  | 'task:create'
  | 'task:inspect'
  | 'task:require'
  | 'task:requirements'
  | 'memory:episode:record'
  | 'memory:propose'
  | 'memory:accept'
  | 'memory:correct'
  | 'memory:inspect'
  | 'memory:query'
  | 'context:prepare'
  | 'context:occurrence'
  | 'operation:inspect'
  | 'mcp'
  | 'codex:preview'
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
  title: { type: 'string' },
  family: { type: 'string' },
  memory: { type: 'string' },
  task: { type: 'string' },
  focus: { type: 'string' },
  version: { type: 'string' },
  'expect-current': { type: 'string' },
  'expect-revision': { type: 'string' },
  reason: { type: 'string' },
  'idempotency-key': { type: 'string' },
  input: { type: 'string' },
  wait: { type: 'boolean', default: false },
  'wait-timeout': { type: 'string' },
  'context-tools': { type: 'boolean', default: false },
  'context-hooks': { type: 'boolean', default: false },
  'workspace-root': { type: 'string' },
  'context-input': { type: 'string' },
  'hook-timeout-ms': { type: 'string' },
  'token-file': { type: 'string' },
  'codex-home': { type: 'string' },
  executable: { type: 'string' },
  entry: { type: 'string' },
  'timeout-ms': { type: 'string' },
  concurrency: { type: 'string' },
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

  /* Semantic memory and tasks. */
  readonly title: string | null;
  readonly family: string | null;
  readonly memoryId: string | null;
  readonly taskId: string | null;
  readonly focus: string | null;
  readonly versionId: string | null;
  /** `none` is the explicit "this memory has no head yet" expectation. */
  readonly expectCurrentVersionId: string | 'none' | null;
  readonly expectedTaskRevision: string | null;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  readonly input: string | null;
  readonly wait: boolean;
  readonly waitTimeoutMs: number | null;

  /* Read-only MCP server and configuration preview. */
  readonly contextTools: boolean;
  readonly contextHooks: boolean;
  readonly workspaceRoot: string | null;
  readonly contextInput: string | null;
  readonly hookTimeoutMs: number | null;
  readonly tokenFile: string | null;
  readonly codexHome: string | null;
  readonly executable: string | null;
  readonly entryScript: string | null;
  readonly timeoutMs: number | null;
  readonly concurrency: number | null;

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
  'task:create',
  'task:inspect',
  'task:require',
  'task:requirements',
  'memory:episode:record',
  'memory:propose',
  'memory:accept',
  'memory:correct',
  'memory:inspect',
  'memory:query',
  'context:prepare',
  'context:occurrence',
  'operation:inspect',
  'mcp',
  'codex:preview',
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

Tasks:
  task:create --project <id> --title <text> --idempotency-key <key>
                       Create a task. Options: --family <text>, --wait.
  task:inspect --project <id> <taskId>
                       Read one task with its requirement ids and opaque revision.
  task:require --project <id> <taskId> --memory <id> --expect-revision <token>
               --idempotency-key <key>
                       Bind one required memory to a task under the task revision
                       the caller last read.
  task:requirements --project <id> <taskId>
                       Resolve every required memory to its exact current version,
                       or report missing_current / duplicate_current explicitly.

Memory:
  memory:episode:record --input <file|-> [--wait]
                       Record one action and its outcome with sourced evidence.
                       The service decides evidence precision; an authored report
                       remains a proposal until explicitly accepted by a human.
  memory:propose --input <file|-> [--wait]
                       Propose a sourced candidate version. The JSON document is the
                       shared proposeMemoryInput contract and must cite at least one
                       source. A proposal governs nothing until a human accepts it.
  memory:accept --project <id> <memoryId> --version <versionId>
                --idempotency-key <key> --expect-current <versionId|none>
                [--reason <text>] [--wait]
                       Explicit human acceptance of one proposed version. This is the
                       only step that makes a proposal authoritative.
  memory:correct --project <id> --input <file|-> [--wait]
                       Supersede the current version with a new sourced one under the
                       expected head named in the document.
  memory:inspect --project <id> <memoryId>
                       Read one memory: its current version plus remaining candidates.
  memory:query --project <id> [--task <id>] [--kind <kind>] [--focus <text>]
               [--limit <n>]
                       Bounded current-memory read. hasMore is reported when the
                       bounded scan stopped early.

Context-only Codex hooks (explicit configuration, no capture):
  codex-hook SessionStart|UserPromptSubmit --home <absolute-dir> --project <uuid>
      --token-file <absolute-reader-file> --workspace-root <absolute-dir>
      --context-input <absolute-selector-file> [--hook-timeout-ms <250-5000>]
                       One bounded context JSON line or nothing; ordinary failures
                       exit 0. Default total deadline 2000 ms. See the hook guide.

Context (audited retrieval):
  context:prepare --input <file|-> [--project <id>] [--token-file <path>] [--json]
                       Prepare exact bounded context; records metadata, not delivery.
                       The document must supply its project and idempotency key.
  context:occurrence --input <file|-> [--project <id>] [--token-file <path>] [--json]
                       Explicit guarded delivery report, never native observation.

Operations:
  operation:inspect --project <id> <operationId>
                       Read one durable operation: pending, leased, ambiguous,
                       committed, rejected or cancelled, with its receipt.

Project-bound MCP server:
  mcp --project <id> [--token-file <path>] [--timeout-ms <n>] [--concurrency <n>]
      [--context-tools]
                       Serve the project's memory over stdio for an MCP client.
                       Default: six read-only tools. --context-tools adds audited
                       retrieval that records preparation metadata. Accepted knowledge
                       changes stay human CLI actions. Protocol output
                       goes to stdout; diagnostics go to stderr.

Codex configuration:
  codex:preview --project <id> [--codex-home <path>] [--executable <path>]
                [--entry <path>] [--context-tools]
                [--context-hooks --token-file <path> --workspace-root <path>
                 --context-input <path> --hook-timeout-ms <250-5000>]
                       Render the Codex profile that starts \`mcp\`. Writes nothing
                       and contains no credential. Options default to the isolated
                       Codex home, the running Node.js and this CLI's entry script.

  version              Print client and protocol versions.
  help                 Show this help.

Options:
  --home <dir>         Installation root (default: $THREADLINE_HOME or ~/.threadline).
  --port <n>           Override the service port for "serve".
  --json               Print machine-readable JSON instead of text.
  --wait               Follow a mutation to a settled operation state.
  --wait-timeout <ms>  Bound for --wait (default 15000).
  -h, --help           Show this help.

Exit status:
  0  success, or a committed operation
  1  refused, rejected or failed
  2  usage error
  3  the operation has no durable outcome yet (pending, leased or ambiguous)

Idempotency:
  Retry a mutation with the same --idempotency-key and the same payload to read
  the first admission back. Changing the payload under one key refuses.

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
    throw new UsageError('The arguments could not be parsed. Run threadline help for supported options.');
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

  const expectCurrentRaw = values['expect-current'];
  if (expectCurrentRaw !== undefined && expectCurrentRaw !== 'none' && expectCurrentRaw.length === 0) {
    throw new UsageError('--expect-current needs a version id, or the literal "none".');
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

    title: values.title ?? null,
    family: values.family ?? null,
    memoryId: values.memory ?? null,
    taskId: values.task ?? null,
    focus: values.focus ?? null,
    versionId: values.version ?? null,
    expectCurrentVersionId: expectCurrentRaw ?? null,
    expectedTaskRevision: values['expect-revision'] ?? null,
    reason: values.reason ?? null,
    idempotencyKey: values['idempotency-key'] ?? null,
    input: values.input ?? null,
    wait: values.wait,
    waitTimeoutMs: readInteger('--wait-timeout', values['wait-timeout'], 0, 600_000),

    contextTools: values['context-tools'],
    contextHooks: values['context-hooks'],
    workspaceRoot: values['workspace-root'] ?? null,
    contextInput: values['context-input'] ?? null,
    hookTimeoutMs: readInteger('--hook-timeout-ms', values['hook-timeout-ms'], 250, 5_000),
    tokenFile: values['token-file'] ?? null,
    codexHome: values['codex-home'] ?? null,
    executable: values.executable ?? null,
    entryScript: values.entry ?? null,
    timeoutMs: readInteger('--timeout-ms', values['timeout-ms'], 100, 120_000),
    concurrency: readInteger('--concurrency', values.concurrency, 1, 32),

    help: values.help,
  };

  requireSingleTarget(command, base);
  if (command === 'context:prepare' || command === 'context:occurrence') {
    const allowed = new Set(['home', 'input', 'project', 'token-file', 'json', 'help']);
    for (const flag of Object.keys(values)) {
      const occurrences = argv.filter((arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`));
      if (occurrences.length > 1) throw new UsageError('Context options must be supplied once.');
      if (!allowed.has(flag) && argv.some((arg) => arg === `--${flag}` || arg.startsWith(`--${flag}=`))) {
        throw new UsageError(`--${flag} is not accepted by context commands; use the strict input document.`);
      }
    }
    if (positionals.length !== 1) throw new UsageError('Context commands take no positional identity.');
  }
  if (base.contextTools && command !== 'mcp' && command !== 'codex:preview') {
    throw new UsageError('--context-tools belongs to mcp or codex:preview.');
  }

  if (base.contextHooks || base.workspaceRoot !== null || base.contextInput !== null || base.hookTimeoutMs !== null) {
    if (command !== 'codex:preview' || !base.contextHooks) throw new UsageError('Hook preview options require codex:preview --context-hooks.');
    requireOption('--home', values.home);
    requireOption('--token-file', values['token-file']);
    requireOption('--workspace-root', values['workspace-root']);
    requireOption('--context-input', values['context-input']);
  }

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
      requirePositionalId(command, positionals, 'sourceId');
      break;
    case 'history':
      requireOption('--project', values.project);
      break;

    case 'task:create':
      requireOption('--project', values.project);
      requireOption('--title', values.title);
      requireOption('--idempotency-key', values['idempotency-key']);
      break;
    case 'task:inspect':
    case 'task:requirements':
      requireOption('--project', values.project);
      requirePositionalId(command, positionals, 'taskId');
      break;
    case 'task:require':
      requireOption('--project', values.project);
      requirePositionalId(command, positionals, 'taskId');
      requireOption('--memory', values.memory);
      requireOption('--expect-revision', values['expect-revision']);
      requireOption('--idempotency-key', values['idempotency-key']);
      break;

    case 'context:prepare':
    case 'context:occurrence':
    case 'memory:episode:record':
    case 'memory:propose':
    case 'memory:correct':
      requireOption('--input', values.input);
      break;
    case 'memory:accept':
      requireOption('--project', values.project);
      requirePositionalId(command, positionals, 'memoryId');
      requireOption('--version', values.version);
      requireOption('--expect-current', values['expect-current']);
      requireOption('--idempotency-key', values['idempotency-key']);
      break;
    case 'memory:inspect':
      requireOption('--project', values.project);
      requirePositionalId(command, positionals, 'memoryId');
      break;
    case 'memory:query':
      requireOption('--project', values.project);
      break;
    case 'operation:inspect':
      requireOption('--project', values.project);
      requirePositionalId(command, positionals, 'operationId');
      break;

    case 'mcp':
      requireOption('--project', values.project);
      break;
    case 'codex:preview':
      requireOption('--project', values.project);
      break;

    default:
      if (positionals.length > 1) {
        throw new UsageError(`"${command}" takes no positional arguments, received ${String(positionals.length - 1)}.`);
      }
  }

  if (base.focus !== null && Buffer.byteLength(base.focus, 'utf8') > 1024) {
    throw new UsageError('--focus must be at most 1024 UTF-8 bytes.');
  }
  if (base.idempotencyKey !== null && Buffer.byteLength(base.idempotencyKey, 'utf8') > 200) {
    throw new UsageError('--idempotency-key must be at most 200 UTF-8 bytes.');
  }

  return base;
}

/** Commands that name exactly one identity positionally, and nothing else. */
function requirePositionalId(command: string, positionals: readonly string[], label: string): void {
  const value = positionals[1];
  if (value === undefined || value.length === 0) {
    throw new UsageError(
      `"${command}" needs the ${label}, for example: threadline ${command} --project <uuid> <${label}>`,
    );
  }
  if (positionals.length > 2) {
    throw new UsageError(`"${command}" takes one ${label}.`);
  }
}

/** Guards the one target each new command is allowed to carry. */
function requireSingleTarget(command: CliCommand, base: CliInvocation): void {
  if (base.wait && !MUTATING_COMMANDS.includes(command)) {
    throw new UsageError(`--wait applies to a mutation; "${command}" does not create one.`);
  }
  if (base.waitTimeoutMs !== null && !base.wait) {
    throw new UsageError('--wait-timeout needs --wait.');
  }
  if (base.input !== null && command !== 'memory:episode:record' && command !== 'memory:propose' && command !== 'memory:correct' && command !== 'context:prepare' && command !== 'context:occurrence') {
    throw new UsageError(`--input is only used by the content-bearing commands; "${command}" takes flags.`);
  }
  if (base.expectCurrentVersionId !== null && command !== 'memory:accept') {
    throw new UsageError('--expect-current belongs to memory:accept.');
  }
  if (base.expectedTaskRevision !== null && command !== 'task:require') {
    throw new UsageError('--expect-revision belongs to task:require.');
  }
  if (base.tokenFile !== null && command !== 'mcp' && command !== 'context:prepare' && command !== 'context:occurrence' && !(command === 'codex:preview' && base.contextHooks)) {
    throw new UsageError('--token-file belongs to mcp or context commands. A rendered preview never contains a credential.');
  }
}

const MUTATING_COMMANDS: readonly CliCommand[] = [
  'task:create',
  'task:require',
  'memory:episode:record',
  'memory:propose',
  'memory:accept',
  'memory:correct',
];

/** Recognize the hook before ordinary usage errors can return exit 2. */
export function isCodexHookInvocation(argv: readonly string[]): boolean {
  // Find the command without requiring later arguments to be well formed.
  // Known option values must not be mistaken for command names.
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--') return argv[index + 1] === 'codex-hook';
    if (!arg.startsWith('-')) return arg === 'codex-hook';
    const name = arg.slice(2).split('=')[0] as keyof typeof OPTION_SPEC;
    if (arg.startsWith('--') && !arg.includes('=') && OPTION_SPEC[name]?.type === 'string'
      && argv[index + 1] !== undefined && !argv[index + 1]?.startsWith('--')) index += 1;
  }
  return false;
}
