import type {OperationId} from '@threadline/shared';
import {
  CommandRegistryError,
  type CommandContext,
  type CommandRegistry,
  type RegisteredCommand,
} from './registry.js';

/**
 * Typed parsing and generated help for the command registry (M05B08).
 *
 * Parsing is bounded, typed and independent of shell parsing: nothing here
 * expands, interpolates or evals. A command whose arguments do not match its
 * declared syntax produces a usage error that quotes the registry's own
 * `argumentSyntax`, so the message cannot disagree with `/help`.
 *
 * An unknown slash command is a usage error. It is never dispatched, never sent
 * to the backend as echo, and never treated as a model prompt.
 */

export interface ParsedCommand {
  readonly command: RegisteredCommand;
  readonly args: readonly string[];
  /** The canonical usage line, for an error. */
  readonly usage: string;
}

export class CommandUsageError extends Error {
  constructor(message: string, readonly usage?: string) {
    super(message);
    this.name = 'CommandUsageError';
  }
}

/** Bounded so a pasted paragraph cannot become an unbounded argument list. */
export const MAX_COMMAND_ARGS = 8;
export const MAX_ARG_LENGTH = 512;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Argument kinds a command may declare, checked here rather than in each handler. */
export type ArgumentKind = 'text' | 'uuid' | 'decimal' | 'offset' | 'bytes' | 'query';

interface ArgumentSpec {
  readonly name: string;
  readonly required: boolean;
  readonly kind: ArgumentKind;
  /** Bounded numeric maximum, when the kind has one. */
  readonly maximum?: number;
  /**
   * Absorbs every remaining word into this one argument.
   *
   * Only the last spec may be variadic. It exists because free text is not a
   * fixed-arity argument list: `/send hello there` is one message, and rejecting
   * it for having three words would make durable input unreachable from a
   * terminal.
   */
  readonly variadic?: boolean;
}

const validate = (spec: ArgumentSpec, raw: string): string | null => {
  if (raw.length === 0) return `${spec.name} must not be empty`;
  if (raw.length > MAX_ARG_LENGTH) return `${spec.name} exceeds ${MAX_ARG_LENGTH} characters`;
  switch (spec.kind) {
    case 'uuid':
      return UUID_PATTERN.test(raw) ? null : `${spec.name} must be a uuid`;
    case 'decimal':
      return DECIMAL_PATTERN.test(raw) ? null : `${spec.name} must be a canonical decimal string`;
    case 'offset':
      return DECIMAL_PATTERN.test(raw) ? null : `${spec.name} must be a non-negative decimal`;
    case 'bytes': {
      if (!DECIMAL_PATTERN.test(raw)) return `${spec.name} must be a non-negative decimal`;
      const value = Number(raw);
      return value >= 1 && Number.isSafeInteger(value) && value <= 65_536 ? null : `${spec.name} must be between 1 and 65536`;
    }
    case 'query':
      return raw.trim().length >= 1 ? null : `${spec.name} must not be blank`;
    case 'text':
      return null;
  }
};

/**
 * Declared argument shapes per command name.
 *
 * Kept beside the registry rather than inside each handler so an arity or format
 * mistake is a single local edit, and so `/help` and dispatch share one truth.
 */
export const COMMAND_ARGUMENTS: Readonly<Record<string, readonly ArgumentSpec[]>> = {
  task: [{ name: 'id', required: false, kind: 'uuid' }],
  session: [{ name: 'id', required: false, kind: 'uuid' }],
  status: [],
  admit:[{name:'accepted-manifest-digest',required:false,kind:'text'}],
  // `[command|all]` is declared in the catalog, so it must be parseable here.
  help: [{ name: 'command', required: false, kind: 'text' }],
  hotkeys: [],
  model: [
    { name: 'query', required: false, kind: 'text' },
    { name: 'context-window', required: false, kind: 'decimal' },
    { name: 'max-output', required: false, kind: 'decimal' },
  ],
  run: [],
  checkpoint:[{name:'progress',required:true,kind:'text'},{name:'next-action',required:false,kind:'text'},{name:'base-revision',required:false,kind:'decimal'}],
  plan:[{name:'step-id',required:true,kind:'text'},{name:'status',required:true,kind:'text'},{name:'text',required:false,kind:'text'},{name:'base-revision',required:false,kind:'decimal'}],
  source: [
    { name: 'source-id', required: true, kind: 'uuid' },
    { name: 'offset', required: false, kind: 'offset' },
    { name: 'max-bytes', required: false, kind: 'bytes' },
  ],
  search: [{ name: 'query', required: true, kind: 'query',variadic:true }],
  history: [{ name: 'after-seq', required: false, kind: 'decimal' }],
  replay: [
    { name: 'epoch', required: true, kind: 'uuid' },
    { name: 'after-seq', required: false, kind: 'decimal' },
  ],
  context: [],
  compact: [],
  refresh: [],
  quit: [],
  send: [{ name: 'text', required: true, kind: 'text', variadic: true }],
};

export type ParseOutcome = {
  readonly kind: 'command';
  readonly parsed: ParsedCommand;
  /** Present when the command declares sub-commands such as `run prepare`. */
  readonly subcommand: string | null;
  readonly args: readonly string[];
} | {
  readonly kind: 'plain-text';
  readonly text: string;
} | {
  readonly kind: 'unknown';
  readonly text: string;
  readonly nearest: readonly string[];
};

/**
 * Parses one line of terminal input.
 *
 * A `/name sub args...` form is supported so `/run prepare` and `/task` read the
 * way the contract writes them, without giving any command a shell.
 */
export function parseCommandInput(registry: CommandRegistry, text: string): ParseOutcome {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: 'plain-text', text: '' };
  if (!trimmed.startsWith('/')) return { kind: 'plain-text', text: trimmed };

  const parts = tokenizeCommand(trimmed);
  const head = parts[0] ?? '';
  const command = registry.resolve(head);
  if (command === null) {
    // Unknown slash input is never dispatched. It is also never echo or a prompt.
    return { kind: 'unknown', text: trimmed, nearest: nearestNames(registry, head) };
  }

  const rest = parts.slice(1);
  let subcommand: string | null = null;
  let args: readonly string[] = rest;
  if (command.name === 'run') {
    if (rest.length === 0) {
      throw new CommandUsageError('"run" needs a subcommand: prepare, start, inspect or cancel.', '/run <prepare|start|inspect|cancel> [id]');
    }
    subcommand = rest[0] ?? null;
    args = rest.slice(1);
  }

  const specs: readonly ArgumentSpec[] = command.name==='run'
    ? [{name:subcommand==='start'?'confirmation':'id-or-window',required:false,kind:'text'}]
    : COMMAND_ARGUMENTS[command.name] ?? [];
  // A trailing variadic spec absorbs the rest of the line into one argument.
  const last = specs[specs.length - 1];
  if (last?.variadic === true && args.length > specs.length) {
    const head = args.slice(0, specs.length - 1);
    const joined = args.slice(specs.length - 1).join(' ');
    const bounded = validate(last, joined);
    if (bounded !== null) throw new CommandUsageError(`${bounded}.`, command.usage);
    args = [...head, joined];
  }
  if (args.length > MAX_COMMAND_ARGS) {
    throw new CommandUsageError(`"${command.name}" accepts at most ${MAX_COMMAND_ARGS} arguments, received ${args.length}.`, command.usage);
  }
  const required = specs.filter((spec) => spec.required).length;
  if (args.length < required) {
    const missing = specs.filter((spec) => spec.required)[args.length]?.name ?? 'an argument';
    throw new CommandUsageError(`"${command.name}" is missing ${missing}.`, command.usage);
  }
  if (args.length > specs.length) {
    throw new CommandUsageError(`"${command.name}" accepts ${specs.length} argument(s), received ${args.length}.`, command.usage);
  }
  for (const [index, spec] of specs.entries()) {
    const raw = args[index];
    if (raw === undefined) break;
    const problem = validate(spec, raw);
    if (problem !== null) throw new CommandUsageError(`${problem}.`, command.usage);
  }

  return {
    kind: 'command',
    parsed: { command, args, usage: command.usage },
    subcommand,
    args,
  };
}

/** Names sharing the typed prefix, so a typo can be corrected rather than guessed at. */
function nearestNames(registry: CommandRegistry, head: string): readonly string[] {
  const bare = head.replace(/^\//, '');
  return registry
    .available()
    .flatMap((command) => command.displayNames)
    .filter((name) => {
      const candidate = name.replace(/^\//, '');
      return candidate.startsWith(bare) || bare.startsWith(candidate);
    })
    .slice(0, 4);
}

export interface HelpLine {
  readonly usage: string;
  readonly description: string;
  readonly milestone: string;
  readonly capabilityId: OperationId | null;
  readonly kind: string;
  readonly aliases: readonly string[];
  readonly availability: string;
}

/** `/help` — available commands only, grouped by milestone. */
export function generateHelp(registry: CommandRegistry): readonly HelpLine[] {
  return registry
    .available()
    .slice()
    .sort((a, b) => a.milestone.localeCompare(b.milestone) || a.name.localeCompare(b.name))
    .map((command) => ({
      usage: command.usage,
      description: command.description,
      milestone: command.milestone,
      capabilityId: command.capabilityId,
      kind: command.kind,
      aliases: command.aliases,
      availability: 'available',
    }));
}

/** `/help all` — includes deferred commands with their phase and reason. */
export function generateHelpAll(registry: CommandRegistry): readonly HelpLine[] {
  return registry
    .all()
    .slice()
    .sort((a, b) => a.milestone.localeCompare(b.milestone) || a.name.localeCompare(b.name))
    .map((command) => ({
      usage: command.usage,
      description: command.description,
      milestone: command.milestone,
      capabilityId: command.capabilityId,
      kind: command.kind,
      aliases: command.aliases,
      availability: command.phase === 'available'
        ? 'available'
        : `deferred (${command.milestone}): ${command.unavailableReason ?? 'not yet available'}`,
    }));
}

/** `/help <command>` — one entry, deferred or not. */
export function generateHelpFor(registry: CommandRegistry, name: string): HelpLine | null {
  const command = registry.resolve(name);
  if (command === null) return null;
  return {
    usage: command.usage,
    description: command.description,
    milestone: command.milestone,
    capabilityId: command.capabilityId,
    kind: command.kind,
    aliases: command.aliases,
    availability: command.phase === 'available'
      ? 'available'
      : `deferred (${command.milestone}): ${command.unavailableReason ?? 'not yet available'}`,
  };
}

/** `/hotkeys` — the bindings this client actually implements. */
export function renderHotkeys(): readonly string[] {
  return [
    '/hotkeys — actual key bindings in this client',
    '  /            open the bounded command picker',
    '  Up / Down    move the selection inside the picker',
    '  Tab          accept the highlighted suggestion',
    '  Enter        submit the input; Tab accepts a suggestion',
    '  Esc          close a picker or form; exits only when nothing is open',
    '  Ctrl-C       cancel a form or draft; detaches with terminal restoration when idle',
    '  Ctrl-D       detach from the terminal',
    '  PageUp/Down  scroll bounded activity',
  ];
}

export { CommandRegistryError };
export type { CommandContext };
/** JSON-quoted arguments or literal words; no shell expansion or execution. */
export function tokenizeCommand(text:string):string[]{
 const result:string[]=[];let at=0;
 while(at<text.length){
  while(/\s/.test(text[at]??'')&&at<text.length)at++;
  if(at>=text.length)break;
  if(text[at]==='"'){
   const start=at++;let escaped=false;let ended=false;
   while(at<text.length){const c=text[at++];if(c==='"'&&!escaped){ended=true;break;}if(c==='\\'&&!escaped)escaped=true;else escaped=false;}
   if(!ended)throw new CommandUsageError('Unclosed quoted argument.');
   let value:unknown;try{value=JSON.parse(text.slice(start,at));}catch{throw new CommandUsageError('Use valid JSON quoting for an argument.');}
   if(typeof value!=='string')throw new CommandUsageError('A quoted argument must be text.');result.push(value);
   if(at<text.length&&!/\s/.test(text[at]!))throw new CommandUsageError('Separate arguments with spaces.');
  }else{const start=at;while(at<text.length&&!/\s/.test(text[at]!))at++;result.push(text.slice(start,at));}
 }
 return result;
}
