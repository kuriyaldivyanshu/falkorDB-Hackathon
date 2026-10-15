import assert from 'node:assert/strict';
import test from 'node:test';
import {createJsonLogger,RedactedLogFieldError} from '../src/log.js';
import {describeConfig,parseBackendConfig} from '../src/config.js';

test('the real configuration summary can initialize the structured logger',()=>{
 const summary=describeConfig(parseBackendConfig({env:{}}));
 assert.doesNotThrow(()=>createJsonLogger(summary));
});
test('secret fields after ordinary primitive fields are still refused',()=>{
 assert.throws(()=>createJsonLogger({component:'backend',password:'synthetic-secret'}),RedactedLogFieldError);
 assert.throws(()=>createJsonLogger({component:'backend',storage:{host:'localhost',token:'synthetic-secret'}}),RedactedLogFieldError);
});
test('only boolean passwordConfigured metadata is allowed',()=>{
 assert.doesNotThrow(()=>createJsonLogger({passwordConfigured:true}));
 assert.throws(()=>createJsonLogger({passwordConfigured:'synthetic-secret'}),RedactedLogFieldError);
});
