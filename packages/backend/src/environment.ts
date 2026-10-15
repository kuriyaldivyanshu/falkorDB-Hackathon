import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

/** Entry-point-only environment loading. Injected backend configuration stays deterministic. */
export function loadLocalEnvironment(cwd = process.cwd(), ambient:NodeJS.ProcessEnv = process.env): {env:NodeJS.ProcessEnv;cwd:string} {
  let root=cwd;
  for (;;) {
    if (existsSync(join(root,'package.json'))) {
      try {
        const metadata:unknown=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
        if (typeof metadata === 'object' && metadata !== null && 'name' in metadata && metadata.name === 'threadline') break;
      } catch { /* Not the workspace root. */ }
    }
    const parent=dirname(root); if(parent===root){root=cwd;break;} root=parent;
  }
  const path=join(root,'.env');
  const file=existsSync(path) ? parseEnv(readFileSync(path,'utf8')) : {};
  return {env:{...file,...ambient},cwd:root};
}
