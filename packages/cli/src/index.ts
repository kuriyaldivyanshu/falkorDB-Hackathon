#!/usr/bin/env node
import { runDurableCommand } from './durable-commands.js';
import { runFixturePreview } from './fixture-command.js';
import { HELP_TEXT, UsageError, parseCliArgs, type CliInvocation } from './options.js';
import { EXIT_FAILURE, EXIT_OK, runEcho, runHealth } from './one-shot.js';
import { createBackendClient } from './transport/backend-client.js';
import { readLocalSessionCredential } from './credentials/local-session.js';
import { describeCause } from './transport/errors.js';
import { startTui } from './tui.js';

/**
 * Process entry point.
 *
 * Owns argument parsing, dispatch, and the exit code. It contains no protocol
 * knowledge and no view state; the transport client and the interface are
 * started from here and nothing else.
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

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
    write(HELP_TEXT);
    return EXIT_OK;
  }

  if (invocation.command === 'fixture') {
    return runFixturePreview(invocation.fixtureManifestPath, write);
  }

  // Loaded before the client so a credential problem is reported plainly rather
  // than as an authentication failure from the backend. A missing credential is
  // not fatal yet: the M00 development surface does not require a session.
  const credential = await readLocalSessionCredential(invocation.credentialPath).catch(
    (error: unknown) => {
      process.stderr.write(`threadline: ${describeCause(error)}\n`);
      return null;
    },
  );

  const client = createBackendClient({
    baseUrl: invocation.backendUrl,
    requestTimeoutMs: invocation.requestTimeoutMs,
    token: credential?.token ?? null,
  });

  switch (invocation.command) {
    case 'init': case 'admit': case 'inspect':
      return runDurableCommand(client,invocation,write);
    case 'health':
      return runHealth(client, write, invocation.showStoreReadiness, credential?.token ?? null);
    case 'echo':
      return runEcho(client, invocation.echoText ?? '', write);
    case 'tui':
      await startTui({ client, endpoint: client.baseUrl, credential });
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
