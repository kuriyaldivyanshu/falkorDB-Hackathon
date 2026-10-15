import {
  PROTOCOL_VERSION,
  ThreadlineError,
  errorPayload,
  newCommandId,
  type CommandId,
  type CommandInput,
  type CommandName,
  type CommandOutcome,
  type CommandResponse,
  type CommandResult,
  type ThreadlineErrorCode,
  type ThreadlineErrorPayload,
} from '@threadline/shared';

import type { BackendLimits } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { parseCommandRequest } from './validate.js';

/**
 * Transport-independent command execution.
 *
 * The dispatcher owns the single funnel every command passes through:
 * admission check, identity allocation, boundary validation, handler call and
 * typed failure mapping. API handlers stay thin because they only translate
 * this outcome into an HTTP status.
 */

export interface CommandContext {
  readonly commandId: CommandId;
  readonly receivedAt: string;
  /**
   * Raw `Authorization` header of the request being served, or undefined.
   * It travels with the context rather than through module state, so two
   * concurrent requests cannot observe each other's credential.
   */
  readonly authorization: string | undefined;
}

export type CommandHandler<C extends CommandName> = (
  input: CommandInput<C>,
  context: CommandContext,
) => CommandResult<C> | Promise<CommandResult<C>>;

export type CommandRegistry = {
  readonly [C in CommandName]: CommandHandler<C>;
};

export interface CommandDispatcherDeps {
  readonly registry: CommandRegistry;
  readonly limits: BackendLimits;
  /** False while the backend is starting, stopping or already stopped. */
  readonly isAccepting: () => boolean;
  readonly clock?: () => Date;
  readonly allocateCommandId?: () => CommandId;
  readonly logger?: Logger;
}

export interface CommandDispatcher {
  (body: unknown, authorization?: string): Promise<CommandOutcome>;
}

const STATUS_BY_ERROR_CODE = {
  invalid_request: 400,
  unknown_command: 400,
  unauthorized: 401,
  not_found: 404,
  idempotency_mismatch: 409,
  authority_conflict: 409,
  authority_unavailable: 409,
  schema_incompatible: 500,
  storage_unavailable: 503,
  service_unavailable: 503,
  internal_error: 500,
} as const satisfies Record<ThreadlineErrorCode, number>;

export function createCommandDispatcher(deps: CommandDispatcherDeps): CommandDispatcher {
  const clock = deps.clock ?? (() => new Date());
  const allocateCommandId = deps.allocateCommandId ?? newCommandId;
  const logger = deps.logger ?? silentLogger;

  return async function dispatch(
    body: unknown,
    authorization?: string,
  ): Promise<CommandOutcome> {
    const receivedAt = clock().toISOString();
    const commandId = allocateCommandId();

    if (!deps.isAccepting()) {
      return failure(
        commandId,
        receivedAt,
        errorPayload('service_unavailable', 'The backend is not accepting commands right now.', {
          hint: 'Retry after the backend reports state "ready".',
        }),
      );
    }

    const parsed = parseCommandRequest(body, deps.limits);
    if (!parsed.ok) {
      return failure(commandId, receivedAt, parsed.error);
    }

    try {
      const result = await runCommand(
        deps.registry,
        parsed.parsed.command,
        parsed.parsed.input,
        { commandId, receivedAt, authorization },
      );
      const response = {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        commandId,
        receivedAt,
        result,
      } as CommandResponse;
      return { status: 200, body: response };
    } catch (error) {
      return failure(commandId, receivedAt, toPayload(error, logger));
    }
  };
}

/**
 * Calls the handler registered for a validated command.
 *
 * `CommandRegistry` is a mapped type, so for an unresolved type parameter
 * TypeScript cannot prove that the handler at `registry[command]` accepts
 * `CommandInput<C>`. The registry is built only from `CommandName` keys and
 * `parseCommandRequest` returns a value discriminated on that same union, so
 * the widening is sound and is confined to this one function.
 */
function runCommand<C extends CommandName>(
  registry: CommandRegistry,
  command: C,
  input: CommandInput<C>,
  context: CommandContext,
): CommandResult<C> | Promise<CommandResult<C>> {
  const handler = registry[command] as CommandHandler<C>;
  return handler(input, context);
}

function failure(
  commandId: CommandId,
  receivedAt: string,
  error: ThreadlineErrorPayload,
): CommandOutcome {
  const response: CommandResponse = {
    ok: false,
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    receivedAt,
    error,
  };
  return { status: STATUS_BY_ERROR_CODE[error.code], body: response };
}

function toPayload(error: unknown, logger: Logger): ThreadlineErrorPayload {
  if (error instanceof ThreadlineError) {
    return error.toPayload();
  }
  logger.log({
    level: 'error',
    message: 'Command handler threw an unexpected error; the cause is not sent to the client.',
    fields: { errorName: error instanceof Error ? error.name : typeof error },
  });
  return errorPayload('internal_error');
}