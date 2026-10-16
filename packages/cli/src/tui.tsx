import { render } from 'ink';
import { createElement } from 'react';

import type { LocalSessionCredential } from './credentials/local-session.js';
import type { BackendClient } from './transport/backend-client.js';
import type { ProviderClient } from './transport/provider-client.js';
import type { SourceClientDeps } from './transport/source-client.js';
import type { TerminalCommands } from './commands/dispatch.js';
import type { CapabilityClient } from './transport/capability-client.js';
import type { CheckpointRoutes, TacticalHttp } from './transport/checkpoint-http.js';
import { App } from './ui/App.js';

export interface TuiOptions {
  readonly providerClient?: ProviderClient;
  /** Optional so a build without the Source route reports it as unavailable. */
  readonly sourceClient?: SourceClientDeps;
  /** Optional until a project and task are known, or Agent A registers the routes. */
  /** Registry-driven command surface mounted into the interface. */
  readonly commands?: TerminalCommands;
  /** Backend capability report; availability follows it, not the catalogue. */
  readonly capability?: CapabilityClient | null;
  readonly tacticalClient?: TacticalHttp;
  readonly tacticalRoutes?: CheckpointRoutes;
  readonly client: BackendClient;
  readonly endpoint: string;
  /**
   * The local owner session, when one exists.
   *
   * It is passed only so the interface can state whether the session is
   * authenticated. The token is never rendered and never put in an activity row.
   */
  readonly credential?: LocalSessionCredential | null;
}

/**
 * Starts the terminal interface and resolves when it exits.
 *
 * Ink owns the terminal from here; the returned instance is unmounted on
 * Ctrl+C or Esc by the component, and unmounted here if the process is
 * interrupted from outside.
 */
export function startTui({ client, endpoint, credential = null, providerClient, sourceClient, tacticalClient, tacticalRoutes, commands, capability }: TuiOptions): Promise<void> {
  const instance = render(createElement(App, { client, endpoint, providerClient, sourceClient, tacticalClient, tacticalRoutes, commands, capability, authenticated: client.authenticated, sessionIssuedAt: credential?.issuedAt ?? null }),{exitOnCtrlC:false});

  return new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      instance.unmount();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    instance.waitUntilExit().then(stop, stop);
  });
}
