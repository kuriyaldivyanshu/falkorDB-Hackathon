import { createElement } from 'react';
import { render, useApp } from 'ink';
import type { ProviderClient } from './transport/provider-client.js';
import { ProviderSetup } from './ui/ProviderSetup.js';

function SetupRoot({ client }: { client: ProviderClient }) {
  const { exit } = useApp();
  return createElement(ProviderSetup, { client, onClose: () => exit() });
}
export async function startProviderSetup(client: ProviderClient): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Provider setup needs an interactive terminal. API keys are never accepted as command arguments.');
  const wasRaw = process.stdin.isRaw;
  const instance = render(createElement(SetupRoot, { client }));
  try { await instance.waitUntilExit(); }
  finally {
    instance.unmount();
    if (process.stdin.isRaw !== wasRaw) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdin.unref();
  }
}
