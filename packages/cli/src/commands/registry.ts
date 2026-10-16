/**
 * The terminal command registry (M05B08).
 *
 * One typed source for command discovery, parsing, help, hotkeys and completion.
 * Every human-facing command in the terminal comes from here, so `/help`,
 * suggestions and usage errors cannot drift from what actually dispatches.
 *
 * Each entry declares:
 *
 * - `name` and `aliases`, both capped and collision-checked at registration;
 * - `description` and `argumentSyntax`, so help and usage errors are generated
 *   rather than hand-written twice;
 * - `milestone`, the owning milestone, so a later command can be documented as
 *   deferred instead of being shown as enabled;
 * - `capabilityId`, the backend capability it depends on. `null` means the
 *   command is local and needs no round trip;
 * - `kind`, classifying what running it does — `local`, `read`, `mutation` or
 *   `inference`. Only `inference` may reach a provider, which is what keeps
 *   setup, selection, refresh and reconnect from being mistaken for work;
 * - `handler`, typed against the shared context so dispatch is exhaustive.
 *
 * **An unknown slash command is never a fallback.** The registry refuses to
 * build if two names collide, and the dispatcher returns a usage error for
 * anything it does not recognise. It never becomes echo, a model prompt or a
 * shell command.
 *
 * The registry holds no secrets and no business rules: handlers reference typed
 * clients that recheck authority server-side.
 */

import { OPERATION_CATALOGUE, OPERATION_ROUTES, type OperationEffect, type OperationId, type OperationCapability } from '@threadline/shared';

/** What running a command does. `inference` is the only kind that may bill. */
export type CommandKind = 'local' | 'read' | 'mutation' | 'inference';

export type CommandPhase = 'available' | 'deferred';

/**
 * Milestone that owns the command, shown by `/help all`.
 *
 * Deliberately a superset of the backend catalogue: the terminal contract names
 * commands for later milestones before their operations exist, and `/help all`
 * has to be able to label them.
 */
export type CommandMilestone = 'M01' | 'M02' | 'M03' | 'M04' | 'M05' | 'M06' | 'M07' | 'M08' | 'M09' | 'M10' | 'M11' | 'M12' | 'M13';

/** Maximum names/aliases per command, so a typo cannot create a near-duplicate. */
export const MAX_COMMAND_NAMES = 4;
export const MAX_NAME_LENGTH = 24;

export interface CommandContext {
  readonly capabilityFor?: (operationId: OperationId) => OperationCapability | null;
  readonly argv: readonly string[];
  /** The literal text the user typed, for `/send` and plain text. */
  readonly text: string;
  readonly write: (line: string) => void;
}

export interface CommandDefinition<TKind extends CommandKind = CommandKind> {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  /** Angle brackets required, square brackets optional. Shown verbatim in help. */
  readonly argumentSyntax?: string;
  readonly milestone: CommandMilestone;
  /**
   * The published backend operation this depends on, or `null` for a purely
   * local command. Taken from Agent A's `OPERATION_IDS`; a client never invents
   * an operation id, and never infers support from a lucky 404.
   */
  readonly capabilityId: OperationId | null;
  readonly kind: TKind;
  /** Set when the command cannot run yet; shown by `/help all`, never offered as usable. */
  readonly phase?: CommandPhase;
  readonly unavailableReason?: string;
  readonly handler: (context: CommandContext) => Promise<number>;
  /**
   * Whether this client has a real handler for the command.
   *
   * Distinct from backend availability: an operation can be published and
   * available on the backend while this client has no composed handler, and the
   * interface has to say so rather than offer a command that will refuse.
   */
  readonly composed?: boolean;
}

export class CommandRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRegistryError';
  }
}

/** A registered command with its display names resolved. */
export interface RegisteredCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly argumentSyntax: string;
  readonly milestone: CommandMilestone;
  readonly capabilityId: OperationId | null;
  readonly kind: CommandKind;
  /** True when the catalogue publishes a transport path for this operation. */
  readonly routed: boolean;
  /**
   * Milestone that shipped the *backend operation*, from the published
   * catalogue. It differs from `milestone` legitimately: the terminal command
   * surface lands in M05 while its operations shipped in M03/M04.
   */
  readonly operationMilestone: string | null;
  readonly operationEffect: OperationEffect | null;
  readonly phase: CommandPhase;
  readonly unavailableReason: string | null;
  /** False when this client has no composed handler, whatever the backend says. */
  readonly composed: boolean;
  /** `/name` plus declared aliases, longest first so prefix matching prefers the exact name. */
  readonly displayNames: readonly string[];
  /**
   * The typed handler. Kept on the registered entry rather than looked up
   * separately, so dispatch and discovery cannot name different things.
   */
  readonly handler: CommandDefinition['handler'];
  readonly usage: string;
}

const NAME_PATTERN = /^\/[a-z][a-z0-9-]*$/;

/** The published catalogue entry for an operation, when there is one. */
function catalogueOf(operationId: OperationId | null) {
  if (operationId === null) return null;
  return OPERATION_CATALOGUE.find((entry) => entry.operationId === operationId) ?? null;
}

export class CommandRegistry {
  private readonly byName = new Map<string, RegisteredCommand>();
  private readonly order: RegisteredCommand[] = [];

  constructor(definitions: readonly CommandDefinition[]) {
    for (const definition of definitions) this.add(definition);
  }

  /**
   * Registers one command.
   *
   * Collisions are refused rather than resolved: two commands claiming `/run`
   * is a defect that would otherwise dispatch to whichever won, which is exactly
   * the kind of quiet wrong behaviour this registry exists to prevent.
   */
  add(definition: CommandDefinition): RegisteredCommand {
    const names = ['/' + definition.name.replace(/^\//, ''), ...(definition.aliases ?? []).map((alias) => (alias.startsWith('/') ? alias : '/' + alias))];
    if (names.length > MAX_COMMAND_NAMES) {
      throw new CommandRegistryError(`"${definition.name}" declares ${names.length} names; at most ${MAX_COMMAND_NAMES} are allowed.`);
    }
    for (const candidate of names) {
      if (candidate.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(candidate)) {
        throw new CommandRegistryError(`"${candidate}" is not a usable command name.`);
      }
      const existing = this.byName.get(candidate);
      if (existing !== undefined) {
        throw new CommandRegistryError(`"${candidate}" is already claimed by "${existing.name}".`);
      }
    }
    if (definition.capabilityId !== null && OPERATION_ROUTES[definition.capabilityId] === undefined) {
      // Guards against a capability id that is not in the published catalogue.
      throw new CommandRegistryError(`"${definition.name}" names operation "${definition.capabilityId}", which is not published.`);
    }
    if (definition.phase !== 'deferred' && definition.unavailableReason !== undefined) {
      throw new CommandRegistryError(`"${definition.name}" is available, so it cannot carry an unavailableReason.`);
    }
    if (definition.phase === 'deferred' && definition.unavailableReason === undefined) {
      throw new CommandRegistryError(`"${definition.name}" is deferred, so it must say why.`);
    }
    if (definition.kind !== 'inference' && definition.capabilityId === null && definition.phase === 'deferred') {
      // Nothing to enforce here; kept explicit so the invariant is readable.
    }

    const usage = `/${definition.name}${definition.argumentSyntax === undefined ? '' : ` ${definition.argumentSyntax}`}`;
    const registered: RegisteredCommand = {
      name: definition.name,
      aliases: definition.aliases ?? [],
      description: definition.description,
      argumentSyntax: definition.argumentSyntax ?? '',
      milestone: definition.milestone,
      capabilityId: definition.capabilityId,
      kind: definition.kind,
      routed: definition.capabilityId !== null && (OPERATION_ROUTES[definition.capabilityId] ?? null) !== null,
      operationMilestone: catalogueOf(definition.capabilityId)?.milestone ?? null,
      operationEffect: catalogueOf(definition.capabilityId)?.effect ?? null,
      phase: definition.phase ?? 'available',
      unavailableReason: definition.unavailableReason ?? null,
      composed: definition.composed !== false,
      displayNames: [...names].sort((a, b) => b.length - a.length || a.localeCompare(b)),
      usage,
      handler: definition.handler,
    };
    for (const candidate of names) this.byName.set(candidate, registered);
    this.order.push(registered);
    return registered;
  }

  /** Resolves an exact `/name`. Returns `null` for anything unknown. */
  resolve(name: string): RegisteredCommand | null {
    const candidate = name.startsWith('/') ? name : `/${name}`;
    return this.byName.get(candidate) ?? null;
  }

  /** True when the text names a command this registry does not have. */
  isUnknownSlashInput(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return false;
    const head = trimmed.split(/\s+/, 1)[0] ?? '';
    return this.resolve(head) === null;
  }

  /** Every distinct command, in registration order. */
  all(): readonly RegisteredCommand[] {
    return this.order;
  }

  /** Commands offered in normal completion: available only, never deferred. */
  available(): readonly RegisteredCommand[] {
    return this.order.filter((command) => command.phase === 'available');
  }

  /** Prefix suggestions over available commands, bounded. */
  suggest(prefix: string, limit = 12): readonly RegisteredCommand[] {
    const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`;
    if (normalized === '/') return this.available().slice(0, limit);
    return this.available()
      .filter((command) => command.displayNames.some((name) => name.startsWith(normalized)))
      .slice(0, limit);
  }

  /**
   * Completion names for a prefix.
   *
   * Returns only the names that actually match, not every name of a command that
   * matched by alias: typing `/ta` should offer `/task` and `/tactical`, not the
   * unrelated alias `/checkpoint-state` that happens to share a prefix.
   */
  suggestNames(prefix: string, limit = 12): readonly string[] {
    const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`;
    const names: string[] = [];
    for (const command of this.available()) {
      for (const name of command.displayNames) {
        if (normalized === '/' || name.startsWith(normalized)) {
          names.push(name);
          if (names.length >= limit) return names;
        }
      }
    }
    return names;
  }

  /**
   * Cross-checks the catalog against Agent A's published operation catalogue.
   *
   * Returns problems rather than throwing, so `/help` can surface a mismatch
   * instead of the client silently carrying a command the backend cannot serve.
   */
  auditAgainstCatalogue(): readonly string[] {
    const problems: string[] = [];
    for (const command of this.order) {
      if (command.capabilityId === null) continue;
      const entry = OPERATION_CATALOGUE.find((candidate) => candidate.operationId === command.capabilityId);
      if (entry === undefined) { problems.push(`/${command.name} names unpublished operation ${command.capabilityId}`); continue; }
      // A command that claims read-only work but resolves to an inference-admitting
      // operation would be a real classification defect.
      const classifiedAsRead = command.kind === 'read' || command.kind === 'local';
      if (classifiedAsRead && entry.effect === 'inference_admitting') {
        problems.push(`/${command.name} is ${command.kind} but ${command.capabilityId} admits inference`);
      }
      if (command.kind === 'inference' && entry.effect !== 'inference_admitting') {
        problems.push(`/${command.name} is inference but ${command.capabilityId} is ${entry.effect}`);
      }
    }
    return problems;
  }
}

export type { CommandDefinition as TerminalCommandDefinition };