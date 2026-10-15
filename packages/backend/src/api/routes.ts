import type { FastifyInstance } from 'fastify';

import { EventCapacityError, PublisherClosedError, errorPayload, type HealthReport } from '@threadline/shared';

import type { BackendConfig } from '../config.js';
import type { CommandDispatcher } from '../domain/dispatcher.js';
import type { EventStreamManager } from './events-stream.js';

/**
 * HTTP handlers for the M00 scaffold.
 *
 * Handlers only translate transport into a backend call and a status code.
 * There is no domain logic here, and no domain module imports Fastify.
 */

export interface RouteDeps {
  readonly config: BackendConfig;
  readonly dispatch: CommandDispatcher;
  readonly streams: EventStreamManager;
  readonly health: () => HealthReport;
}

/**
 * Public routes. Agent B's terminal client targets exactly these paths:
 *
 * - `GET  /healthz` -> HealthReport (200 when ready, 503 otherwise)
 * - `POST /commands` -> CommandOutcome body with the dispatcher's status
 * - `GET  /events`  -> text/event-stream of ThreadlineEvent frames
 */
export const ROUTES = {
  health: '/healthz',
  commands: '/commands',
  events: '/events',
} as const;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(ROUTES.health, async (_request, reply) => {
    const report = deps.health();
    return reply.code(report.state === 'ready' ? 200 : 503).send(report);
  });

  app.post(ROUTES.commands, async (request, reply) => {
    const outcome = await deps.dispatch(request.body);
    return reply.code(outcome.status).send(outcome.body);
  });

  app.get(ROUTES.events, (_request, reply) => {
    try {
      deps.streams.open(reply.raw);
      return reply.hijack();
    } catch (error) {
      if (error instanceof EventCapacityError || error instanceof PublisherClosedError) {
        return reply.code(503).send({ error: errorPayload('service_unavailable', error.message) });
      }
      throw error;
    }
  });
}