import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createProviderClient } from '../dist/transport/provider-client.js';
const execute = promisify(execFile), key = 'synthetic-masked-provider-key', token = 'a'.repeat(43);
const settings = { storage: 'owner-only-file', appliesImmediately: true, providers: ['openai','anthropic','openrouter','opencode-go'].map(id => ({ id, label: id, saved: false, active: false, model: null, validation: null, inferenceCheckRequired: id === 'opencode-go' })) };
const validation = { state: 'valid', checkedAt: '2026-10-16T00:00:00Z', method: 'authenticated-metadata', message: 'Key accepted.' };

test('provider client keeps keys out of URLs and rejects remote setup, redirects and malformed metadata', async () => {
  assert.throws(() => createProviderClient({ baseUrl: 'https://remote.example', token }), /loopback/);
  assert.throws(() => createProviderClient({ baseUrl: 'http://user:pass@localhost', token }), /loopback/);
  let received;
  const client = createProviderClient({ baseUrl: 'http://127.0.0.1:47821', token, fetchImpl: async (url, init) => {
    received = { url: String(url), init }; return Response.json({ saved: true, validation, settings });
  } });
  await client.connect({ provider: 'openai', model: 'test-model', apiKey: key, allowInferenceTest: false });
  assert.equal(received.url, 'http://127.0.0.1:47821/providers'); assert.equal(received.init.redirect, 'error');
  assert.equal(JSON.parse(received.init.body).apiKey, key); assert.equal(new Headers(received.init.headers).get('authorization'), `Bearer ${token}`);
  const malformed = createProviderClient({ baseUrl: 'http://localhost', token, fetchImpl: async () => Response.json({ apiKey: key }) });
  await assert.rejects(malformed.list(), /unsupported provider/);
  const error = createProviderClient({ baseUrl: 'http://localhost', token, fetchImpl: async () => new Response(key, { status: 500 }) });
  await assert.rejects(error.list(), e => !String(e).includes(key));
  const invalidJson = createProviderClient({ baseUrl: 'http://localhost', token, fetchImpl: async () => new Response(key) });
  await assert.rejects(invalidJson.list(), e => !String(e).includes(key));
});

test('real CLI provider setup masks pasted keys and submits only after explicit confirmation', { skip: process.platform === 'win32' }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'provider-pty-')));
  t.after(() => rm(directory, { recursive: true, force: true })); let submitted = null;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/providers'); assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.method === 'POST') {
      let text = ''; for await (const part of request) text += part;
      submitted = JSON.parse(text); response.setHeader('content-type','application/json'); response.end(JSON.stringify({ saved: true, validation, settings }));
    } else { response.setHeader('content-type','application/json'); response.end(JSON.stringify(settings)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const credential = join(directory, 'session.json');
  await writeFile(credential, JSON.stringify({ token, issuedAt: new Date().toISOString(), backendUrl: url }), { mode: 0o600 });
  const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const program = String.raw`
import json,os,pty,select,subprocess,sys,time
master,slave=pty.openpty()
p=subprocess.Popen([sys.argv[1],sys.argv[2],'provider:setup','--backend',sys.argv[3],'--credential',sys.argv[4]],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
output=b''
def until(needle):
 global output
 end=time.monotonic()+15
 while time.monotonic()<end:
  if needle in output:return
  if select.select([master],[],[],.1)[0]:
   try: output+=os.read(master,65536)
   except OSError:break
 raise AssertionError('Wizard did not reach expected stage: '+repr(needle)+'; screen='+repr(output.replace(b'synthetic-masked-provider-key',b'<MASKED>').decode('utf8','replace')))
def enter(text):
 os.write(master,text)
 time.sleep(.15)
 os.write(master,bytes([13]))
try:
 until(b'Provider number');enter(b'1')
 until(b'Model ID');enter(b'test-model')
 until(b'API key (masked)');enter(b'synthetic-masked-provider-key')
 until(b'Type connect');enter(b'connect')
 until(b'Key validated, saved and selected');until(b'Press Enter to return');os.write(master,bytes([13]))
 end=time.monotonic()+10
 while p.poll() is None and time.monotonic()<end:
  if select.select([master],[],[],.1)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
 p.wait(timeout=2)
 assert b'synthetic-masked-provider-key' not in output,'Key leaked to terminal'
 assert b'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' not in output,'Owner token leaked'
 assert b'*' in output,'Masked entry was not rendered'
 assert p.returncode==0
 print(json.dumps({'exit':p.returncode,'masked':True,'secretLeaked':False}))
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master)
`;
  const result = await execute('python3', ['-c', program, process.execPath, cli, url, credential], { timeout: 45000, env: { PATH: process.env.PATH, HOME: directory, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' } });
  assert.deepEqual(JSON.parse(result.stdout), { exit: 0, masked: true, secretLeaked: false });
  assert.deepEqual(submitted, { action: 'connect', provider: 'openai', model: 'test-model', apiKey: key, allowInferenceTest: false });
});
