import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ThreadlineError } from '@threadline/shared';
import { parseBackendConfig } from '../src/config.js';
import { bootstrapLocalOwner, hashSessionToken } from '../src/storage/identity.js';
import { sqlDouble } from './sql-double.js';

const now = new Date('2026-10-15T12:00:00Z');
const local = parseBackendConfig({env:{}}).storage.local;
const owner = { tenant_id:'tenant', user_id:'owner', project_id:'project', slug:'local',
  graph_key:'graph', graph_epoch:'epoch', session_id:'old-session' };
const oldToken = 'synthetic-owner-credential';

function directory(t: test.TestContext): string {
  const path = mkdtempSync(join(tmpdir(),'threadline-identity-'));
  t.after(() => rmSync(path,{recursive:true,force:true}));
  return path;
}

for (const state of ['active','revoked','absolute-expired','idle-expired'] as const) {
  test(`bootstrap ${state} session preserves identities and protects the old token`, async t => {
    const dataDirectory = directory(t);
    const path = join(dataDirectory,'session.json');
    const original = JSON.stringify({session_id:owner.session_id,token:oldToken});
    writeFileSync(path,original,{mode:0o600});
    let revokedAt = state === 'revoked' ? new Date(now.getTime()-1000) : null;
    const priorRevocation = revokedAt;
    const inserts: (readonly unknown[])[] = [];
    const db = sqlDouble((text,values) => {
      if (text.includes('SELECT id FROM threadline.tenants')) return [{id:owner.tenant_id}];
      if (text.includes('FROM threadline.projects p')) return [owner];
      if (text.includes('SELECT id,revoked_at')) {
        assert.equal(values[1],hashSessionToken(oldToken));
        return [{id:owner.session_id,revoked_at:revokedAt,
          expires_at:new Date(now.getTime()+(state==='absolute-expired'?0:10000)),
          idle_expires_at:new Date(now.getTime()+(state==='idle-expired'?0:10000))}];
      }
      if (text.startsWith('UPDATE threadline.user_sessions')) {
        revokedAt ??= values[0] as Date;
        assert.equal(values[1],owner.session_id);
        return [];
      }
      if (text.includes('INSERT INTO threadline.user_sessions')) {
        // The old credential is still published until the transaction commits.
        assert.equal(readFileSync(path,'utf8'),original);
        assert.equal(readdirSync(dataDirectory).filter(name=>name.endsWith('.tmp')).length,1);
        inserts.push(values);
        return [];
      }
      assert.fail(`Unexpected identity statement: ${text}`);
    });
    const result = await bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now});
    assert.equal(result.tenantId,owner.tenant_id);
    assert.equal(result.userId,owner.user_id);
    assert.equal(result.projectId,owner.project_id);
    assert.equal(result.graphEpoch,owner.graph_epoch);
    assert.deepEqual(readdirSync(dataDirectory),['session.json']);
    if (state==='active') {
      assert.equal(result.sessionId,owner.session_id);
      assert.equal(readFileSync(path,'utf8'),original);
      assert.equal(inserts.length,0);
    } else {
      const file = JSON.parse(readFileSync(path,'utf8')) as {session_id:string;token:string};
      assert.notEqual(file.token,oldToken);
      assert.equal(result.sessionId,file.session_id);
      assert.notEqual(file.session_id,owner.session_id);
      assert.equal(inserts.length,1);
      assert.deepEqual(inserts[0]?.slice(0,4),[owner.tenant_id,file.session_id,owner.user_id,hashSessionToken(file.token)]);
      assert.equal(statSync(path).mode & 0o777,0o600);
      assert.equal(revokedAt?.getTime(),(priorRevocation ?? now).getTime());
    }
  });
}

for (const kind of ['file','symlink','directory'] as const) {
  test(`fresh bootstrap refuses an existing credential ${kind} before any inserts`, async t => {
    const dataDirectory = directory(t);
    const path = join(dataDirectory,'session.json');
    if (kind==='file') writeFileSync(path,'preserve',{mode:0o600});
    else if (kind==='symlink') symlinkSync(join(dataDirectory,'missing-target'),path);
    else {
      // An existing directory is also a conflicting credential path.
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path);
    }
    const db = sqlDouble(text => {
      assert.match(text,/SELECT id FROM threadline.tenants/);
      return [];
    });
    await assert.rejects(()=>bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now}),
      e=>e instanceof ThreadlineError && e.code==='service_unavailable');
    assert.deepEqual(readdirSync(dataDirectory),['session.json']);
    if (kind==='file') assert.equal(readFileSync(path,'utf8'),'preserve');
  });
}

for (const existing of [false,true]) {
  test(`failed ${existing?'replacement':'fresh'} transaction removes the staged credential`, async t => {
    const dataDirectory = directory(t);
    const path = join(dataDirectory,'session.json');
    const original = JSON.stringify({token:oldToken});
    if (existing) writeFileSync(path,original,{mode:0o600});
    const failure = new Error('transaction failed');
    const db = sqlDouble(text => {
      if (text.includes('SELECT id FROM threadline.tenants')) return existing?[{id:owner.tenant_id}]:[];
      if (text.includes('FROM threadline.projects p')) return [owner];
      if (text.includes('SELECT id,revoked_at')) return [{id:owner.session_id,revoked_at:now,expires_at:now,idle_expires_at:now}];
      const temporary = readdirSync(dataDirectory).find(name=>name.endsWith('.tmp'));
      assert.ok(temporary);
      assert.equal(statSync(join(dataDirectory,temporary)).mode & 0o777,0o600);
      throw failure;
    });
    await assert.rejects(()=>bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now}),e=>e===failure);
    assert.deepEqual(readdirSync(dataDirectory),existing?['session.json']:[]);
    if (existing) assert.equal(readFileSync(path,'utf8'),original);
  });
}

test('fresh bootstrap publishes the prepared credential before SQL writes', async t => {
  const dataDirectory = directory(t);
  const inserts: (readonly unknown[])[] = [];
  const db = sqlDouble((text,values) => {
    if (text.startsWith('SELECT')) return [];
    assert.match(text,/INSERT INTO threadline\./);
    assert.ok(readdirSync(dataDirectory).includes('session.json'));
    assert.equal(statSync(join(dataDirectory,'session.json')).mode & 0o777,0o600);
    assert.equal(readdirSync(dataDirectory).filter(name=>name.endsWith('.tmp')).length,1);
    if (text.includes('INSERT INTO threadline.user_sessions')) inserts.push(values);
    return [];
  });
  const result = await bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now});
  const file = JSON.parse(readFileSync(result.sessionTokenPath,'utf8')) as {session_id:string;token:string};
  assert.equal(file.session_id,result.sessionId);
  assert.equal(inserts[0]?.[3],hashSessionToken(file.token));
  assert.equal(statSync(result.sessionTokenPath).mode & 0o777,0o600);
  assert.deepEqual(readdirSync(dataDirectory),['session.json']);
});


test('fresh publication failure never writes SQL or removes a competing credential', async t => {
  const dataDirectory = directory(t);
  const path = join(dataDirectory,'session.json');
  const failure = Object.assign(new Error('publication conflict'),{code:'EEXIST'});
  let inserts = 0;
  const db = sqlDouble(text => {
    if (text.startsWith('SELECT')) return [];
    inserts += 1;
    return [];
  });
  const link = t.mock.method(fs,'linkSync',(_source: fs.PathLike, target: fs.PathLike) => {
    writeFileSync(target,'competing credential',{mode:0o600,flag:'wx'});
    throw failure;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(()=>bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now}), e=>e===failure);
    assert.equal(inserts,0,'SQL must not commit an enrollment whose token cannot be published');
    assert.equal(readFileSync(path,'utf8'),'competing credential');
    assert.deepEqual(readdirSync(dataDirectory),['session.json']);
  } finally { link.mock.restore(); syncBuiltinESMExports(); }
});

for (const commitFails of [false,true]) {
  test(`temporary cleanup failure ${commitFails ? 'preserves the transaction error' : 'does not reject successful enrollment'}`, async t => {
    const dataDirectory = directory(t);
    const path = join(dataDirectory,'session.json');
    const failure = new Error('original transaction failure');
    const warnings: unknown[] = [];
    const originalUnlink = fs.unlinkSync;
    const unlink = t.mock.method(fs,'unlinkSync', (target: fs.PathLike) => {
      if (String(target).endsWith('.tmp')) throw Object.assign(new Error('cleanup denied'),{code:'EACCES'});
      originalUnlink(target);
    });
    const warning = t.mock.method(process,'emitWarning', (value: string | Error) => { warnings.push(value); });
    syncBuiltinESMExports();
    const db = sqlDouble(text => {
      if (text.startsWith('SELECT')) return [];
      if (commitFails) throw failure;
      return [];
    });
    try {
      const bootstrap = bootstrapLocalOwner({db,local,dataDirectory,clock:()=>now});
      if (commitFails) {
        await assert.rejects(()=>bootstrap,e=>e===failure);
        assert.ok(!readdirSync(dataDirectory).includes('session.json'));
      } else {
        const result = await bootstrap;
        const file = JSON.parse(readFileSync(path,'utf8')) as {session_id:string};
        assert.equal(file.session_id,result.sessionId);
        assert.equal(statSync(path).mode & 0o777,0o600);
      }
      assert.equal(warnings.length,1);
    } finally {
      unlink.mock.restore(); warning.mock.restore(); syncBuiltinESMExports();
    }
  });
}
