import { createHash } from 'node:crypto';

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeLoop } from '../src/runtime/loop.js';
import type {
  ActivitySink,
  BudgetSnapshot,
  RunContext,
  RunLaunch,
  RunPolicy,
  RuntimeActivity,
  SettledAttempt,
  TerminalRecord,
  TerminalSettlement,
  ToolIntent,
  ToolResultRecord,
  TurnGuard,
} from '../src/runtime/contracts.js';
import type { ConversationItem, ProviderTurnResult, ResponsesDriver } from '../src/provider/responses.js';
import { READ_ONLY_FUNCTIONS } from '../src/workspace/tools.js';
import { WorkspaceError } from '../src/workspace/read-only.js';

const context: RunContext = {
  tenantId: 'tenant-1', projectId: 'project-1', runId: 'run-1', sessionId: 'session-1',
  taskId: 'task-1', profileId: 'profile-1', workspaceId: 'workspace-1',
  graphEpoch: 'epoch-1', model: 'explicit-fixture-model', correlationId: 'corr-1',
};
const policy: RunPolicy = {
  maxAttempts: 25, maxToolCalls: 80, maxTotalTokens: 120_000, maxInputTokens: 12_000,
  maxOutputTokens: 1_500, deadlineMs: 1_800_000, claimLeaseMs: 30_000, claimHeartbeatMs: 0,
};
const budget: BudgetSnapshot = {
  maxAttempts: 25, attemptsUsed: 0, maxToolCalls: 80, toolCallsUsed: 0,
  maxTotalTokens: 120_000, reservedTokens: 0, observedTokens: 0, deadlineMs: 1_800_000,
};
const launch = (overrides: Partial<RunLaunch> = {}): RunLaunch => ({
  context, claim: { fence: 1, revision: 1, requirementRevision: 1, leaseExpiresMs: 30_000 },
  budget, policy, apiKey: 'fixture-key', ...overrides,
});

/** A scripted provider: every turn is pre-declared, so no network is involved. */
function scriptedDriver(turns: ProviderTurnResult[]) {
  const seen: { identity: { logicalRequestId: string; attemptId: string }; input: readonly ConversationItem[] }[] = [];
  let index = 0;
  const driver: ResponsesDriver = {
    async turn(request) {
      seen.push({ identity: request.identity, input: request.input });
      const body = JSON.stringify({
        model: request.model, input: request.input, tools: request.tools,
        max_output_tokens: request.maxOutputTokens,
      });
      await request.authorizeAndJournal({
        ...request.identity, requestBody: body,
        requestDigest: createHash('sha256').update(body).digest('hex'),
        requestBytes: Buffer.byteLength(body),
        model: request.model, maxOutputTokens: request.maxOutputTokens,
        inputItems: request.input.length, toolCount: request.tools.length,
      });
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      if (turn === undefined) throw new Error('scripted driver ran out of turns');
      request.onVisibleText?.(`visible-${index}`);
      return turn;
    },
  };
  return { driver, seen, turnCount: () => index };
}

const turn = (overrides: Partial<ProviderTurnResult> = {}): ProviderTurnResult => ({
  status: 'completed', reason: 'completed', responseId: 'resp-1', requestId: 'provider-req-1',
  possibleCharge: true, usage: { inputTokens: 10, outputTokens: 5 }, output: [], ...overrides,
});
const call = (callId: string, name = 'workspace_read', args = '{"path":"src/exporter.mjs"}') =>
  ({ type: 'function_call', call_id: callId, name, arguments: args }) as const;

/** A guard that records everything and releases whatever the test declares. */
function recordingGuard(options: {
  release?: (terminal: TerminalRecord) => string[];
  settleFails?: boolean;
  authorizeToolFails?: boolean;
  recordToolResultFails?: boolean;
  beginTurnFails?: boolean;
  authorizeAndJournalFails?: boolean;
  heartbeatFails?: boolean;
} = {}) {
  const events: string[] = [];
  const terminals: TerminalRecord[] = [];
  const toolResults: ToolResultRecord[] = [];
  let attemptNo = 0;
  const guard: TurnGuard = {
    async beginTurn() {
      if (options.beginTurnFails) throw new Error('no run admission available');
      attemptNo += 1;
      return { logicalRequestId: `logical-${attemptNo}`, attemptId: `attempt-${attemptNo}` };
    },
    async authorizeAndJournal() {
      events.push('authorizeAndJournal');
      if (options.authorizeAndJournalFails) throw new Error('claim is not live');
    },
    observeLifecycle(event) { events.push(`lifecycle:${event.phase}`); },
    async settleAttempt(_settled: SettledAttempt, terminal: TerminalRecord): Promise<TerminalSettlement> {
      events.push('settleAttempt');
      if (options.settleFails) throw new Error('attempt row is not durable');
      terminals.push(terminal);
      const usage = terminal.usage;
      return {
        state: terminal.complete ? 'completed' : 'unknown',
        usage,
        reservationRetained: usage.precision === 'reserved',
        blockedOnReconciliation: false,
        releasedToolCalls: options.release?.(terminal) ?? [],
      };
    },
    async authorizeTool(intent: ToolIntent) {
      events.push(`authorizeTool:${intent.callId}`);
      if (options.authorizeToolFails) throw new Error('stale fence');
      return { toolExecutionId: `exec-${intent.callId}`, inputArtifactId: 'artifact-1', inputDigest: 'i'.repeat(64) };
    },
    async recordToolResult(intent: ToolIntent, result: ToolResultRecord) {
      events.push(`recordToolResult:${intent.callId}`);
      if (options.recordToolResultFails) throw new Error('result not durable');
      toolResults.push(result);
      void intent;
    },
    async heartbeat() {
      if (options.heartbeatFails) throw new Error('claim expired');
      return { fence: 1, revision: 1, requirementRevision: 1, leaseExpiresMs: 30_000 };
    },
    async releaseClaim(reason: string) { events.push(`release:${reason}`); },
  };
  return { guard, events, terminals, toolResults };
}

const collectingSink = () => {
  const activity: RuntimeActivity[] = [];
  const sink: ActivitySink = (value) => activity.push(value);
  return { activity, sink };
};

const readingTool = (options: { fail?: WorkspaceError } = {}) => {
  const seen: unknown[] = [];
  return {
    seen,
    invoke: async (_name: string, input: unknown) => {
      seen.push(input);
      if (options.fail) throw options.fail;
      return { kind: 'read', path: 'src/exporter.mjs', digest: 'a'.repeat(64), totalBytes: 10, offset: 0, returnedBytes: 10, truncated: false, text: 'source' };
    },
  };
};

test('assembled trace: provider call, released read tool, next exact input, final output', async () => {
  const release = (terminal: TerminalRecord) => terminal.toolCalls.map(c => c.callId);
  const { guard, events, terminals, toolResults } = recordingGuard({ release });
  const { driver, seen, turnCount } = scriptedDriver([
    turn({ output: [call('call-1')] }),
    turn({ output: [{ role: 'assistant', content: 'The exporter exists.' }] }),
  ]);
  const tool = readingTool();
  const { activity, sink } = collectingSink();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'Inspect the candidate' }], new AbortController().signal);

  assert.equal(outcome.stop, 'final_output');
  assert.equal(outcome.attempts, 2);
  assert.equal(outcome.toolCalls, 1);
  assert.equal(outcome.releasedToolCalls, 1);
  assert.equal(turnCount(), 2);
  assert.equal(outcome.visibleText, 'The exporter exists.');

  // The read actually happened and its real output became the next input.
  assert.deepEqual(tool.seen, [{ path: 'src/exporter.mjs' }]);
  assert.equal(toolResults[0]?.status, 'succeeded');
  assert.match(toolResults[0]?.outputDigest ?? '', /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(toolResults[0]?.outputJson ?? '{}').text, 'source');

  const secondInput = seen[1]?.input ?? [];
  const outputs = secondInput.filter((item) => 'type' in item && item.type === 'function_call_output');
  assert.equal(outputs.length, 1, 'the durable tool result must be part of the next provider input');
  assert.equal(JSON.parse(String((outputs[0] as { output: string }).output)).text, 'source');

  // The tool batch was durably recorded before the next turn was requested.
  assert.ok(events.indexOf('settleAttempt') < events.indexOf('authorizeTool:call-1'));
  assert.ok(events.indexOf('recordToolResult:call-1') < events.lastIndexOf('authorizeAndJournal'));
  assert.equal(terminals.length, 2);
  assert.ok(activity.some(a => a.kind === 'tool_state' && a.state === 'succeeded'));
  assert.ok(activity.some(a => a.kind === 'run_state' && a.state === 'final_output'));
});

test('multiple released calls execute sequentially in provider order', async () => {
  const { guard } = recordingGuard({ release: (terminal) => terminal.toolCalls.map(c => c.callId) });
  const { driver, seen } = scriptedDriver([
    turn({ output: [call('call-a', 'workspace_inspect', '{}'), call('call-b', 'workspace_search', '{"query":"x"}')] }),
    turn({ output: [{ role: 'assistant', content: 'done' }] }),
  ]);
  const tool = readingTool();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.toolCalls, 2);
  assert.equal(tool.seen.length, 2);
  assert.deepEqual(tool.seen[0], {}, 'inspect ran first');
  assert.deepEqual(tool.seen[1], { query: 'x' }, 'search ran second');

  const second = seen[1]?.input ?? [];
  const ids = second.filter((i) => 'type' in i && i.type === 'function_call_output').map((i) => (i as { call_id: string }).call_id);
  assert.deepEqual(ids, ['call-a', 'call-b'], 'tool outputs stay correlated and ordered');
});

test('an unreleased complete batch performs no tools and blocks', async () => {
  const { guard, toolResults } = recordingGuard({ release: () => [] });
  const { driver } = scriptedDriver([turn({ output: [call('call-x')] })]);
  const tool = readingTool();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.stop, 'blocked');
  assert.equal(outcome.reason, 'complete_batch_not_released');
  assert.equal(tool.seen.length, 0, 'an unrecorded batch must not execute');
  assert.equal(toolResults.length, 0);
});

test('an unknown tool name is denied without touching the workspace', async () => {
  const { guard } = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId) });
  const { driver } = scriptedDriver([
    turn({ output: [call('call-evil', 'workspace_delete', '{"path":"src/exporter.mjs"}')] }),
    turn({ output: [{ role: 'assistant', content: 'cannot delete' }] }),
  ]);
  const tool = readingTool();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(tool.seen.length, 0, 'an unregistered tool must never be invoked');
  assert.equal(outcome.stop, 'final_output');
});

test('malformed tool arguments produce a durable denial, not an exception', async () => {
  const { guard, toolResults } = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId) });
  const { driver } = scriptedDriver([
    turn({ output: [call('call-bad', 'workspace_read', '{not json')] }),
    turn({ output: [{ role: 'assistant', content: 'recovered' }] }),
  ]);
  const tool = readingTool();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(tool.seen.length, 0);
  assert.equal(toolResults[0]?.status, 'denied');
  assert.deepEqual(JSON.parse(toolResults[0]?.outputJson ?? '{}'), { denied: 'malformed_arguments' });
  assert.equal(outcome.stop, 'final_output');
});

test('a path policy denial is recorded as denied with the real code', async () => {
  const { guard, toolResults } = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId) });
  const { driver } = scriptedDriver([
    turn({ output: [call('call-esc', 'workspace_read', '{"path":"../secrets"}')] }),
    turn({ output: [{ role: 'assistant', content: 'refused' }] }),
  ]);
  const tool = readingTool({ fail: new WorkspaceError('path_denied', 'Path leaves its registered workspace.') });

  await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(toolResults[0]?.status, 'denied');
  assert.deepEqual(JSON.parse(toolResults[0]?.outputJson ?? '{}'), { error: 'path_denied' });
});

test('a failed settle blocks the next provider request', async () => {
  const { guard } = recordingGuard({ settleFails: true });
  const { driver, turnCount } = scriptedDriver([turn({ output: [call('call-1')] })]);

  const outcome = await createRuntimeLoop({
    driver, tools: readingTool(), guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.stop, 'blocked');
  assert.equal(outcome.blockedOnReconciliation, true);
  assert.match(outcome.reason, /settle_failed/);
  assert.equal(turnCount(), 1, 'no replacement attempt may be issued');
});

test('an undurable tool result blocks the next provider request', async () => {
  const { guard } = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId), recordToolResultFails: true });
  const { driver, turnCount } = scriptedDriver([turn({ output: [call('call-1')] })]);

  const outcome = await createRuntimeLoop({
    driver, tools: readingTool(), guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.stop, 'blocked');
  assert.match(outcome.reason, /tool_result_not_durable/);
  assert.equal(turnCount(), 1);
});

test('a refused authorization stops before any tool and issues no replacement attempt', async () => {
  const { guard, events } = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId), authorizeToolFails: true });
  const { driver, turnCount } = scriptedDriver([turn({ output: [call('call-1')] })]);
  const tool = readingTool();

  const outcome = await createRuntimeLoop({
    driver, tools: tool, guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.stop, 'blocked');
  assert.match(outcome.reason, /tool_not_authorized/);
  assert.equal(tool.seen.length, 0);
  assert.equal(turnCount(), 1);
  assert.ok(!events.some(e => e.startsWith('recordToolResult')));
});

test('attempt and tool limits stop before the next action', async () => {
  // Each turn asks for a tool, so the loop keeps going until the attempt cap stops it.
  const attemptsGuard = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId) });
  const driverOne = scriptedDriver([turn({ output: [call('loop-call')] }), turn({ output: [call('loop-call')] }), turn({ output: [] })]);
  const limited = await createRuntimeLoop({
    driver: driverOne.driver, tools: readingTool(), guard: attemptsGuard.guard,
    sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch({ policy: { ...policy, maxAttempts: 2 } }), [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(limited.stop, 'exhausted');
  assert.equal(limited.reason, 'provider_attempt_limit');
  assert.equal(limited.attempts, 2);
  assert.equal(driverOne.turnCount(), 2, 'the third turn is never requested');

  const toolsGuard = recordingGuard({ release: (t) => t.toolCalls.map(c => c.callId) });
  const driverTwo = scriptedDriver([turn({ output: [call('c1'), call('c2')] }), turn({ output: [] })]);
  const limitedTools = await createRuntimeLoop({
    driver: driverTwo.driver, tools: readingTool(), guard: toolsGuard.guard,
    sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch({ policy: { ...policy, maxToolCalls: 1 } }), [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(limitedTools.stop, 'exhausted');
  assert.equal(limitedTools.reason, 'tool_call_limit');
  assert.equal(limitedTools.toolCalls, 1, 'the limit stops before the second tool runs');
});

test('an unreachable deadline stops before another provider turn', async () => {
  let clock = 0;
  const { guard } = recordingGuard();
  const { driver, turnCount } = scriptedDriver([turn({ output: [] })]);
  const loop = createRuntimeLoop({
    driver, tools: readingTool(), guard, sink: collectingSink().sink,
    tools4Provider: READ_ONLY_FUNCTIONS, now: () => (clock += 5_000),
  });
  const outcome = await loop.run(launch({ policy: { ...policy, deadlineMs: 1_000 } }),
    [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(outcome.stop, 'exhausted');
  assert.equal(outcome.reason, 'run_deadline');
  assert.equal(turnCount(), 0, 'no attempt starts after the deadline');
});

test('a live run ends on final output, and an already-cancelled signal starts nothing', async () => {
  const { driver, turnCount } = scriptedDriver([turn({ output: [] })]);
  const outcome = await createRuntimeLoop({
    driver, tools: readingTool(), guard: recordingGuard().guard, sink: collectingSink().sink,
    tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(outcome.stop, 'final_output');
  assert.equal(turnCount(), 1);

  const second = new AbortController();
  second.abort();
  const { driver: d2, turnCount: count2 } = scriptedDriver([turn({ output: [] })]);
  const cancelled = await createRuntimeLoop({
    driver: d2, tools: readingTool(), guard: recordingGuard().guard, sink: collectingSink().sink,
    tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], second.signal);
  assert.equal(cancelled.stop, 'cancelled');
  assert.equal(count2(), 0);
});

test('usage is reported, reserved or known-zero, never invented', async () => {
  const cases: { turn: ProviderTurnResult; precision: string }[] = [
    { turn: turn({ usage: { inputTokens: 12, outputTokens: 8 } }), precision: 'reported' },
    { turn: turn({ usage: null, status: 'unknown', possibleCharge: true }), precision: 'reserved' },
    { turn: turn({ usage: null, status: 'failed', possibleCharge: false }), precision: 'known-zero' },
  ];
  for (const item of cases) {
    const seen: TerminalRecord[] = [];
    const local = recordingGuard();
    await createRuntimeLoop({
      driver: scriptedDriver([item.turn]).driver, tools: readingTool(),
      guard: { ...local.guard, async settleAttempt(s, terminal) { seen.push(terminal); return local.guard.settleAttempt(s, terminal); } },
      sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
    }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);
    assert.equal(seen[0]?.usage.precision, item.precision);
  }
});

test('a refused run admission or claim stops without a dispatched provider request', async () => {
  const beginFailure = await createRuntimeLoop({
    driver: scriptedDriver([turn({ output: [] })]).driver, tools: readingTool(),
    guard: recordingGuard({ beginTurnFails: true }).guard,
    sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(beginFailure.stop, 'failed');
  assert.match(beginFailure.reason, /begin_turn_failed/);
  assert.equal(beginFailure.attempts, 0, 'no attempt identity was allocated');

  const claimFailure = await createRuntimeLoop({
    driver: scriptedDriver([turn({ output: [] })]).driver, tools: readingTool(),
    guard: recordingGuard({ authorizeAndJournalFails: true }).guard,
    sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);
  assert.equal(claimFailure.stop, 'failed');
  assert.match(claimFailure.reason, /turn_refused/);
  assert.equal(claimFailure.toolCalls, 0);
});

test('a final assistant answer ends inference and is not a task completion', async () => {
  const { guard, toolResults } = recordingGuard();
  const outcome = await createRuntimeLoop({
    driver: scriptedDriver([turn({ output: [{ role: 'assistant', content: 'I am done with the analysis.' }] })]).driver,
    tools: readingTool(), guard, sink: collectingSink().sink, tools4Provider: READ_ONLY_FUNCTIONS,
  }).run(launch(), [{ role: 'user', content: 'go' }], new AbortController().signal);

  assert.equal(outcome.stop, 'final_output');
  assert.equal(outcome.lastState, 'completed');
  assert.equal(toolResults.length, 0);
  assert.ok(!('completion' in outcome), 'the kernel reports inference end, never task completion');
});