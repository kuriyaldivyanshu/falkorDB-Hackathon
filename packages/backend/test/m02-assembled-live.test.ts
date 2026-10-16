import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isConnectProviderResult } from '@threadline/shared';
import type { StartRunInput } from '@threadline/shared';

import { parseBackendConfig, type BackendConfig } from '../src/config.js';
import { createBackend, type Backend } from '../src/index.js';
import { createChatCompletionsDriver } from '../src/provider/chat-completions.js';
import { createSqlDatabase } from '../src/storage/pg.js';
import { createGraphStore } from '../src/storage/graph.js';
import { createJsonLogger, silentLogger } from '../src/log.js';
import { createRuntimeLoop, type LoopOutcome } from '../src/runtime/loop.js';
import { rebuildNextInput, recordsForTurn, type DurableRecord } from '../src/runtime/history.js';
import { prepareCandidateWorkspace } from '../src/workspace/candidate.js';
import { createWorkspaceReader } from '../src/workspace/read-only.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';
import type { ConversationItem, ProviderTurnResult, ResponsesDriver } from '../src/provider/responses.js';
import type { ClaimState, RunContext, RuntimeActivity, TurnGuard } from '../src/runtime/contracts.js';

/**
 * Assembled M02 proof: Agent B's kernel, driver, history and candidate running
 * against Agent A's **real** storage-backed TurnGuard, real PostgreSQL and real
 * FalkorDB.
 *
 * The provider is a scripted fixture injected explicitly through this file. It is
 * never selectable from backend configuration and it opens no socket, so no
 * inference request is possible.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED = join(REPO_ROOT, 'fixtures/inventory-export-v1/seed');
const LIVE_PREFIX = `m02-assembled-${process.pid}-${randomUUID().slice(0, 8)}`;
let caseNumber = 0;

const live = process.env['THREADLINE_LIVE'] === '1';
const options = { skip: live ? false : 'set THREADLINE_LIVE=1 with reachable verification stores' };

function readLocalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  let text = '';
  let directory = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      text = readFileSync(join(directory, '.env'), 'utf8');
      break;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) env[match[1]] = match[2];
  }
  return env;
}

function liveConfig(): BackendConfig {
  const slug = `${LIVE_PREFIX}-${++caseNumber}`;
  return parseBackendConfig({
    env: {
      ...readLocalEnv(),
      THREADLINE_PROVIDER: 'openai',
      THREADLINE_PROVIDER_API: 'responses',
      THREADLINE_PROVIDER_BASE_URL: 'https://api.openai.com/v1',
      THREADLINE_STORAGE_MODE: 'required',
      THREADLINE_PORT: '0',
      THREADLINE_DATA_DIR: join(tmpdir(), slug),
      THREADLINE_TENANT_SLUG: slug,
      THREADLINE_PG_HOST: '127.0.0.1',
      THREADLINE_PG_PORT: process.env['THREADLINE_LIVE_PGPORT'] ?? '55434',
      THREADLINE_PG_DATABASE: process.env['THREADLINE_LIVE_PGDATABASE'] ?? 'threadline_agent_b',
      THREADLINE_PG_USER: process.env['THREADLINE_LIVE_PGUSER'] ?? 'threadline_app',
      THREADLINE_PG_PASSWORD: process.env['THREADLINE_LIVE_PGPASSWORD'] ?? '',
      THREADLINE_PG_MIGRATION_USER: process.env['THREADLINE_LIVE_PGMIGRATIONUSER'] ?? 'threadline',
      THREADLINE_PG_MIGRATION_PASSWORD:
        process.env['THREADLINE_LIVE_PGMIGRATIONPASSWORD'] ??
        process.env['THREADLINE_LIVE_PGPASSWORD'] ??
        '',
      THREADLINE_PG_APPLICATION_ROLE: 'threadline_app',
      THREADLINE_FALKORDB_HOST: '127.0.0.1',
      THREADLINE_FALKORDB_PORT: process.env['THREADLINE_LIVE_GRAPHPORT'] ?? '56381',
      THREADLINE_OPENAI_API_KEY: process.env['THREADLINE_LIVE_APIKEY'] ?? 'agent-b-fixture-credential',
      THREADLINE_PROVIDER_MODEL: 'fixture-model-m02b',
    },
  });
}

// ---- scripted fixture provider ---------------------------------------------

/** Reproduces the real driver's ordering: publish exact bytes, then answer. */
function scriptedProvider(turns: readonly ProviderTurnResult[]): {
  driver: ResponsesDriver;
  bodies: string[];
  count: () => number;
} {
  const bodies: string[] = [];
  let index = 0;
  const driver: ResponsesDriver = {
    async turn(request) {
      const next = turns[Math.min(index, turns.length - 1)];
      index += 1;
      if (next === undefined) throw new Error('scripted provider ran out of turns');
      const requestBody = JSON.stringify({
        model: request.model,
        input: request.input,
        tools: request.tools,
        max_output_tokens: request.maxOutputTokens,
        stream: true,
        store: false,
        parallel_tool_calls: false,
      });
      await request.authorizeAndJournal({
        ...request.identity,
        requestBody,
        requestDigest: createHash('sha256').update(requestBody).digest('hex'),
        requestBytes: Buffer.byteLength(requestBody),
        model: request.model,
        maxOutputTokens: request.maxOutputTokens,
        inputItems: request.input.length,
        toolCount: request.tools.length,
      });
      bodies.push(requestBody);
      for (const item of next.output) if ('role' in item && item.role === 'assistant') request.onVisibleText?.(item.content);
      return next;
    },
  };
  return { driver, bodies, count: () => index };
}

const completed = (output: ConversationItem[]): ProviderTurnResult => ({
  status: 'completed',
  reason: 'completed',
  responseId: 'resp-fixture',
  requestId: 'provider-request-fixture',
  possibleCharge: true,
  usage: { inputTokens: 120, outputTokens: 40 },
  output,
});

const toolCall = (callId: string, name: string, args: unknown): ConversationItem => ({
  type: 'function_call',
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
});

// ---- assembled fixture ------------------------------------------------------

interface Assembled {
  readonly backend: Backend;
  readonly execution: NonNullable<ReturnType<Backend['services']['execution']>>;
  readonly guard: TurnGuard;
  readonly scope: RunContext;
  readonly candidateRoot: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly principal: Awaited<ReturnType<typeof principalOf>>;
  readonly call: LoopCall;
}

interface LoopCall {
  (
    turns: readonly ProviderTurnResult[],
    input: readonly ConversationItem[],
    signal?: AbortSignal,
  ): Promise<{ outcome: LoopOutcome; bodies: string[]; activity: RuntimeActivity[]; turns: number }>;
}

async function principalOf(backend: Backend) {
  const file = backend.localBootstrap?.sessionTokenPath;
  assert.ok(file, 'the local bootstrap must publish a session token path');
  const token = (JSON.parse(await readFile(file, 'utf8')) as { token: string }).token;
  return backend.services.authenticate(`Bearer ${token}`);
}

async function acceptedGoal(backend: Backend) {
  const principal = await principalOf(backend);
  const projectId = backend.localBootstrap?.projectId ?? '';
  const file = backend.localBootstrap?.sessionTokenPath ?? '';
  const token = (JSON.parse(await readFile(file, 'utf8')) as { token: string }).token;
  const outcome = await backend.dispatch(
    {
      protocolVersion: 1,
      command: 'task.accept_goal',
      input: {
        projectId,
        requestId: randomUUID(),
        fixtureId: 'inventory-export-v1',
        goalText: 'Produce deterministic CSV for valid fresh inventory rows.',
        requirements: [
          { field: 'max_age_seconds', type: 'integer', value: 600, minimum: 0, maximum: 3600, revision: 1 },
        ],
        criteria: [
          { kind: 'assertion', ref: 'initial-mixed-offsets', text: 'Deterministic CSV.', required: true, expectedExitCode: 0 },
        ],
      },
    },
    `Bearer ${token}`,
  );
  assert.equal(outcome.status, 200, `goal admission failed: ${JSON.stringify(outcome.body)}`);
  return { principal, projectId };
}

/** The real candidate directory this run's tools are allowed to read. */
async function preparedCandidate(runId: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'threadline-b-candidate-')));
  const prepared = await prepareCandidateWorkspace({ runId, candidateRoot: join(root, 'candidate'), seedRoot: SEED });
  return prepared.root;
}

async function assembled(options_: { fixtureProfile?: boolean } = {}): Promise<Assembled> {
  const backend = createBackend({ config: liveConfig(), logger: silentLogger });
  await backend.start();
  const bootstrap = backend.localBootstrap;
  assert.ok(bootstrap, 'storage readiness must publish a local bootstrap');
  const execution = backend.services.execution();
  assert.ok(execution, 'the execution surface must exist once storage is ready');

  {
    const principal = await principalOf(backend);
    for (const runId of await execution.listActiveRuns(bootstrap.tenantId, bootstrap.projectId)) {
      await execution.cancel(principal, runId, 'agent_b_retire_between_cases');
    }
  }

  const { principal, projectId } = await acceptedGoal(backend);
  const authority = await backend.services.authority(principal, projectId);
  const isFixture = options_.fixtureProfile !== false;

  const account = await execution.registry.registerProviderAccount({
    tenantId: bootstrap.tenantId,
    userId: principal.userId,
    provider: 'openai',
    runtime: 'owned-responses',
    authRoute: isFixture ? 'local' : 'api_key',
    label: 'agent b assembled account',
    secretRef: null,
    probeStatus: isFixture ? 'fixture' : 'configured',
  });
  const profile = await execution.registry.registerProviderProfile({
    tenantId: bootstrap.tenantId,
    projectId,
    ownerUserId: principal.userId,
    providerAccountId: account.id,
    name: 'agent b assembled profile',
    modelId: 'fixture-model-m02b',
    adapterVersion: 'responses@6.8.0',
    // Effective capacity must be declared by the admitted profile; the budget
    // path fails closed when it is absent.
    settings: { contextWindowTokens: 128_000, maxOutputTokens: 1500 },
  });

  const candidateRoot = await preparedCandidate('assembled-run');
  const fingerprint = createHash('sha256').update(candidateRoot).digest('hex');
  const host = await execution.registry.registerHost({
    tenantId: bootstrap.tenantId,
    userId: principal.userId,
    name: 'local-backend',
    allowedRoots: [candidateRoot],
    capabilities: ['workspace.read', 'workspace.search', 'workspace.inspect'],
  });
  const registration = await execution.registry.registerWorkspace({
    tenantId: bootstrap.tenantId,
    projectId,
    hostId: host.hostId,
    label: 'agent b candidate',
    canonicalPath: candidateRoot,
    repositoryFingerprint: fingerprint,
    kind: 'builder',
  });

  const input: StartRunInput & { hostId: string; workspacePath: string; workspaceFingerprint: string } = {
    projectId,
    requestId: randomUUID(),
    taskId: authority.taskId,
    profileId: profile.id,
    workspaceId: registration.id,
    hostId: host.hostId,
    workspacePath: candidateRoot,
    workspaceFingerprint: fingerprint,
    expectedRevision: authority.goalRevision,
    expectedRequirementRevision: authority.requirementRevision,
  };
  const started = await execution.start(
    { apiKey: 'agent-b-fixture-credential', fixtureProfileAllowed: isFixture },
    principal,
    input,
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted', `run admission failed: ${JSON.stringify(started)}`);
  if (started.kind !== 'admitted') throw new Error('unreachable');
  const run = started.run;

  const scope: RunContext = {
    tenantId: bootstrap.tenantId,
    projectId,
    runId: run.runId,
    sessionId: run.sessionId,
    taskId: authority.taskId,
    profileId: profile.id,
    workspaceId: run.workspaceId,
    graphEpoch: run.graphEpoch,
    model: run.model,
    correlationId: run.correlationId,
  };
  const claim: ClaimState = {
    fence: run.claim.fence,
    revision: run.claim.revision,
    requirementRevision: run.claim.requirementRevision,
    leaseExpiresMs: new Date(run.claim.leaseExpiresAt).getTime(),
  };
  const guard = execution.turnGuard(scope, claim);
  const reader = createWorkspaceReader({ root: candidateRoot, authorize: async () => {} });

  const call: LoopCall = async (turns, loopInput, signal = new AbortController().signal) => {
    const { driver, bodies } = scriptedProvider(turns);
    const activity: RuntimeActivity[] = [];
    const loop = createRuntimeLoop({
      driver,
      tools: { invoke: (name, toolInput) => reader.invoke(name, toolInput) },
      guard,
      sink: (value) => activity.push(value),
      tools4Provider: READ_ONLY_FUNCTIONS,
    });
    const outcome = await loop.run(
      {
        context: scope,
        claim,
        budget: {
          maxAttempts: run.budget.maxAttempts,
          attemptsUsed: run.budget.attemptsUsed,
          maxToolCalls: run.budget.maxToolCalls,
          toolCallsUsed: run.budget.toolCallsUsed,
          maxTotalTokens: run.budget.maxTotalTokens,
          reservedTokens: run.budget.reservedTokens,
          observedTokens: run.budget.observedTokens,
          deadlineMs: new Date(run.budget.deadlineAt).getTime() - Date.now(),
        },
        policy: {
          maxAttempts: 25,
          maxToolCalls: 80,
          maxTotalTokens: 120_000,
          maxInputTokens: 12_000,
          maxOutputTokens: 1_500,
          deadlineMs: 30 * 60 * 1000,
          claimLeaseMs: 30_000,
          claimHeartbeatMs: 0,
        },
        apiKey: 'agent-b-fixture-credential',
      },
      loopInput,
      signal,
    );
    return { outcome, bodies, activity, turns: bodies.length };
  };

  return {
    backend, execution, guard, scope, candidateRoot,
    projectId, tenantId: bootstrap.tenantId, sessionId: run.sessionId, taskId: authority.taskId,
    principal, call,
  };
}

const initialInput = (taskId: string): ConversationItem[] => [
  { role: 'user', content: `Current task ${taskId}. Inspect the candidate before changing anything.` },
];

test('assembled: a real read reaches the registered candidate, is persisted, and appears in the next request', options, async () => {
  const built = await assembled();
  try {
    const { outcome, bodies, activity } = await built.call(
      [
        completed([toolCall('call-read-1', 'workspace_read', { path: 'src/exporter.mjs' })]),
        completed([{ role: 'assistant', content: 'The authored exporter is present.' }]),
      ],
      initialInput(built.taskId),
    );

    assert.equal(outcome.stop, 'final_output', `unexpected stop: ${outcome.reason}`);
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.toolCalls, 1);
    assert.equal(outcome.releasedToolCalls, 1);
    assert.equal(bodies.length, 2);
    assert.ok(outcome.visibleText.includes('authored exporter'));

    // The next request carries the exact persisted tool result.
    const second = JSON.parse(bodies[1] as string) as { input: ConversationItem[] };
    const outputs = second.input.filter((item) => 'type' in item && item.type === 'function_call_output');
    assert.equal(outputs.length, 1, 'the durable tool result must be in the next provider input');
    const output = JSON.parse(String((outputs[0] as { output: string }).output)) as { text: string; digest: string };
    assert.match(output.text, /updatedAt/, 'the result must be the real candidate file');
    assert.match(output.digest, /^[0-9a-f]{64}$/);

    // The stable call id survived into the next request.
    const calls = second.input.filter((item) => 'type' in item && item.type === 'function_call');
    assert.equal((calls[0] as { call_id: string }).call_id, 'call-read-1');

    // Durable attempt records exist for both turns and are readable after the fact.
    const inspected = await built.execution.inspect(built.principal, built.scope.runId);
    assert.equal(inspected.attempts.length, 2, `expected two durable attempts, found ${inspected.attempts.length}`);
    assert.ok(inspected.attempts.some((a) => a.state === 'completed'), 'a completed attempt must be recorded');

    // The published input artifact hashes to the exact bytes that were sent.
    const rows = [];
    for (const attempt of inspected.attempts) {
      const row = await built.execution.journal.find(built.tenantId, built.projectId, attempt.attemptId);
      assert.ok(row, `attempt ${attempt.attemptId} must be durable`);
      rows.push(row);
    }
    for (const row of rows) {
      const saved = await built.execution.artifacts.read(
        built.tenantId, built.projectId, row.inputArtifactId,
      );
      const text = saved.toString('utf8');
      assert.equal(
        createHash('sha256').update(text).digest('hex'),
        row.inputDigest,
        'the saved input bytes must hash to the recorded digest',
      );
      assert.ok(JSON.parse(text).input.length >= 1);
      assert.ok(bodies.some((body) => body === text), 'a stored artifact must equal a transmitted body byte for byte');
    }

    assert.ok(activity.some((a) => a.kind === 'tool_state' && a.state === 'succeeded'));
  } finally {
    await built.backend.stop();
  }
});

test('assembled: observed usage is recorded and never invented as zero', options, async () => {
  const built = await assembled();
  try {
    await built.call([completed([{ role: 'assistant', content: 'done' }])], initialInput(built.taskId));
    const inspected = await built.execution.inspect(built.principal, built.scope.runId);
    const finished = inspected.attempts.find((a) => a.state === 'completed');
    assert.ok(finished, 'a completed attempt must be durable');
    const row = await built.execution.journal.find(built.tenantId, built.projectId, finished.attemptId);
    assert.ok(row);
    assert.equal(row.usage.precision, 'reported');
    assert.equal(row.usage.precision === 'reported' ? row.usage.inputTokens : -1, 120);
    assert.equal(row.usage.precision === 'reported' ? row.usage.outputTokens : -1, 40);
  } finally {
    await built.backend.stop();
  }
});

test('assembled: a partial terminal batch releases no tool and blocks reconciliation', options, async () => {
  const built = await assembled();
  try {
    const { outcome } = await built.call(
      [{ ...completed([toolCall('call-partial', 'workspace_read', { path: 'src/exporter.mjs' })]), status: 'unknown', usage: null, output: [] }],
      initialInput(built.taskId),
    );
    assert.notEqual(outcome.stop, 'final_output');
    assert.equal(outcome.toolCalls, 0, 'a partial batch must execute nothing');
    assert.equal(outcome.blockedOnReconciliation, true);

    const inspected = await built.execution.inspect(built.principal, built.scope.runId);
    assert.ok(inspected.attempts.some((a) => a.state === 'unknown'), 'an unknown attempt must be durable');
    assert.ok(inspected.unresolvedAttempts > 0, 'an unresolved attempt must block new turns');
    const unknown = inspected.attempts.find((a) => a.state === 'unknown');
    const row = unknown ? await built.execution.journal.find(built.tenantId, built.projectId, unknown.attemptId) : null;
    assert.ok(row && row.usage.precision !== 'reported', 'unknown usage is never reported as a zero reading');
  } finally {
    await built.backend.stop();
  }
});

test('assembled: an unregistered tool name performs no workspace access', options, async () => {
  const built = await assembled();
  try {
    const { outcome, bodies } = await built.call(
      [
        completed([toolCall('call-evil', 'workspace_delete', { path: 'src/exporter.mjs' })]),
        completed([{ role: 'assistant', content: 'refused' }]),
      ],
      initialInput(built.taskId),
    );
    assert.equal(outcome.stop, 'final_output');
    const second = JSON.parse(bodies[1] as string) as { input: ConversationItem[] };
    const outputs = second.input.filter((item) => 'type' in item && item.type === 'function_call_output');
    assert.equal(outputs.length, 1, 'the denial is still a durable tool result');
    assert.match(String((outputs[0] as { output: string }).output), /unknown_tool/);
  } finally {
    await built.backend.stop();
  }
});

test('assembled: history rebuilds the same input from durable records the loop actually produced', options, async () => {
  const built = await assembled();
  try {
    const records: DurableRecord[] = recordsForTurn({
      startOrdinal: 0,
      visibleOutput: [{ role: 'assistant', content: 'Reading the file.' }],
      toolCalls: [{ callId: 'c1', toolName: 'workspace_read', argumentsJson: '{"path":"src/exporter.mjs"}' }],
      toolResults: [],
    }).concat(
      recordsForTurn({
        startOrdinal: 2,
        visibleOutput: [],
        toolCalls: [],
        toolResults: [{ callId: 'c1', outputJson: '{"kind":"read"}' }],
      }),
    );
    const rebuilt = rebuildNextInput(records);
    assert.equal(rebuilt.items.length, 3);
    assert.match(rebuilt.digest, /^[0-9a-f]{64}$/);
  } finally {
    await built.backend.stop();
  }
});

test('managed HTTP: prepare, start, inspect and retry use the real loop without another dispatch', options, async t => {
  const provider = scriptedProvider([
    completed([toolCall('managed-read', 'workspace_read', { path: 'src/exporter.mjs', offset: 0, maxBytes: 512 })]),
    completed([{ role: 'assistant', content: 'Candidate inspected; UTC formatting needs work.' }]),
  ]);
  const config = liveConfig();
  const graphs = createGraphStore({ config: config.storage.falkordb, logger: silentLogger });
  const backend = createBackend({ config, graphStore: graphs, logger: silentLogger, runtimeDriver: provider.driver });
  try {
    const address = await backend.start();
    const { projectId } = await acceptedGoal(backend);
    const token = (JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')) as { token: string }).token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const cli = await promisify(execFile)(process.execPath, [join(REPO_ROOT, 'packages/cli/dist/index.js'),
      'run:prepare', '--backend', address.url, '--credential', backend.localBootstrap!.sessionTokenPath,
      '--project', projectId, '--context-window', '128000'], { env: { TERM: 'xterm-256color' } });
    const input = JSON.parse(cli.stdout) as StartRunInput;
    const streamAbort = new AbortController();
    const stream = await fetch(`${address.url}/events`, { headers, signal: AbortSignal.any([streamAbort.signal, AbortSignal.timeout(10_000)]) });
    const privateActivity = (async () => {
      const reader = stream.body!.getReader();
      let text = '';
      try {
        while (!text.includes('Candidate inspected; UTC formatting needs work.')) {
          const part = await reader.read(); if (part.done) break;
          text += new TextDecoder().decode(part.value);
        }
        return text;
      } finally { await reader.cancel(); }
    })();
    let terminalOutput = '';
    const terminal = process.platform === 'darwin' ? spawn('python3', ['-c', `
import os, pty, select, subprocess, sys, fcntl, struct
master, slave = pty.openpty()
fcntl.ioctl(slave, 0x80087467, struct.pack('HHHH', 30, 140, 0, 0))
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
try:
 while child.poll() is None:
  readable, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.1)
  if master in readable:
   try: data = os.read(master, 65536)
   except OSError: break
   if data: sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
  if sys.stdin.buffer in readable:
   data = os.read(sys.stdin.fileno(), 1024)
   if data: os.write(master, data)
finally:
 os.close(master)
sys.exit(child.wait())
`, process.execPath,
      join(REPO_ROOT, 'packages/cli/dist/index.js'), 'tui', '--backend', address.url,
      '--credential', backend.localBootstrap!.sessionTokenPath], { env: { TERM: 'xterm-256color', PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, stdio: 'pipe' }) : null;
    const exited = terminal ? new Promise<number | null>(resolve => terminal.once('exit', resolve)) : null;
    terminal?.stdout.on('data', chunk => { terminalOutput += String(chunk); });
    terminal?.stderr.on('data', chunk => { terminalOutput += String(chunk); });
    t.after(() => { if (terminal?.exitCode === null) terminal.kill('SIGTERM'); });
    if (terminal) {
      for (let n = 0; n < 150 && backend.events.listenerCount < 2; n++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(backend.events.listenerCount >= 2, `the real TUI must subscribe before the run begins: ${terminalOutput.split(token).join('<redacted>')}`);
    }
    assert.equal(provider.count(), 0, 'preparation is never inference');
    const started = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(started.status, 200, await started.clone().text());
    const answer = await started.json() as { kind: string; run: { runId: string } };
    assert.equal(answer.kind, 'admitted');
    let inspected: { run: { state: string }; attempts: { state: string; attemptId: string; logicalRequestId: string }[] } | undefined;
    for (let n = 0; n < 100; n++) {
      const result = await fetch(`${address.url}/runs/${answer.run.runId}`, { headers });
      assert.equal(result.status, 200, await result.clone().text());
      inspected = await result.json() as typeof inspected;
      if (inspected?.run.state === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(inspected?.run.state, 'completed', JSON.stringify(inspected));
    assert.equal(provider.count(), 2);
    assert.equal(inspected.attempts.length, 2);
    assert.ok(inspected.attempts.every(a => a.state === 'completed' && a.attemptId !== a.logicalRequestId));
    const replay = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json() as { kind: string }).kind, 'replayed');
    assert.equal(provider.count(), 2, 'retrying start never repeats inference');
    assert.match(await privateActivity, /tool_state/);
    if (terminal) {
      for (let n = 0; n < 150 && !terminalOutput.includes('run.activity'); n++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(terminalOutput, /run.activity/, 'the real PTY TUI displays model/tool activity');
      assert.ok(!terminalOutput.includes(token), 'the TUI never renders its session token');
      terminal.stdin.write('\u001b');
      const exitCode = await Promise.race([exited, new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('TUI did not restore and exit after Esc')), 5000); timer.unref();
      })]);
      assert.equal(exitCode, 0);
    }
    streamAbort.abort();
    const mismatch = await fetch(`${address.url}/runs/start`, { method: 'POST', headers,
      body: JSON.stringify({ ...input, expectedRevision: input.expectedRevision + 1 }) });
    assert.equal(mismatch.status, 409, 'changed input cannot reuse a request ID');
    assert.equal(provider.count(), 2);
    const authority = await backend.services.authority(await principalOf(backend), projectId);
    assert.equal(authority.taskStatus, 'ready', 'execution ending does not accept task completion');
    await graphs.graph(authority.graphKey).query('MATCH (r:RequestReceipt {request_id:$request_id}) DELETE r',
      { params: { request_id: input.requestId } });
    const pending = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(pending.status, 202, 'a missing claim receipt must never become a false successful replay');
    assert.equal((await pending.json() as { kind: string }).kind, 'accepted');
    assert.equal(provider.count(), 2, 'unresolved receipt recovery never resends inference');
  } finally { await backend.stop(); }
});

test('managed HTTP: heartbeat advances a live lease; cancellation aborts the driver and retains unknown usage', options, async () => {
  const fixture = scriptedProvider([completed([])]);
  let entered!: () => void;
  const dispatched = new Promise<void>(resolve => { entered = resolve; });
  const driver: ResponsesDriver = { async turn(request) {
    await fixture.driver.turn(request); // Real journal barrier, no network.
    request.onLifecycle?.({ phase: 'dispatched', attempt: { ...request.identity, requestDigest: 'fixture-observation' } });
    entered();
    if (!request.signal.aborted) await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }));
    return { status: 'cancelled', reason: 'cancelled_after_dispatch', responseId: null, requestId: null,
      possibleCharge: true, usage: null, output: [] };
  } };
  const backend = createBackend({ config: liveConfig(), logger: silentLogger, runtimeDriver: driver });
  try {
    const address = await backend.start();
    const { projectId, principal } = await acceptedGoal(backend);
    const token = (JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')) as { token: string }).token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const prepared = await fetch(`${address.url}/runs/prepare`, { method: 'POST', headers,
      body: JSON.stringify({ projectId, contextWindowTokens: 128_000 }) });
    const input = await prepared.json();
    const started = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(started.status, 200, await started.clone().text());
    const answer = await started.json() as { run: { runId: string; claim: { fence: number; leaseExpiresAt: string } } };
    await dispatched;
    const heartbeat = await fetch(`${address.url}/runs/${answer.run.runId}/heartbeat`, { method: 'POST', headers, body: '{}' });
    if (heartbeat.status !== 200) {
      try { await backend.services.execution()!.heartbeat(principal, answer.run.runId); }
      catch (error) { assert.fail(error instanceof Error ? error.stack : String(error)); }
    }
    assert.equal(heartbeat.status, 200, await heartbeat.clone().text());
    const renewed = await heartbeat.json() as { leaseExpiresAt: string; fence: number };
    assert.ok(Date.parse(renewed.leaseExpiresAt) >= Date.parse(answer.run.claim.leaseExpiresAt));
    assert.equal(renewed.fence, answer.run.claim.fence, 'renewing a lease does not invalidate its worker fence');
    const cancelled = await fetch(`${address.url}/runs/cancel`, { method: 'POST', headers,
      body: JSON.stringify({ runId: answer.run.runId, reason: 'explicit owner cancellation' }) });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json() as { acknowledged: boolean }).acknowledged, true);
    let view = await backend.services.execution()!.inspect(principal, answer.run.runId);
    for (let n = 0; n < 100 && view.attempts[0]?.state !== 'cancelled'; n++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      view = await backend.services.execution()!.inspect(principal, answer.run.runId);
    }
    assert.equal(view.attempts[0]?.state, 'cancelled');
    assert.equal(view.run.budget.observedTokens, 0, 'no observed usage is invented');
    assert.ok(view.run.budget.reservedTokens > 0, 'an uncertain cancelled send retains a durable reservation');
    assert.equal(fixture.count(), 1);
  } finally { await backend.stop(); }
});

test('managed activity never reaches an unauthenticated subscriber', options, async () => {
  const backend = createBackend({ config: liveConfig(), logger: silentLogger });
  try {
    const address = await backend.start();
    const stream = await fetch(`${address.url}/events`, { signal: AbortSignal.timeout(3000) });
    const received = stream.text();
    backend.events.publish('run.activity', { tenantId: backend.localBootstrap!.tenantId,
      projectId: backend.localBootstrap!.projectId, runId: randomUUID(), sessionId: randomUUID(),
      kind: 'visible_text', state: '', detail: 'private synthetic output' });
    assert.doesNotMatch(await received, /private synthetic output|event: run.activity/);
  } finally { await backend.stop(); }
});

for (const failedStore of ['sql', 'graph'] as const) {
  test(`managed HTTP: losing ${failedStore} refuses execution before provider dispatch`, options, async () => {
    const config = liveConfig();
    const db = createSqlDatabase({ config: config.storage.postgres, logger: silentLogger });
    const graph = createGraphStore({ config: config.storage.falkordb, logger: silentLogger });
    const fixture = scriptedProvider([completed([])]);
    const backend = createBackend({ config, logger: silentLogger, database: db, graphStore: graph, runtimeDriver: fixture.driver });
    try {
      const address = await backend.start();
      const { projectId } = await acceptedGoal(backend);
      const token = (JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')) as { token: string }).token;
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const prepared = await fetch(`${address.url}/runs/prepare`, { method: 'POST', headers,
        body: JSON.stringify({ projectId, contextWindowTokens: 128_000 }) });
      assert.equal(prepared.status, 200);
      const input = await prepared.json();
      if (failedStore === 'sql') await db.close(); else await graph.close();
      const result = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(input) });
      assert.equal(result.status, 503, await result.clone().text());
      assert.equal(fixture.count(), 0, 'required-store loss must never fall back to inference');
    } finally { await backend.stop(); }
  });
}

test('OpenCode Go chat transport runs the same durable tool loop and rebuilds chat history', options, async () => {
  const initial = liveConfig();
  const baseUrl = 'https://opencode.ai/inference/go/openai/v1';
  const config: BackendConfig = { ...initial, storage: { ...initial.storage, providerId: 'opencode-go',
    providerApi: 'chat-completions', providerBaseUrl: baseUrl, providerModel: 'space-bunny', providerApiKey: 'synthetic-go-key' } };
  const sent: string[] = [];
  const driver = createChatCompletionsDriver({ apiKey: 'synthetic-go-key', baseUrl, sessionId: 'fixture-stable-session',
    fetchImpl: async (url, init) => {
      assert.equal(url, `${baseUrl}/chat/completions`);
      const body = String(init?.body); sent.push(body);
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, 'space-bunny');
      const content = sent.length === 1 ? { tool_calls: [{ index: 0, id: 'chat-read-1', type: 'function',
        function: { name: 'workspace_read', arguments: '{"path":"src/exporter.mjs","offset":0,"maxBytes":256}' } }] }
        : { content: 'UTC formatting defect observed in the candidate.' };
      if (sent.length === 2) {
        const result = parsed.messages.find((m: { role: string }) => m.role === 'tool');
        assert.equal(result.tool_call_id, 'chat-read-1');
        assert.match(JSON.parse(result.content).text, /Authored imperfect seed/);
      }
      const chunks = [
        { id: `chat-${sent.length}`, choices: [{ index: 0, delta: content, finish_reason: null }] },
        { id: `chat-${sent.length}`, choices: [{ index: 0, delta: {}, finish_reason: sent.length === 1 ? 'tool_calls' : 'stop' }] },
        { id: `chat-${sent.length}`, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    } });
  // Exercise production log validation as well: a silent logger concealed a
  // post-commit rejection of numeric usage counters in the real Go run.
  const backend = createBackend({ config, runtimeDriver: driver, logger: createJsonLogger({ component: 'go-conformance' }) });
  try {
    const address = await backend.start();
    const { projectId, principal } = await acceptedGoal(backend);
    const token = (JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')) as { token: string }).token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const prep = await fetch(`${address.url}/runs/prepare`, { method: 'POST', headers,
      body: JSON.stringify({ projectId, contextWindowTokens: 128_000 }) });
    assert.equal(prep.status, 200);
    const prepared = await prep.json();
    const start = await fetch(`${address.url}/runs/start`, { method: 'POST', headers, body: JSON.stringify(prepared) });
    assert.equal(start.status, 200, await start.clone().text());
    const answer = await start.json() as { run: { runId: string } };
    const execution = backend.services.execution()!;
    let view = await execution.inspect(principal, answer.run.runId);
    for (let n = 0; n < 150 && view.run.state !== 'completed'; n++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      view = await execution.inspect(principal, answer.run.runId);
    }
    assert.equal(view.run.state, 'completed', JSON.stringify(view));
    assert.equal(sent.length, 2);
    assert.equal(view.run.budget.observedTokens, 240);
    for (const attempt of view.attempts) {
      const bytes = await execution.artifacts.read(principal.tenantId, projectId, attempt.inputArtifactId);
      assert.ok(sent.includes(bytes.toString('utf8')));
      assert.equal(attempt.inputDigest, createHash('sha256').update(bytes).digest('hex'));
    }
  } finally { await backend.stop(); }
});

test('native Anthropic Messages runs a durable read-tool continuation', options, async () => {
  const { createAnthropicDriver } = await import('../src/provider/anthropic.js');
  const initial = liveConfig(), baseUrl = 'https://api.anthropic.com/v1';
  const config: BackendConfig = { ...initial, storage: { ...initial.storage, providerId: 'anthropic', providerApi: 'anthropic-messages', providerBaseUrl: baseUrl, providerModel: 'claude-fixture', providerApiKey: 'synthetic-anthropic-key' } };
  const sent: string[] = [];
  const driver = createAnthropicDriver({ apiKey: 'synthetic-anthropic-key', baseUrl, fetchImpl: async (url, init) => {
    assert.equal(String(url), baseUrl + '/messages'); sent.push(String(init?.body));
    const parsed = JSON.parse(String(init?.body));
    if (sent.length === 2) {
      const result = parsed.messages.flatMap((m: { content: Record<string, unknown>[] }) => m.content).find((b: { type: string }) => b.type === 'tool_result');
      assert.equal(result.tool_use_id, 'native-read'); assert.match(JSON.parse(result.content).text, /Authored imperfect seed/);
    }
    return Response.json({ type: 'message', id: `msg_${sent.length}`, role: 'assistant', stop_reason: sent.length === 1 ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20 },
      content: sent.length === 1 ? [{ type: 'tool_use', id: 'native-read', name: 'workspace_read', input: { path: 'src/exporter.mjs', offset: 0, maxBytes: 256 } }] : [{ type: 'text', text: 'Observed UTC defect.' }] });
  } });
  const backend = createBackend({ config, runtimeDriver: driver, logger: createJsonLogger({ component: 'anthropic-conformance' }) });
  try {
    const address = await backend.start(); const { projectId, principal } = await acceptedGoal(backend);
    const token = JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')).token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const prep = await fetch(address.url + '/runs/prepare', { method: 'POST', headers, body: JSON.stringify({ projectId, contextWindowTokens: 128_000 }) });
    const start = await fetch(address.url + '/runs/start', { method: 'POST', headers, body: JSON.stringify(await prep.json()) });
    assert.equal(start.status, 200, await start.clone().text()); const answer = await start.json() as { run: { runId: string } };
    const execution = backend.services.execution()!; let view = await execution.inspect(principal, answer.run.runId);
    for (let n = 0; n < 150 && view.run.state !== 'completed'; n++) { await new Promise(r => setTimeout(r, 20)); view = await execution.inspect(principal, answer.run.runId); }
    assert.equal(view.run.state, 'completed', JSON.stringify(view)); assert.equal(view.unresolvedAttempts, 0); assert.equal(sent.length, 2); assert.equal(view.run.budget.observedTokens, 240);
    for (const attempt of view.attempts) assert.ok(sent.includes((await execution.artifacts.read(principal.tenantId, projectId, attempt.inputArtifactId)).toString('utf8')));
  } finally { await backend.stop(); }
});

test('owner-only provider onboarding validates before save and refuses stale prepared credential revisions', options, async () => {
  const config = liveConfig(); let probes = 0;
  const backend = createBackend({ config, providerKeyFetch: async (url, init) => {
    probes++; assert.equal(String(url), 'https://openrouter.ai/api/v1/key'); assert.equal(init?.method, 'GET');
    return new Headers(init?.headers).get('authorization')?.endsWith('bad-key') ? new Response('never echo synthetic bad-key', { status: 401 }) : Response.json({ data: { limit_remaining: 1 } });
  } });
  try {
    const address = await backend.start(); const { projectId } = await acceptedGoal(backend);
    const token = JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')).token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(address.url + '/providers')).status, 401);
    const send = (body: unknown, extra = {}) => fetch(address.url + '/providers', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const input = { action: 'connect', provider: 'openrouter', model: 'org/fixture', apiKey: 'synthetic-router-key', allowInferenceTest: false };
    assert.equal((await send(input, { origin: 'https://untrusted.invalid' })).status, 401); assert.equal(probes, 0);
    const connected = await send(input); assert.equal(connected.status, 200, await connected.clone().text()); const view = await connected.json(); assert.ok(isConnectProviderResult(view)); assert.equal(view.saved, true); assert.ok(!JSON.stringify(view).includes(input.apiKey));
    assert.equal(backend.health().components.find(c => c.name === 'provider')?.ready, true);
    const prep = await fetch(address.url + '/runs/prepare', { method: 'POST', headers, body: JSON.stringify({ projectId, contextWindowTokens: 128_000 }) }); const prepared = await prep.json();
    const bad = await (await send({ ...input, apiKey: 'synthetic-bad-key' })).json(); assert.ok(isConnectProviderResult(bad)); assert.equal(bad.saved, false); assert.equal(bad.validation.state, 'invalid');
    const rotated = await (await send({ ...input, apiKey: 'synthetic-rotated-router-key' })).json(); assert.ok(isConnectProviderResult(rotated)); assert.equal(rotated.saved, true);
    const stale = await fetch(address.url + '/runs/start', { method: 'POST', headers, body: JSON.stringify(prepared) }); assert.equal(stale.status, 401);
    const removed = await send({ action: 'remove', provider: 'openrouter' }); assert.equal(removed.status, 200); assert.equal(backend.health().components.find(c => c.name === 'provider')?.ready, false);
    assert.equal(probes, 3);
  } finally { await backend.stop(); }
});

test('review: prepare refuses a context window smaller than the configured output ceiling', options, async t => {
  const backend = createBackend({ config: liveConfig() }); t.after(() => backend.stop());
  const address = await backend.start(), { projectId } = await acceptedGoal(backend);
  const token = JSON.parse(await readFile(backend.localBootstrap!.sessionTokenPath, 'utf8')).token;
  const response = await fetch(address.url + '/runs/prepare', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ projectId, contextWindowTokens: backend.services.execution()!.limits.maxOutputTokens }) });
  assert.equal(response.status, 400);
});
