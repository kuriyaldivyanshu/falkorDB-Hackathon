import { pathToFileURL } from 'node:url';

import { ConfigurationError } from '@threadline/shared';

import { loadLocalEnvironment } from './environment.js';
import { describeConfig, parseBackendConfig } from './config.js';
import { createBackend, type Backend } from './index.js';
import { defaultProviderDirectory } from './provider/credentials.js';
import { loadSavedProviderConfig } from './provider/startup.js';
import { createJsonLogger } from './log.js';

/**
 * Process entry point for the local backend.
 *
 * This module is the only place that turns ambient process state into running
 * code. `index.ts` stays side-effect free so tests and the terminal client can
 * compose a backend without starting one.
 */

const EXIT_CONFIG_ERROR = 2;

export async function main(): Promise<Backend> {
  const logger = createJsonLogger({ component: 'backend' });

  let config;
  try {
    config = parseBackendConfig(loadLocalEnvironment());
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`Threadline backend configuration is not usable:\n${error.format()}\n`);
      process.exitCode = EXIT_CONFIG_ERROR;
      throw error;
    }
    throw error;
  }

  const providerVaultDirectory = defaultProviderDirectory();
  const savedProvider = loadSavedProviderConfig(config, providerVaultDirectory);
  config = savedProvider.config;
  logger.log({
    level: 'info',
    message: 'Starting Threadline backend.',
    fields: describeConfig(config),
  });

  const backend = createBackend({ config, logger, providerVaultDirectory, providerCredentialRevision: savedProvider.revision });
  installSignalHandlers(backend, logger);
  await backend.start();
  return backend;
}

function installSignalHandlers(backend: Backend, logger: ReturnType<typeof createJsonLogger>): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.log({ level: 'info', message: 'Shutting down.', fields: { signal } });
    backend
      .stop()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        logger.log({
          level: 'error',
          message: 'Shutdown did not complete cleanly.',
          fields: { errorName: error instanceof Error ? error.name : typeof error },
        });
        process.exitCode = 1;
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedPath = process.argv[1];
const invokedDirectly =
  invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (process.exitCode === undefined) {
      process.stderr.write(
        `Threadline backend failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });
}