import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

/** Fixed layouts: packages/cli/dist/runtime.js in the workspace, dist/cli/runtime.js in the artifact. */
const distributionRoot = new URL(
  import.meta.url.endsWith('/packages/cli/dist/runtime.js') ? '../../../' : '../../',
  import.meta.url,
);

function readJsonFile(path: URL, maximumBytes: number, label: string): unknown {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximumBytes) throw new Error('invalid packaged file');
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maximumBytes) throw new Error('invalid packaged file');
    return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown;
  } catch {
    throw new Error(`Threadline package installation is incomplete or damaged: ${label}. Reinstall the artifact; no repository or cwd fallback is used.`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readCliVersion(): string {
  const metadata = readJsonFile(new URL('package.json', distributionRoot), 32_768, 'package.json');
  if (typeof metadata !== 'object' || metadata === null || !('version' in metadata)
    || typeof metadata.version !== 'string' || metadata.version.length > 100
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.version)) {
    throw new Error('Threadline package installation has invalid version metadata. Reinstall the artifact.');
  }
  return metadata.version;
}

/** Historical compatibility evidence is not native runtime qualification. */
export function readCompatibilityEvidence(): { readonly historicalVersion: string } {
  const label = 'assets/codex/compatibility.json';
  const data = readJsonFile(new URL(label, distributionRoot), 65_536, label);
  if (typeof data !== 'object' || data === null
    || !('kind' in data) || data.kind !== 'threadline-codex-compatibility'
    || !('harness' in data) || data.harness !== 'codex'
    || !('qualifiedVersion' in data) || typeof data.qualifiedVersion !== 'string'
    || data.qualifiedVersion.length > 100
    || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(data.qualifiedVersion)
    || !('unverified' in data) || !Array.isArray(data.unverified)
    || !data.unverified.every((value: unknown) => typeof value === 'string')) {
    throw new Error(`Threadline package installation has invalid compatibility evidence: ${label}. Reinstall the artifact.`);
  }
  return { historicalVersion: data.qualifiedVersion };
}
