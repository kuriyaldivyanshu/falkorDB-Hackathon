import { registerContextRoutes } from './context-routes.js';
import { ThreadlineError } from '@threadline/shared';

import { registerCheckpointRoutes } from './checkpoint-routes.js';
import Fastify, { type FastifyInstance } from 'fastify';

import type { HealthReport } from '@threadline/shared';

import type { BackendConfig } from '../config.js';
import type { CommandDispatcher } from '../domain/dispatcher.js';
import type { EventPublisher } from '../events/publisher.js';
import type { ApplicationServices } from '../domain/services.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { createEventStreamManager, type EventStreamManager } from './events-stream.js';
import type { ManagedRuntime } from '../runtime/managed.js';
import { registerProviderRoutes } from './provider-routes.js';
import { registerSourceRoutes } from './source-routes.js';
import { registerCapabilityRoutes } from './capability-routes.js';
import { registerProvisioningRoutes } from './provisioning-routes.js';
import type { ProviderSettings } from '../provider/settings.js';
import { registerRoutes, registerRunRoutes } from './routes.js';

export interface BackendAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface HttpServerHandle {
  readonly instance: FastifyInstance;
  readonly streams: EventStreamManager;
  readonly listening: boolean;
  readonly address: BackendAddress | null;
  listen(): Promise<BackendAddress>;
  close(): Promise<void>;
}

export interface HttpServerDeps {
  readonly providerSettings?: () => ProviderSettings | null;
  readonly runtime?: () => ManagedRuntime | null;
  readonly config: BackendConfig;
  readonly dispatch: CommandDispatcher;
  readonly publisher: EventPublisher;
  readonly health: () => HealthReport;
  readonly services: () => ApplicationServices | null;
  readonly localBootstrap: () => {
    tenantId: string;
    userId: string;
    projectId: string;
    projectSlug: string;
  } | null;
  readonly logger?: Logger;
}

/**
 * Creates the HTTP server without binding it.
 *
 * Importing or calling this function opens no socket; only {@link
 * HttpServerHandle.listen} does. Nothing is started at module import time.
 */
export function createHttpServer(deps: HttpServerDeps): HttpServerHandle {
  const logger = deps.logger ?? silentLogger;
  const app = Fastify({
    // The backend has its own logger. Turning Fastify's logger off is what
    // disables its request logging, so no request logging is configured twice.
    logger: false,
    bodyLimit: deps.config.limits.maxRequestBodyBytes,
  });

  const streams = createEventStreamManager({
    publisher: deps.publisher,
    maxBacklogBytes: deps.config.limits.maxEventBacklogBytes,
  });

  const routeDeps = {
    runtime: deps.runtime ?? (() => null),
    config: deps.config,
    dispatch: deps.dispatch,
    streams,
    health: deps.health,
    services: deps.services,
    localBootstrap: deps.localBootstrap,
  };
  registerRoutes(app, routeDeps);
  registerProviderRoutes(app, { ...routeDeps, providerSettings: deps.providerSettings ?? (() => null) });
  registerRunRoutes(app, routeDeps);
  registerSourceRoutes(app, routeDeps);
  registerCheckpointRoutes(app, { services: routeDeps.services });
  // Registered exactly once, alongside the other operation routes.
  registerCapabilityRoutes(app, routeDeps);
  registerContextRoutes(app, routeDeps);
  registerProvisioningRoutes(app, {
    services: routeDeps.services,
    // Resolved through the same service surface every other route uses, so there
    // is one provisioning implementation rather than a route-local one.
    provisioning: () => {
      const current = deps.services?.() ?? null;
      if (current === null) {
        throw new ThreadlineError('service_unavailable', 'Storage is not ready.');
      }
      return current.provisioning();
    },
  });

  let listening = false;
  let boundAddress: BackendAddress | null = null;

  return {
    instance: app,
    streams,

    get listening() {
      return listening;
    },

    get address() {
      return boundAddress;
    },

    async listen(): Promise<BackendAddress> {
      const address = await app.listen({ host: deps.config.host, port: deps.config.port });
      const host = deps.config.host;
      const port = readPort(app);
      listening = true;
      boundAddress = { host, port, url: address };
      logger.log({
        level: 'info',
        message: 'Backend listening.',
        fields: { host, port, url: address },
      });
      return boundAddress;
    },

    async close(): Promise<void> {
      // Long-lived event streams would otherwise hold the close open forever.
      const endedStreams = streams.closeAll();
      if (listening) {
        await app.close();
        listening = false;
        boundAddress = null;
      }
      logger.log({
        level: 'info',
        message: 'Backend HTTP server closed.',
        fields: { endedStreams },
      });
    },
  };
}

function readPort(app: FastifyInstance): number {
  const server = app.server.address();
  if (server === null || typeof server === 'string') {
    return 0;
  }
  return server.port;
}