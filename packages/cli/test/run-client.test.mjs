import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createRunClient } from '../dist/transport/run-client.js';
import { BACKEND_ROUTES, routePath } from '../dist/transport/routes.js';
import { ROUTES } from '../../backend/dist/src/api/routes.js';
import { createBackend, parseBackendConfig } from '../../backend/dist/src/index.js';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const run = (args, options = {}) => execFileAsync(process.execPath, [CLI, ...args], options);

// A token is required by the client contract; no session is bootstrapped here.
const TOKEN = 'a'.repeat(43);
const emptyRun = {
  runId: 'run-x', sessionId: 'session-x', projectId: 'project-x', taskId: 'task-x',
  profileId: 'profile-x', workspaceId: 'workspace-x', model: 'fixture-model',
  graphEpoch: 'epoch-x', state: 'admitted', sessionState: 'reserved',
  claim: { taskId: 'task-x', taskClaimState: 'claimed', ownerSessionId: 'session-x',
    fence: 7, revision: 3, requirementRevision: 2, leaseExpiresAt: '2026-10-15T12:00:30.000Z' },
  budget: { maxAttempts: 25, attemptsUsed: 1, maxToolCalls: 80, toolCallsUsed: 2,
    maxTotalTokens: 120000, reservedTokens: 100, observedTokens: 900,
    deadlineAt: '2026-10-15T12:30:00.000Z', blockedOnReconciliation: false },
  correlationId: 'corr-x',
};

const respond = (body, status = 200, headers = {}) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const runClient = (fetchImpl) => createRunClient({ baseUrl: 'http://fixture.invalid', requestTimeoutMs: 1000, token: TOKEN, fetchImpl });

test('the client route table matches the backend route table exactly', () => {
  assert.deepEqual(BACKEND_ROUTES, ROUTES);
});

test('run start distinguishes admitted, accepted, replayed and rejected', async () => {
  const cases = [
    [{ kind: 'admitted', run: emptyRun }, 200, 'admitted'],
    [{ kind: 'replayed', run: emptyRun }, 200, 'replayed'],
    [{ kind: 'accepted', runId: 'r', sessionId: 's', pendingReason: 'graph pending' }, 202, 'accepted'],
    [{ kind: 'rejected', code: 'authority_conflict', reason: 'stale revision', correlationId: 'c1' }, 409, 'rejected'],
  ];
  for (const [body, status, expected] of cases) {
    const outcome = await runClient(respond(body, status)).startRun({
      projectId: 'p', requestId: 'req', taskId: 't', profileId: 'pr', workspaceId: 'w',
      expectedRevision: 1, expectedRequirementRevision: 1,
    });
    assert.equal(outcome.kind, expected);
  }
});

test('run start sends the caller identity and the bearer header, never a query string', async () => {
  let seen;
  const client = createRunClient({
    baseUrl: 'http://fixture.invalid', requestTimeoutMs: 1000, token: TOKEN,
    fetchImpl: async (url, init) => { seen = { url: String(url), init }; return respond({ kind: 'admitted', run: emptyRun })(); },
  });
  await client.startRun({ projectId: 'project-1', requestId: 'req-1', taskId: 'task-1',
    profileId: 'profile-1', workspaceId: 'workspace-1', expectedRevision: 4, expectedRequirementRevision: 2 });

  assert.equal(seen.url, 'http://fixture.invalid/runs/start');
  assert.ok(!seen.url.includes('token'), 'a token must never appear in a URL');
  assert.equal(seen.init.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(seen.init.body), { projectId: 'project-1', requestId: 'req-1',
    taskId: 'task-1', profileId: 'profile-1', workspaceId: 'workspace-1',
    expectedRevision: 4, expectedRequirementRevision: 2 });
});

test('a rejected start is not reported as success by the command', async () => {
  const client = runClient(respond({ kind: 'rejected', code: 'unauthorized', reason: 'owner mismatch', correlationId: 'c' }, 401));
  const outcome = await client.startRun({ projectId: 'p', requestId: 'r', taskId: 't',
    profileId: 'pr', workspaceId: 'w', expectedRevision: 1, expectedRequirementRevision: 1 });
  assert.equal(outcome.kind, 'rejected');
});

test('an answer with an unknown run state is a protocol error, not a guess', async () => {
  const client = runClient(respond({ kind: 'admitted', run: { ...emptyRun, state: 'definitely_running' } }));
  await assert.rejects(
    () => client.startRun({ projectId: 'p', requestId: 'r', taskId: 't', profileId: 'pr',
      workspaceId: 'w', expectedRevision: 1, expectedRequirementRevision: 1 }),
    /unknown state/,
  );
});

test('an incomplete claim or budget view is refused rather than partially trusted', async () => {
  const noBudget = runClient(respond({ kind: 'admitted', run: { ...emptyRun, budget: undefined } }));
  await assert.rejects(
    () => noBudget.startRun({ projectId: 'p', requestId: 'r', taskId: 't', profileId: 'pr',
      workspaceId: 'w', expectedRevision: 1, expectedRequirementRevision: 1 }),
    /claim or budget/,
  );
});

test('run inspect returns durable attempts and unresolved count', async () => {
  const body = { run: emptyRun, unresolvedAttempts: 1, attempts: [
    { logicalRequestId: 'l1', attemptId: 'a1', attemptNo: 1, state: 'unknown',
      providerRequestId: 'pr1', possibleCharge: true, createdAt: '2026-10-15T12:00:00.000Z', finishedAt: null },
  ] };
  const view = await runClient(respond(body)).inspectRun('run-x');
  assert.equal(view.unresolvedAttempts, 1);
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].state, 'unknown');
  assert.equal(view.attempts[0].possibleCharge, true);
  assert.equal(view.run.claim.fence, 7);
});

test('a malformed attempt record is refused', async () => {
  const body = { run: emptyRun, unresolvedAttempts: 0, attempts: [{ logicalRequestId: 'l1' }] };
  await assert.rejects(() => runClient(respond(body)).inspectRun('run-x'), /attempt record was incomplete/);
});

test('a non-JSON answer is a protocol error, not a silent success', async () => {
  const client = createRunClient({ baseUrl: 'http://fixture.invalid', requestTimeoutMs: 1000, token: TOKEN,
    fetchImpl: async () => new Response('<html>gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(() => client.inspectRun('run-x'), /body was not JSON/);
});

test('cancel reports acknowledgement and usage uncertainty separately', async () => {
  const body = { acknowledged: true, runId: 'run-x', state: 'cancelled', sessionState: 'stopping',
    usageUncertain: true, reason: 'requested by owner' };
  const outcome = await runClient(respond(body)).cancelRun('run-x', 'requested by owner');
  assert.equal(outcome.acknowledged, true);
  assert.equal(outcome.usageUncertain, true);
});

test('a backend that did not register the run route is reported as fail-closed', async () => {
  const notFound = runClient(async () => new Response(
    JSON.stringify({ message: 'Route GET:/runs/run-x not found', error: 'Not Found', statusCode: 404 }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  ));
  await assert.rejects(
    () => notFound.inspectRun('run-x'),
    /did not serve this route.*fail closed/s,
  );
});

test('route templates reject path-like ids', () => {
  assert.equal(routePath(BACKEND_ROUTES.runInspect, { runId: 'abc-123' }), '/runs/abc-123');
  assert.throws(() => routePath(BACKEND_ROUTES.runInspect, { runId: '../../etc' }), /simple identifier/);
  assert.throws(() => routePath(BACKEND_ROUTES.runInspect, {}), /needs a "runId"/);
});

test('without a credential the client advertises no session and the CLI refuses run control', async () => {
  const anonymous = createRunClient({ baseUrl: 'http://fixture.invalid', requestTimeoutMs: 1000, token: null });
  assert.equal(anonymous.authenticated, false);

  // Point at a path that does not exist, so a real local session cannot leak in.
  const missing = fileURLToPath(new URL('no-such-session.json', import.meta.url));
  const failure = await run(['--credential', missing, 'run:inspect', 'run-x'])
    .then(() => null, (error) => error);
  assert.ok(failure !== null, 'run control without a session must exit non-zero');
  assert.match(failure.stdout, /No local owner session is attached/);
});

test('run control requires every identity flag rather than defaulting one', async () => {
  const cases = [
    [['run:start'], '--project'],
    [['run:start', '--project', 'p', '--task', 't', '--profile', 'pr', '--workspace', 'w',
      '--expect-revision', '1', '--expect-requirement-revision', '1'], '--request-id'],
  ];
  for (const [args, flag] of cases) {
    await assert.rejects(() => run(args), (error) => new RegExp(flag.replace(/-/g, '.')).test(String(error.stderr)), flag);
  }
  await assert.rejects(() => run(['run:cancel', 'run-x']), /--reason is required/);
  await assert.rejects(() => run(['run:inspect']), /needs the run id/);
});

test('no run command performs inference against the real backend', async () => {
  const backend = createBackend({
    config: parseBackendConfig({ env: { THREADLINE_HOST: '127.0.0.1', THREADLINE_PORT: '0' }, cwd: process.cwd() }),
  });
  const address = await backend.start();
  try {
    const before = backend.events.sequence;
    const outcome = await createRunClient({ baseUrl: address.url, requestTimeoutMs: 2000, token: TOKEN })
      .inspectRun('run-does-not-exist').then(() => 'resolved', () => 'refused');
    assert.equal(outcome, 'refused', 'an unauthenticated read must not resolve a run');
    assert.equal(backend.events.sequence, before, 'a refused read published no run event');
  } finally {
    await backend.stop();
  }
});
test('an unknown run preserves its typed not_found error and correlation id', async () => {
  const missing = runClient(async () => new Response(JSON.stringify({ code: 'not_found', message: 'No run exists for that id.', details: { correlationId: 'missing-run-correlation' } }), { status: 404 }));
  await assert.rejects(missing.inspectRun('unknown-run'), /not_found: No run exists.*missing-run-correlation/);
});
