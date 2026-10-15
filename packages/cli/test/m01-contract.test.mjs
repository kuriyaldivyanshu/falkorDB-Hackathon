import assert from 'node:assert/strict';
import test from 'node:test';
import {newCommandId} from '@threadline/shared';
import {createBackendClient} from '../dist/transport/backend-client.js';
import {describeStoreState} from '../dist/ui/store-readiness.js';

test('malformed successful principal/authority reads are refused at the transport boundary',async()=>{
 const client=createBackendClient({baseUrl:'http://127.0.0.1:47821',requestTimeoutMs:1000,fetchImpl:async()=>new Response(JSON.stringify({projects:[]}))});
 await assert.rejects(()=>client.principal(),/published view contract/);
 await assert.rejects(()=>client.authority('11111111-1111-4111-8111-111111111111'),/published view contract/);
});
test('an accepted label without the committed receipt is not successful admission',async()=>{
 const client=createBackendClient({baseUrl:'http://127.0.0.1:47821',requestTimeoutMs:1000,fetchImpl:async()=>new Response(JSON.stringify({ok:true,protocolVersion:1,commandId:newCommandId(),receivedAt:new Date().toISOString(),result:{kind:'accepted'}}))});
 await assert.rejects(()=>client.sendCommand('task.accept_goal',{}),/invalid admission result/);
});
test('future absent provider/checker do not make healthy data stores unavailable',()=>{
 const health={components:[{name:'postgres',present:true,ready:true,detail:''},{name:'falkordb',present:true,ready:true,detail:''},{name:'provider',present:false,ready:false,detail:''},{name:'checker',present:false,ready:false,detail:''}]};
 assert.equal(describeStoreState(health),'PostgreSQL and FalkorDB are ready');
 health.components[1].ready=false;assert.match(describeStoreState(health),/not ready: falkordb/);
});
