import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadlineError } from '@threadline/shared';
import { coreBootstrapChecksum, ensureCoreSchema } from '../src/storage/migrate.js';
import { CORE_BOOTSTRAP_SQL, SCHEMA_MIGRATIONS_SQL } from '../src/storage/sql.js';
import { sqlDouble } from './sql-double.js';

for (const competing of ['none','compatible','incompatible'] as const) {
  test(`core bootstrap rechecks ${competing} competing migration under the transaction lock`,async()=>{
    let recorded: string | undefined;
    let transaction=0;
    let locked=false;
    let bootstrapRuns=0;
    let versionOneInserts=0;
    const db=sqlDouble((text,values)=>{
      if(text==='SELECT pg_advisory_xact_lock(73010402)') {
        locked=true;
        // Another process committed while this transaction was waiting.
        if(transaction===2 && competing!=='none') recorded=competing==='compatible'?coreBootstrapChecksum():'incompatible';
        return [];
      }
      if(text.includes('SELECT version, checksum, applied_at')) {
        if(transaction===2) assert.equal(locked,true,'status must be read after acquiring the transaction lock');
        return recorded?[{version:1,checksum:recorded,applied_at:new Date()}]:[];
      }
      if(text===SCHEMA_MIGRATIONS_SQL) {
        assert.equal(locked,true,'bookkeeping DDL must also be serialized');
        return [];
      }
      if(text===CORE_BOOTSTRAP_SQL) {
        assert.equal(locked,true);
        assert.equal(transaction,2);
        bootstrapRuns+=1;
        return [];
      }
      if(text.includes('INSERT INTO threadline.schema_migrations (id, store, version, checksum)')) {
        assert.equal(locked,true);
        recorded=values[2] as string;
        versionOneInserts+=1;
        return [];
      }
      if(text.includes("version=2") || text.includes("version=3")) return [];
      if(text.startsWith('ALTER TABLE threadline.model_requests')) {
        assert.equal(locked,true,'attempt-fact DDL must be serialized');
        assert.match(text,/possible_charge boolean/);
        assert.match(text,/reserved_tokens bigint/);
        return [];
      }
      if(text.startsWith('GRANT') || text.startsWith('REVOKE')) {
        assert.equal(locked,true,'concurrent grants must be serialized');
        return [];
      }
      if(text.includes('CREATE OR REPLACE FUNCTION') || text.includes("VALUES(gen_random_uuid(),'postgres',2") || text.includes("VALUES(gen_random_uuid(),'postgres',3") || text.startsWith('SET LOCAL')) return [];
      assert.fail(`Unexpected migration statement: ${text}`);
    });
    const runTransaction=db.withTransaction;
    db.withTransaction=async work=>{
      transaction+=1;
      locked=false;
      try { return await runTransaction(work); } finally { locked=false; }
    };
    if(competing==='incompatible') {
      await assert.rejects(()=>ensureCoreSchema({db,migrationDb:db}),e=>e instanceof ThreadlineError && e.code==='schema_incompatible');
    } else {
      assert.equal((await ensureCoreSchema({db,migrationDb:db,applicationRole:'threadline_app'})).status.state,'applied');
    }
    assert.equal(bootstrapRuns,competing==='none'?1:0);
    assert.equal(versionOneInserts,competing==='none'?1:0);
  });
}
