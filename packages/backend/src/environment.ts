import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Installation root resolution.
 *
 * Threadline configuration is resolved from an explicit installation root, an
 * environment override or the user's home directory. It is deliberately *not*
 * discovered by walking up the working tree: a coding repository's `.env` is
 * that project's business, and loading it as Threadline configuration would
 * both leak secrets and make behavior depend on where a command was run.
 *
 * Precedence, highest first:
 *
 * 1. an explicit `--home` argument,
 * 2. `THREADLINE_HOME`,
 * 3. `~/.threadline`.
 */

export const HOME_ENV_KEY = 'THREADLINE_HOME';
export const DEFAULT_HOME_DIRECTORY_NAME = '.threadline';

export function resolveHomeDirectory(explicit?: string): string {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return resolve(explicit);
  }
  const fromEnvironment = process.env[HOME_ENV_KEY];
  if (fromEnvironment !== undefined && fromEnvironment.trim().length > 0) {
    return isAbsolute(fromEnvironment)
      ? fromEnvironment
      : resolve(process.cwd(), fromEnvironment);
  }
  return join(homedir(), DEFAULT_HOME_DIRECTORY_NAME);
}

/** Files owned by one installation root. Credentials never leave this root. */
export interface InstallationPaths {
  readonly home: string;
  readonly configFile: string;
  readonly policyFile: string;
  readonly secretsFile: string;
  readonly credentialFile: string;
  readonly sourceRoot: string;
  readonly spoolRoot: string;
}

export function installationPaths(home: string): InstallationPaths {
  return {
    home,
    configFile: join(home, 'config.json'),
    policyFile: join(home, 'threadline.toml'),
    secretsFile: join(home, 'secrets.json'),
    credentialFile: join(home, 'credential.json'),
    sourceRoot: join(home, 'sources'),
    spoolRoot: join(home, 'spool'),
  };
}

/**
 * An explicit environment map for configuration parsing.
 *
 * Callers pass `process.env` in production and a literal in a focused check;
 * nothing else about configuration reads ambient state.
 */
export type EnvironmentMap = Readonly<Record<string, string | undefined>>;

/** One explicitly selected repository root; no ancestor/cwd discovery. */
export function projectPreferencesPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.threadline.toml');
}
