import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { createBackend, parseBackendConfig } from '../../backend/dist/src/index.js';
import { loadFixtureManifest } from '../dist/fixture/manifest.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const exec=promisify(execFile);
test('live: CLI init, explicit consent, durable admission, inspect and restart',{
 skip: process.env.THREADLINE_LIVE==='1' ? false : 'set THREADLINE_LIVE=1 with isolated verification stores',timeout:30000,
},async t=>{
 const data=await mkdtemp(join(tmpdir(),'threadline-m01-cli-'));
 const config=parseBackendConfig({cwd:root,env:{THREADLINE_STORAGE_MODE:'required',THREADLINE_PORT:'0',THREADLINE_DATA_DIR:data,
  THREADLINE_TENANT_SLUG:'cli-'+Date.now(),THREADLINE_PG_HOST:'127.0.0.1',
  THREADLINE_PG_PORT:process.env.THREADLINE_LIVE_PGPORT,THREADLINE_PG_DATABASE:process.env.THREADLINE_LIVE_PGDATABASE,
  THREADLINE_PG_USER:process.env.THREADLINE_LIVE_PGUSER,THREADLINE_PG_PASSWORD:process.env.THREADLINE_LIVE_PGPASSWORD,
  THREADLINE_PG_MIGRATION_USER:process.env.THREADLINE_LIVE_PGMIGRATIONUSER,THREADLINE_PG_MIGRATION_PASSWORD:process.env.THREADLINE_LIVE_PGMIGRATIONPASSWORD,
  THREADLINE_PG_APPLICATION_ROLE:process.env.THREADLINE_LIVE_PGUSER,THREADLINE_FALKORDB_HOST:'127.0.0.1',THREADLINE_FALKORDB_PORT:process.env.THREADLINE_LIVE_GRAPHPORT,
 }});
 let backend=createBackend({config}); t.after(()=>backend.stop()); await backend.start();
 const credential=backend.localBootstrap.sessionTokenPath,record=join(data,'admission.json');
 // Child gets no database or provider credentials.
 const cli=args=>exec(process.execPath,['packages/cli/dist/index.js',...args,'--backend',backend.address.url,'--credential',credential],{
  cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:10000,
 });
 const principal=JSON.parse((await cli(['init'])).stdout); assert.equal(principal.projects.length,1);
 const manifest=await loadFixtureManifest(join(root,'archive/plans/contracts/fixture-manifest.json'));
 await assert.rejects(()=>cli(['admit','--request-record',record]),e=>/Explicit acceptance required/.test(e.stderr));
 await assert.rejects(()=>cli(['admit','--request-record',record,'--accept-fixture','bad']),e=>/exactly match/.test(e.stderr));
 const accepted=await cli(['admit','--request-record',record,'--accept-fixture',manifest.digest]); assert.match(accepted.stdout,/"kind": "accepted"/);
 const first=JSON.parse((await cli(['inspect'])).stdout);assert.equal(first.criteria.length,6);assert.ok(first.goalText.includes(manifest.digest));
 const request=JSON.parse(await readFile(record,'utf8'));
 const replay=await cli(['admit','--request-record',record,'--accept-fixture',manifest.digest]);assert.match(replay.stdout,/"replayed": true/);
 const receipt=JSON.parse((await cli(['inspect','--request',request.requestId])).stdout);assert.equal(receipt.authority.taskId,first.taskId);
 await backend.stop();backend=createBackend({config});await backend.start();
 const restored=JSON.parse((await cli(['inspect'])).stdout);assert.equal(restored.taskId,first.taskId);assert.deepEqual(restored.sourceMessageIds,first.sourceMessageIds);
});
