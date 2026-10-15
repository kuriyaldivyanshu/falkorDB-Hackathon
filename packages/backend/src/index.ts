import {
  BackendStateError,
  PROTOCOL_VERSION,
  newCommandId,
  newEventId,
  newEchoId,
  type BackendState,
  type CommandId,
  type CommandOutcome,
  type ComponentStatus,
  type EchoId,
  type EventId,
  type HealthReport,
} from '@threadline/shared';

import { createHttpServer, type BackendAddress, type HttpServerHandle } from './api/server.js';
import type { BackendConfig } from './config.js';
import { createCommandDispatcher, type CommandDispatcher } from './domain/dispatcher.js';
import { createDevelopmentRegistry } from './domain/development.js';
import { createEventPublisher, type EventPublisher } from './events/publisher.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import { THREADLINE_BACKEND_VERSION } from './version.js';

export { THREADLINE_BACKEND_VERSION } from './version.js';
export { CONFIG_ENV_KEYS, DEFAULT_LIMITS, describeConfig, parseBackendConfig } from './config.js';
export type { BackendConfig, BackendLimits, BackendConfigSummary, ConfigSource } from './config.js';
export { ROUTES } from './api/routes.js';
export type { BackendAddress } from './api/server.js';
export { createEventPublisher } from './events/publisher.js';
export type { EventListener, EventPublisher, EventSubscription } from './events/publisher.js';
export { createCommandDispatcher } from './domain/dispatcher.js';
export type { CommandContext, CommandDispatcher, CommandRegistry } from './domain/dispatcher.js';
export { createDevelopmentRegistry } from './domain/development.js';
export { parseCommandRequest } from './domain/validate.js';

const M00_GUARANTEE_NOTE =
  'M00 development scaffold: state is process-local, nothing is persisted, events are not replayable and no task can be admitted.';

/** Components that do not exist yet, reported explicitly so health never implies readiness. */
const NOT_IMPLEMENTED: readonly ComponentStatus[] = [
  {
    name: 'postgres',
    present: false,
    ready: false,
    detail: 'No database adapter exists at this milestone; local identity and durable capture arrive in M01.',
  },
  {
    name: 'falkordb',
    present: false,
    ready: false,
    detail: 'No graph adapter exists at this milestone; task authority and memory links arrive in M01.',
  },
  {
    name: 'provider',
    present: false,
    ready: false,
    detail: 'No model provider is configured or contacted at this milestone; provider turns arrive in M02.',
  },
  {
    name: 'checker',
    present: false,
    ready: false,
    detail: 'No protected checker exists at this milestone; completion cannot be accepted before M08.',
  },
];

export interface BackendDeps {
  readonly config: BackendConfig;
  readonly clock?: () => Date;
  readonly allocateCommandId?: () => CommandId;
  readonly allocateEventId?: () => EventId;
  readonly allocateEchoId?: () => EchoId;
  readonly logger?: Logger;
}

export interface Backend {
  readonly version: string;
  readonly state: BackendState;
  readonly address: BackendAddress | null;
  readonly events: EventPublisher;
  start(): Promise<BackendAddress>;
  stop(): Promise<void>;
  health(): HealthReport;
  dispatch(body: unknown): Promise<CommandOutcome>;
}

/**
 * Composition entry point.
 *
 * Construction has no side effects: no socket is bound, no directory is
 * created and no environment is read here. Callers pass validated
 * configuration and drive the lifecycle explicitly.
 */
export function createBackend(deps: BackendDeps): Backend {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());
  const allocateEventId = deps.allocateEventId ?? newEventId;

  const publisher = createEventPublisher({
    maxListeners: deps.config.limits.maxEventListeners,
    clock,
    generateEventId: allocateEventId,
    logger,
  });

  let state: BackendState = 'created';
  let stateSince = clock();
  let startedAt: number | null = null;
  let http: HttpServerHandle | null = null;
  let startInFlight: Promise<BackendAddress> | null = null;
  let stopInFlight: Promise<void> | null = null;

  const setState = (next: BackendState, detail: string): void => {
    state = next;
    stateSince = clock();
    if (publisher.closed) {
      return;
    }
    try {
      publisher.publish('backend.status', {
        state: next,
        since: stateSince.toISOString(),
        detail,
      });
    } catch (error) {
      // A status transition must never fail the transition itself.
      logger.log({
        level: 'warn',
        message: 'Could not publish backend status event.',
        fields: { errorName: error instanceof Error ? error.name : typeof error, state: next },
      });
    }
  };

  const isAccepting = (): boolean => state === 'ready';

  const registry = createDevelopmentRegistry({
    publishAccepted: (payload) => {
      publisher.publish('development.echo.accepted', payload);
    },
    newEchoId: deps.allocateEchoId ?? newEchoId,
  });

  const dispatch: CommandDispatcher = createCommandDispatcher({
    registry,
    limits: deps.config.limits,
    isAccepting,
    clock,
    allocateCommandId: deps.allocateCommandId ?? newCommandId,
    logger,
  });

  const health = (): HealthReport => {
    const listening = http?.listening ?? false;
    const components: readonly ComponentStatus[] = [
      {
        name: 'api',
        present: true,
        ready: listening,
        detail: listening
          ? 'Local HTTP transport is bound and serving health, commands and events.'
          : 'Local HTTP transport exists in this process but is not bound to a port.',
      },
      {
        name: 'eventPublisher',
        present: true,
        ready: !publisher.closed,
        detail: publisher.closed
          ? 'Event publisher is closed; no further events will be delivered.'
          : 'Process-local events with bounded listeners; no replay and no persistence.',
      },
      ...NOT_IMPLEMENTED,
    ];
    const uptimeMs = startedAt === null ? 0 : Math.max(0, clock().getTime() - startedAt);
    return {
      protocolVersion: PROTOCOL_VERSION,
      backendVersion: THREADLINE_BACKEND_VERSION,
      state,
      uptimeMs,
      components,
      guarantees: {
        durable: false,
        replayable: false,
        multiSession: false,
        note: M00_GUARANTEE_NOTE,
      },
    };
  };

  const backend: Backend = {
    version: THREADLINE_BACKEND_VERSION,

    get state() {
      return state;
    },

    get address() {
      return http?.address ?? null;
    },

    events: publisher,

    start(): Promise<BackendAddress> {
      if (state !== 'created') {
        throw new BackendStateError('start the backend', 'created', state);
      }
      setState('starting', 'Opening the local HTTP transport.');
      const server = createHttpServer({
        config: deps.config,
        dispatch,
        publisher,
        health,
        logger,
      });
      http = server;
      const starting = (async (): Promise<BackendAddress> => {
        try {
          const address = await server.listen();
          if (state !== 'starting') {
            throw new BackendStateError('finish starting the backend', 'starting', state);
          }
          startedAt = clock().getTime();
          setState('ready', 'Local HTTP transport is accepting commands.');
          return address;
        } catch (error) {
          if (state === 'starting') {
            http = null;
            startedAt = null;
            setState('stopped', 'The transport could not bind; the backend stopped instead of pretending to run.');
            publisher.close();
          }
          throw error;
        } finally {
          startInFlight = null;
        }
      })();
      startInFlight = starting;
      return starting;
    },

    stop(): Promise<void> {
      if (state === 'stopped') {
        return Promise.resolve();
      }
      if (state === 'stopping') {
        return stopInFlight ?? Promise.resolve();
      }
      setState('stopping', 'Refusing new commands and closing open streams.');
      const stopping = (async (): Promise<void> => {
        if (startInFlight !== null) {
          await startInFlight.catch(() => {});
        }
        const server = http;
        http = null;
        if (server !== null) {
          await server.close();
        }
        setState('stopped', 'Transport closed and event listeners released.');
        publisher.close();
      })().finally(() => {
        stopInFlight = null;
      });
      stopInFlight = stopping;
      return stopping;
    },

    health,

    dispatch,
  };

  return backend;
}
