import { pathToFileURL } from 'node:url';

import { ConfigurationError } from '@threadline/shared';

import { loadServiceConfig } from './config.js';
import { resolveHomeDirectory } from './environment.js';
import { createMemoryService, type MemoryService } from './index.js';
import { createJsonLogger, type Logger } from './log.js';

/**
 * Process entry point for the memory service.
 *
 * This module is the only place that turns ambient process state into running
 * code. `index.ts` stays side-effect free so the CLI and focused checks can
 * compose a service without starting one. No provider vault, fixture seed or
 * legacy migration is reachable from here.
 */

const EXIT_CONFIG_ERROR = 2;

export interface StartOptions {
  readonly home?: string;
  readonly port?: number;
}

export async function startFromHome(options: StartOptions = {}): Promise<MemoryService> {
  const logger = createJsonLogger({ component: 'threadline' });
  const home = resolveHomeDirectory(options.home);

  let config;
  try {
    config = loadServiceConfig(home).config;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`Threadline configuration is not usable:\n${error.format()}\n`);
      process.exitCode = EXIT_CONFIG_ERROR;
      throw error;
    }
    throw error;
  }
  if (options.port !== undefined) {
    config = { ...config, port: options.port };
  }

  const service = createMemoryService({ config, logger });
  installSignalHandlers(service, logger);
  await service.start();
  return service;
}

function installSignalHandlers(service: MemoryService, logger: Logger): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.log({ level: 'info', message: 'Shutting down.', fields: { signal } });
    service
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

interface EntryArguments {
  readonly home: string | undefined;
  readonly port: number | undefined;
}

function parseEntryArguments(argv: readonly string[]): EntryArguments {
  let home: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--home') {
      home = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--port') {
      const raw = argv[index + 1];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        throw new TypeError('--port needs a port number.');
      }
      port = Number.parseInt(raw, 10);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown argument "${String(argument)}".`);
  }
  return { home, port };
}

const invokedPath = process.argv[1];
const invokedDirectly =
  invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (invokedDirectly) {
  let entry: EntryArguments;
  try {
    entry = parseEntryArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`threadline: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_CONFIG_ERROR;
    entry = { home: undefined, port: undefined };
    process.exit(EXIT_CONFIG_ERROR);
  }
  startFromHome(entry)
    .then((service) => {
      const address = service.address;
      if (address !== null) {
        process.stderr.write(`threadline: memory service listening on ${address.url} (state: ${service.state})\n`);
      }
    })
    .catch((error: unknown) => {
      if (process.exitCode === undefined) {
        process.stderr.write(
          `Threadline memory service failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });
}
