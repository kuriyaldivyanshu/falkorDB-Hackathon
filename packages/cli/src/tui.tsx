import { render } from 'ink';
import { createElement } from 'react';

import type { LocalSessionCredential } from './credentials/local-session.js';
import type { BackendClient } from './transport/backend-client.js';
import type { ProviderClient } from './transport/provider-client.js';
import { App } from './ui/App.js';

export interface TuiOptions {
  readonly providerClient?: ProviderClient;
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
export function startTui({ client, endpoint, credential = null, providerClient }: TuiOptions): Promise<void> {
  const instance = render(createElement(App, { client, endpoint, providerClient, authenticated: client.authenticated, sessionIssuedAt: credential?.issuedAt ?? null }));

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
