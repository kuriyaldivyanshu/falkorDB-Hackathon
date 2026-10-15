#!/usr/bin/env node
import { HELP_TEXT, UsageError, parseCliArgs, type CliInvocation } from './options.js';
import { EXIT_FAILURE, EXIT_OK, runEcho, runHealth } from './one-shot.js';
import { createBackendClient } from './transport/backend-client.js';
import { describeCause } from './transport/errors.js';
import { startTui } from './tui.js';

/**
 * Process entry point.
 *
 * Owns argument parsing, dispatch, and the exit code. It contains no protocol
 * knowledge and no view state; the transport client and the interface are
 * started from here and nothing else.
 */

async function main(argv: readonly string[]): Promise<number> {
  let invocation: CliInvocation;
  try {
    invocation = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP_TEXT}\n`);
      return EXIT_FAILURE;
    }
    throw error;
  }

  if (invocation.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return EXIT_OK;
  }

  const client = createBackendClient({
    baseUrl: invocation.backendUrl,
    requestTimeoutMs: invocation.requestTimeoutMs,
  });
  const write = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  switch (invocation.command) {
    case 'health':
      return runHealth(client, write);
    case 'echo':
      return runEcho(client, invocation.echoText ?? '', write);
    case 'tui':
      await startTui({ client, endpoint: client.baseUrl });
      return EXIT_OK;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`threadline: ${describeCause(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  });
