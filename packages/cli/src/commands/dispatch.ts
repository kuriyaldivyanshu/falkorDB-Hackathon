import { EXIT_FAILURE, EXIT_OK } from '../one-shot.js';

import { buildCommandCatalog, NO_SCOPE, type CommandServices, type HandlerContext, type TerminalScope } from './catalog.js';
import {
  CommandUsageError,
  generateHelp,
  parseCommandInput,
  type ParseOutcome,
} from './parse.js';
import { CommandRegistry, type CommandDefinition, type CommandContext } from './registry.js';

/**
 * Command dispatch (M05B08).
 *
 * The one rule this module exists to enforce: **an unknown slash command is never
 * anything else.** It does not become development echo, a model prompt or a
 * shell command. It produces a local usage error and, at most, the nearest names
 * so the typo can be corrected deliberately.
 *
 * Plain text is a separate, explicit case. Whether it becomes durable input is
 * decided by the injected `durableInput` handler, never here, so a missing
 * backend operation cannot silently fall back to echo.
 */

export interface DispatchContext {
  readonly capabilityFor?: CommandContext['capabilityFor'];
  readonly text: string;
  readonly argv: readonly string[];
  readonly write: (line: string) => void;
  /** Optional on-demand inspector sink; see `HandlerContext.inspect`. */
  readonly inspect?: (payload: unknown) => void;
  /**
   * The caller's established scope. Supplied by the host from its own
   * authenticated authority, so a handler never has to trust flags that
   * described a different run. Absent means no scope is established.
   */
  readonly scope?: TerminalScope;
}

export interface DispatchResult {
  readonly code: number;
  readonly kind: 'command' | 'plain-text' | 'unknown' | 'usage-error';
  readonly commandName?: string;
  readonly subcommand?: string | null;
  readonly exitRequested: boolean;
}

export interface TerminalCommands {
  readonly registry: CommandRegistry;
  dispatch(context: DispatchContext): Promise<DispatchResult>;
  /** Commands offered by completion; never includes a deferred command. */
  suggest(prefix: string, limit?: number): readonly string[];
  /** Renders `/help` from the registry. */
  help(): readonly string[];
}

export function createTerminalCommands(services: CommandServices, extra: readonly CommandDefinition[] = []): TerminalCommands {
  const definitions = [...buildCommandCatalog(services), ...extra];
  const registry = new CommandRegistry(definitions);

  return {
    registry,
    help() {
      return generateHelp(registry).map((line) =>
        `${line.usage.padEnd(34)} ${line.description}${line.aliases.length === 0 ? '' : `  (${line.aliases.join(', ')})`}\n${' '.repeat(36)}${line.kind} · ${line.milestone} · ${line.capabilityId ?? 'local'}`,
      );
    },
    suggest(prefix, limit = 12) {
      return registry.suggestNames(prefix, limit);
    },

    async dispatch(context) {
      let outcome: ParseOutcome;
      try {
        outcome = parseCommandInput(registry, context.text);
      } catch (error) {
        if (error instanceof CommandUsageError) {
          context.write(error.message);
          if (error.usage !== undefined) context.write(`usage: ${error.usage}`);
          return { code: EXIT_FAILURE, kind: 'usage-error', exitRequested: false };
        }
        throw error;
      }

      if (outcome.kind === 'unknown') {
        // Never dispatched, never echoed, never sent anywhere.
        context.write(`Unknown command "${outcome.text.split(/\s+/, 1)[0]}".`);
        if (outcome.nearest.length > 0) context.write(`did you mean: ${outcome.nearest.join(', ')}?`);
        context.write('Type /help for available commands.');
        return { code: EXIT_FAILURE, kind: 'unknown', exitRequested: false };
      }

      if (outcome.kind === 'plain-text') {
        if (context.text.trim().length === 0) return { code: EXIT_OK, kind: 'plain-text', exitRequested: false };
        const handler = services.durableInput;
        if (handler === undefined) {
          // Durable human input is the only acceptable meaning. Falling back to
          // echo would make unknown input look like successful agent work.
          context.write('Plain text has no durable input operation composed in this build.');
          context.write('  Use /send <text> once the input operation is available, or the CLI echo for development.');
          return { code: EXIT_FAILURE, kind: 'plain-text', exitRequested: false };
        }
        const commandContext: HandlerContext = {
          argv: [context.text], text: context.text, write: context.write,
          commandName: 'send', registry, subcommand: null,
          ...(context.inspect === undefined ? {} : { inspect: context.inspect }),
          scope: context.scope ?? NO_SCOPE,
          capabilityFor:context.capabilityFor,
        };
        const code = await handler(commandContext);
        return { code, kind: 'plain-text', commandName: 'send', exitRequested: false };
      }

      const { command, args } = outcome.parsed;
      const { subcommand } = outcome;
      if (command.phase === 'deferred') {
        // Deferred commands are documented, never run as stubs.
        context.write(`/${command.name} is deferred to ${command.milestone}: ${command.unavailableReason ?? 'not yet available'}`);
        return { code: EXIT_FAILURE, kind: 'command', commandName: command.name, subcommand, exitRequested: false };
      }

      const commandContext: HandlerContext = {
        argv: args, text: context.text, write: context.write,
        commandName: command.name, registry, subcommand,
        ...(context.inspect === undefined ? {} : { inspect: context.inspect }),
        scope: context.scope ?? NO_SCOPE,
        capabilityFor:context.capabilityFor,
      };
      const code = await command.handler(commandContext);
      return {
        code,
        kind: 'command',
        commandName: command.name,
        subcommand,
        exitRequested: command.name === 'quit',
      };
    },
  };
}