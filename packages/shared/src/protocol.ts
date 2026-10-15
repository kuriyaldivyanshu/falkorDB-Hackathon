import type { GoalAdmissionInput, GoalAdmissionResult } from './admission.js';
import type { ThreadlineErrorPayload } from './errors.js';
import type { CommandId, EchoId } from './ids.js';

/**
 * Wire contract version. Incremented only when an existing field changes
 * meaning or is removed. Clients send the version they were built against and
 * the backend refuses a mismatch instead of guessing.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Durability label carried by every development-only result and event so no
 * client can mistake an in-memory acknowledgement for durable work.
 */
export const DEVELOPMENT_DURABILITY = 'development-only' as const;

export type DevelopmentDurability = typeof DEVELOPMENT_DURABILITY;

export interface DevelopmentEchoInput {
  readonly text: string;
}

export interface DevelopmentEchoResult {
  readonly echoId: EchoId;
  readonly text: string;
  readonly acceptedAt: string;
  readonly durability: DevelopmentDurability;
}

/**
 * The command registry. Adding a name here is the only way a client can reach a
 * domain operation; unknown names are rejected at the boundary.
 */
export interface CommandMap {
  readonly 'development.echo': {
    readonly input: DevelopmentEchoInput;
    readonly result: DevelopmentEchoResult;
  };
  readonly 'task.accept_goal': {
    readonly input: GoalAdmissionInput;
    readonly result: GoalAdmissionResult;
  };
}

export type CommandName = keyof CommandMap;

export type CommandInput<C extends CommandName> = CommandMap[C]['input'];

export type CommandResult<C extends CommandName> = CommandMap[C]['result'];

/** Client request body. Unknown fields are rejected rather than ignored. */
export interface CommandRequest<C extends CommandName = CommandName> {
  readonly protocolVersion: number;
  readonly command: C;
  readonly input: CommandInput<C>;
}

export type CommandSuccess<C extends CommandName> = {
  readonly ok: true;
  readonly protocolVersion: number;
  readonly commandId: CommandId;
  readonly receivedAt: string;
  readonly result: CommandResult<C>;
};

export type CommandFailure = {
  readonly ok: false;
  readonly protocolVersion: number;
  /** Null when the request was rejected before a command identity existed. */
  readonly commandId: CommandId | null;
  readonly receivedAt: string;
  readonly error: ThreadlineErrorPayload;
};

export type CommandResponse<C extends CommandName = CommandName> =
  | CommandSuccess<C>
  | CommandFailure;

/** HTTP status paired with the body, produced by the dispatcher not the route. */
export interface CommandOutcome<C extends CommandName = CommandName> {
  readonly status: number;
  readonly body: CommandResponse<C>;
}

/**
 * Narrows a command result to the development echo shape without a cast.
 *
 * `CommandSuccess` carries the union of every registered result, so a client
 * needs a guard rather than a discriminated field. This is additive: the
 * existing envelope shapes are unchanged.
 */
export function isDevelopmentEchoResult(value: unknown): value is DevelopmentEchoResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { echoId?: unknown }).echoId === 'string' &&
    typeof (value as { durability?: unknown }).durability === 'string'
  );
}

export function isCommandName(value: unknown): value is CommandName {
  return value === 'development.echo' || value === 'task.accept_goal';
}