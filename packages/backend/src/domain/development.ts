import {
  DEVELOPMENT_DURABILITY,
  newEchoId,
  type DevelopmentEchoAcceptedPayload,
  type EchoId,
} from '@threadline/shared';

import type { CommandContext, CommandRegistry } from './dispatcher.js';

/**
 * The M00 development command.
 *
 * It is a deliberate no-op with respect to task state: it acknowledges text and
 * emits one status event so the terminal client and the backend can prove a
 * real round trip before any storage exists. Nothing it returns is durable,
 * and its result carries `durability: "development-only"` so that label
 * travels with the data instead of living only in documentation.
 */

/** Narrow publishing seam, injected so this module does not depend on transport. */
export type PublishDevelopmentEchoAccepted = (payload: DevelopmentEchoAcceptedPayload) => void;

export interface DevelopmentRegistryDeps {
  readonly publishAccepted: PublishDevelopmentEchoAccepted;
  readonly newEchoId?: () => EchoId;
}

export function createDevelopmentRegistry(deps: DevelopmentRegistryDeps): CommandRegistry {
  const allocateEchoId = deps.newEchoId ?? newEchoId;

  return {
    'development.echo': (input, context: CommandContext) => {
      const echoId = allocateEchoId();
      const acceptedAt = context.receivedAt;
      deps.publishAccepted({
        commandId: context.commandId,
        echoId,
        text: input.text,
        acceptedAt,
        durability: DEVELOPMENT_DURABILITY,
      });
      return {
        echoId,
        text: input.text,
        acceptedAt,
        durability: DEVELOPMENT_DURABILITY,
      };
    },
  };
}