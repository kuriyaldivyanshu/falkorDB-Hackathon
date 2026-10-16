import { CommandRegistryError, type CommandContext, type CommandDefinition, type CommandRegistry } from './registry.js';

/**
 * The M05 terminal command catalog.
 *
 * Handlers receive an injected context so the catalog holds no transport and no
 * secrets. A command that has no real backend operation yet is declared
 * `deferred` with the reason, which is what `/help all` shows and what completion
 * never offers. Nothing here is enabled as a stub.
 */

/**
 * The caller's own scope, resolved by the host from its authenticated authority.
 *
 * A handler resolves scope from this rather than from CLI flags: the flags
 * describe one CLI run, while this describes the session the terminal is
 * actually attached to. Null means no scope is established yet, which handlers
 * must report as a refusal rather than fill in.
 */
export interface TerminalScope {
  readonly projectId: string | null;
  readonly taskId: string | null;
}

export const NO_SCOPE: TerminalScope = { projectId: null, taskId: null };

export interface HandlerContext extends CommandContext {
  /** Stable id for the catalog entry, used by the dispatcher. */
  readonly commandName: string;
  /** The registry this command came from, so `/help` generates from the same source. */
  readonly registry: CommandRegistry | null;
  /**
   * The parsed sub-command, for commands that declare one such as `run prepare`.
   *
   * The parser consumes it before validating arguments, so a handler reads it
   * here rather than from `argv`; `argv` holds only what follows it. Null for
   * commands that declare none, which is not the same as an empty sub-command.
   */
  readonly subcommand?: string | null;
  /** The caller's established scope, or null fields when none is established. */
  readonly scope?: TerminalScope;
  /**
   * Optional on-demand inspector sink.
   *
   * A handler that already fetched a structured view hands it here instead of
   * flattening it into text, so the host can render it without the catalog
   * owning any presentation state.
   */
  readonly inspect?: (payload: unknown) => void;
}

/** What a handler needs from the host application. */
export interface CommandServices {
  /** M04 durable admission: init/admit/task. */
  readonly durable?: (context: HandlerContext) => Promise<number>;
  readonly run?: (context: HandlerContext) => Promise<number>;
  readonly checkpoint?: (context: HandlerContext) => Promise<number>;
  readonly source?: (context: HandlerContext) => Promise<number>;
  readonly replay?: (context: HandlerContext) => Promise<number>;
  readonly status?: (context: HandlerContext) => Promise<number>;
  readonly session?: (context: HandlerContext) => Promise<number>;
  readonly model?: (context: HandlerContext) => Promise<number>;
  readonly connect?: (context: HandlerContext) => Promise<number>;
  readonly durableInput?: (context: HandlerContext) => Promise<number>;
  readonly recover?: (context: HandlerContext) => Promise<number>;
  /** M05.3 memory packet operations: refresh, context, compact, search. */
  readonly memory?: (context: HandlerContext) => Promise<number>;
}

/**
 * A declared command with no composed handler.
 *
 * It reports its own absence and exits non-zero. It never returns success and
 * never pretends the underlying operation happened, which is the failure mode a
 * silent no-op would introduce.
 */
const notComposed = (service: keyof CommandServices): ((context: HandlerContext) => Promise<number>) =>
  async (context) => {
    context.write(`/${context.commandName} is declared but its ${service} operation is not composed in this build.`);
    context.write('  This is a reported absence, not a successful no-op.');
    return 1;
  };

const pick = (services: CommandServices, key: keyof CommandServices) => services[key] ?? notComposed(key);

/** Whether a service key has a real handler composed for it. */
const composed = (services: CommandServices, key: keyof CommandServices): boolean => services[key] !== undefined;

export function buildCommandCatalog(services: CommandServices): readonly CommandDefinition[] {
  const def = (
    name: string,
    description: string,
    kind: CommandDefinition['kind'],
    handler: (context: HandlerContext) => Promise<number>,
    extra: Partial<CommandDefinition> = {},
  ): CommandDefinition => ({
    name,
    description,
    kind,
    milestone: 'M05',
    capabilityId: null,
    handler: handler as CommandDefinition['handler'],
    // Defaults to composed: a command that needs no service (help, status,
    // session, quit) has nothing to compose. Commands routed through a service
    // set it explicitly so the picker can tell "the backend offers this" from
    // "this client has a handler for it".
    composed: true,
    ...extra,
  });

  return [
    def('help', 'Show usage, phase and availability generated from the registry.', 'local',
      async (context) => {
        const { generateHelp, generateHelpAll, generateHelpFor } = await import('./parse.js');
        const registry = context.registry;
        if (registry === null) { context.write('The command registry is unavailable.'); return 1; }
        const display=(line:ReturnType<typeof generateHelp>[number])=>{
          if(!line.capabilityId||line.availability!=='available')return renderHelpLine(line);
          const entry=context.capabilityFor?.(line.capabilityId);
          let availability=entry?.available?'available':entry?.unavailability?.message??'backend availability not checked';
          if(line.capabilityId==='run.start'&&['run.prepare','run.inspect','run.cancel'].some(id=>context.capabilityFor?.(id as 'run.prepare'|'run.inspect'|'run.cancel')?.available))availability='inspect/cancel available; prepare/start require their own current guards';
          return renderHelpLine({...line,availability});
        };
        const argument = context.argv[0];
        if (argument === 'all') {
          for (const line of generateHelpAll(registry)) context.write(display(line));
          return 0;
        }
        if (argument !== undefined) {
          const single = generateHelpFor(registry, argument);
          if (single === null) { context.write(`No command matches "${argument}". Try /help all.`); return 1; }
          context.write(display(single));
          return 0;
        }
        for (const line of generateHelp(registry)) context.write(display(line));
        return 0;
      }, { argumentSyntax: '[command|all]' }),

    def('hotkeys', 'Show the key bindings this client actually implements.', 'local',
      async (context) => {
        const { renderHotkeys } = await import('./parse.js');
        for (const line of renderHotkeys()) context.write(line);
        return 0;
      }),

    def('status', 'Readiness, selected project/task, run/session, provider route and observed usage.', 'read',
      pick(services, 'status'), { capabilityId: 'status', milestone: 'M02' }),

    def('session', 'Inspect authorized session identity, lifecycle and revisions.', 'read',
      pick(services, 'session'), { argumentSyntax: '[id]', capabilityId: 'session' }),

    def('connect', 'Attach or reconfigure a provider using masked setup.', 'local',
      pick(services, 'connect'), { aliases: ['/provider'], argumentSyntax: '[provider]', capabilityId: 'connect', milestone: 'M04' }),

    def('model', 'List configured models; /model choose opens a form for prospective selection.', 'mutation',
      pick(services, 'model'), { argumentSyntax: '[provider/model <context-window> <max-output>]', capabilityId: 'model.select', composed: composed(services, 'model') }),

    def('init', 'Attach the local owner through the existing bootstrap rules.', 'mutation',
      pick(services, 'durable'), { capabilityId: 'init', milestone: 'M01' }),

    def('admit', 'Preview the authored fixture goal and obtain explicit acceptance.', 'mutation',
      pick(services, 'durable'), { argumentSyntax:'[accepted-manifest-digest]', capabilityId: 'admit.accept', milestone: 'M01' }),

    def('task', 'Inspect the accepted goal, criteria, versions and Source links.', 'read',
      pick(services, 'durable'), { argumentSyntax: '[id]', capabilityId: 'task.inspect', milestone: 'M01' }),

    def('run', 'Prepare, start, inspect or cancel a run.', 'inference',
      pick(services, 'run'), { argumentSyntax: '<prepare|start|inspect|cancel> [id]', capabilityId: 'run.start', milestone: 'M02' }),
    // `/run inspect` and `/run cancel` are reads/mutations against other
    // operations; the classifier below narrows the sub-command at dispatch.

    def('tactical', 'Show the current plan, progress, blockers and freshness.', 'read',
      pick(services, 'checkpoint'), { aliases: ['/checkpoint-state'], capabilityId: 'tactical.inspect' }),

    def('checkpoint', 'Record bounded progress and the next action.', 'mutation',
      pick(services, 'checkpoint'), { argumentSyntax:'<progress> [next-action]', capabilityId: 'checkpoint.submit' }),

    def('plan', 'Patch bounded plan steps by stable id.', 'mutation',
      pick(services, 'checkpoint'), { argumentSyntax:'<step-id> <status> [text]', capabilityId: 'checkpoint.submit' }),

    def('recover', 'Run a bounded checkpoint-tail recovery scan.', 'mutation',
      pick(services, 'recover'), { capabilityId: 'recover' }),

    def('refresh', 'Rebuild the current bounded memory packet without starting inference.', 'mutation',
      pick(services, 'memory'), { capabilityId: 'context.refresh', composed: composed(services, 'memory') }),

    def('context', 'Inspect the current packet, versions, inclusions, omissions and budget.', 'read',
      pick(services, 'memory'), { capabilityId: 'context.inspect', composed: composed(services, 'memory') }),

    def('compact', 'Rebuild bounded working history plus the current packet.', 'mutation',
      pick(services, 'memory'), { capabilityId: 'context.compact', composed: composed(services, 'memory') }),

    def('search', 'Bounded task-relevant recall with authorized Source references.', 'read',
      pick(services, 'memory'), { argumentSyntax: '<query>', capabilityId: 'memory.search', composed: composed(services, 'memory') }),

    def('source', 'Inspect a Source, then read a bounded authorized range.', 'read',
      pick(services, 'source'), { argumentSyntax: '<source-id> [offset] [max-bytes]', capabilityId: 'source.range', composed: composed(services, 'source') }),

    def('history', 'Bounded selected-project history with an explicit cursor.', 'read',
      pick(services, 'replay'), { argumentSyntax: '[after-seq]', capabilityId: 'history.list', composed: composed(services, 'replay') }),

    def('replay', 'Replay from a durable cursor; gaps stay visible.', 'read',
      pick(services, 'replay'), { argumentSyntax: '<epoch> [after-seq]', capabilityId: 'history.replay', composed: composed(services, 'replay') }),

    // `mutation`, not `inference`: submitting durable human input records an
    // operator action and starts no model work. The catalogue audit enforces this.
    def('send', 'Submit text as durable human input, explicitly.', 'mutation',
      pick(services, 'durableInput'), { argumentSyntax: '<text>',
        // `input.submit` is the published operation for durable human input, so
        // `/send` names it rather than claiming an unnamed capability.
        capabilityId: 'input.submit',
        composed: composed(services, 'durableInput') }),

    def('quit', 'Detach from the terminal, preserving backend work and data.', 'local',
      async (context) => {
        context.write('Detaching from the terminal. The backend and all persisted work remain.');
        return 0;
      }),
  ];
}

function renderHelpLine(line: { usage: string; description: string; milestone: string; kind: string; aliases: readonly string[]; availability: string; capabilityId: string | null }): string {
  const alias = line.aliases.length === 0 ? '' : `  (aliases: ${line.aliases.join(', ')})`;
  const capability = line.capabilityId === null ? 'local' : line.capabilityId;
  return `${line.usage.padEnd(34)} ${line.description}${alias}\n${' '.repeat(36)}${line.kind} · ${line.milestone} · ${capability} · ${line.availability}`;
}

export { CommandRegistryError };
export type { CommandRegistry };