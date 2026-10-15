import { render } from 'ink';
import { createElement } from 'react';

import type { BackendClient } from './transport/backend-client.js';
import { App } from './ui/App.js';

export interface TuiOptions {
  readonly client: BackendClient;
  readonly endpoint: string;
}

/**
 * Starts the terminal interface and resolves when it exits.
 *
 * Ink owns the terminal from here; the returned instance is unmounted on
 * Ctrl+C or Esc by the component, and unmounted here if the process is
 * interrupted from outside.
 */
export function startTui({ client, endpoint }: TuiOptions): Promise<void> {
  const instance = render(createElement(App, { client, endpoint }));

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
