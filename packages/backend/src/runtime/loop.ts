import { createHash } from 'node:crypto';

import type { ConversationItem, FunctionTool, ResponsesDriver } from '../provider/responses.js';
import type {
  ActivitySink,
  AttemptIdentity,
  AttemptState,
  BudgetSnapshot,
  CorrelationId,
  RunLaunch,
  RunPolicy,
  SettledAttempt,
  TerminalRecord,
  TerminalSettlement,
  TerminalToolCall,
  ToolIntent,
  ToolResultRecord,
  TurnGuard,
  UsageObservation,
} from './contracts.js';
import { WorkspaceError } from '../workspace/read-only.js';
import { resolveReadOnlyFunction } from '../workspace/tools.js';
import type { ReadOnlyToolName } from '../workspace/read-only.js';

/**
 * Bounded sequential runtime kernel.
 *
 * Owns control flow and cancellation propagation only. It holds no database
 * handle, no Fastify reference, no graph client and no UI state: the coordinator
 * owns authority and durable records, and every capability this loop needs is
 * one of the injected ports.
 *
 * The ordering rule is absolute — the loop cannot reach the network without a
 * resolved coordinator guard, and no tool may execute before the complete
 * terminal batch has been durably recorded and explicitly released.
 */

export type LoopStop =
  | 'final_output'
  | 'cancelled'
  | 'blocked'
  | 'exhausted'
  | 'failed'
  | 'unknown';

export interface LoopOutcome {
  readonly stop: LoopStop;
  readonly reason: string;
  readonly attempts: number;
  readonly toolCalls: number;
  readonly releasedToolCalls: number;
  readonly visibleText: string;
  readonly blockedOnReconciliation: boolean;
  readonly lastState: AttemptState | null;
}

/** The read-only workspace tool surface the loop is allowed to invoke. */
export interface ReadOnlyToolInvoker {
  invoke(name: ReadOnlyToolName, input: unknown): Promise<unknown>;
}

export interface RuntimeLoopDeps {
  readonly driver: ResponsesDriver;
  readonly tools: ReadOnlyToolInvoker;
  readonly guard: TurnGuard;
  readonly sink: ActivitySink;
  readonly tools4Provider: readonly FunctionTool[];
  readonly now?: () => number;
}

export interface RuntimeLoop {
  run(
    launch: RunLaunch,
    initialInput: readonly ConversationItem[],
    signal: AbortSignal,
  ): Promise<LoopOutcome>;
}

export function createRuntimeLoop(deps: RuntimeLoopDeps): RuntimeLoop {
  const now = deps.now ?? (() => Date.now());

  /**
   * Usage is one of three facts, never a zero-filled guess.
   *
   * `reported` when the provider returned usage; `known-zero` when it refused
   * before accepting the request; `reserved` when it may have accepted and
   * billed it, so the reservation is retained.
   */
  const usageOf = (settled: SettledAttempt, status: LoopStop): UsageObservation => {
    if (settled.usage !== null) {
      return {
        precision: 'reported',
        inputTokens: settled.usage.inputTokens,
        outputTokens: settled.usage.outputTokens,
      };
    }
    if (!settled.possibleCharge && status === 'failed') {
      return { precision: 'known-zero', reason: settled.reason };
    }
    return { precision: 'reserved', reason: settled.reason };
  };

  /** Splits a validated provider output into visible items and an ordered call batch. */
  const splitOutput = (
    output: readonly ConversationItem[],
  ): { visible: ConversationItem[]; calls: TerminalToolCall[]; visibleText: string } => {
    const visible: ConversationItem[] = [];
    const calls: TerminalToolCall[] = [];
    const text: string[] = [];
    for (const item of output) {
      if ('type' in item && item.type === 'function_call') {
        calls.push({ callId: item.call_id, toolName: item.name, argumentsJson: item.arguments });
      } else if ('role' in item && item.role === 'assistant') {
        visible.push(item);
        text.push(item.content);
      }
    }
    return { visible, calls, visibleText: text.join('') };
  };

  /**
   * Invokes one released call and returns its real result.
   *
   * An unregistered wire name, malformed arguments or a policy denial produce a
   * typed result rather than an exception, because the model still needs a tool
   * output to continue and the denial itself is durable evidence.
   */
  const invokeOne = async (call: TerminalToolCall): Promise<ToolResultRecord> => {
    const denied = (reason: string): ToolResultRecord => {
      const outputJson = JSON.stringify({ denied: reason });
      return { status: 'denied', outputJson, outputDigest: sha256(outputJson), candidateDigest: null };
    };
    const name = resolveReadOnlyFunction(call.toolName);
    if (name === null) {
      return denied(`unknown_tool:${call.toolName}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.argumentsJson) as unknown;
    } catch {
      return denied('malformed_arguments');
    }
    try {
      const outputJson = JSON.stringify(await deps.tools.invoke(name, parsed));
      return { status: 'succeeded', outputJson, outputDigest: sha256(outputJson), candidateDigest: null };
    } catch (error) {
      const code = error instanceof WorkspaceError ? error.code : 'unavailable';
      const policy = code === 'path_denied' || code === 'invalid_input';
      const outputJson = JSON.stringify({ error: code });
      return {
        status: policy ? 'denied' : 'failed',
        outputJson,
        outputDigest: sha256(outputJson),
        candidateDigest: null,
      };
    }
  };

  return {
    async run(launch, initialInput, signal): Promise<LoopOutcome> {
      const context = launch.context;
      const guard = deps.guard;
      const sink = deps.sink;
      const policy: RunPolicy = launch.policy;
      const deadline = now() + policy.deadlineMs;
      const correlationId: CorrelationId = context.correlationId;

      let attempts = 0;
      let toolCalls = 0;
      let releasedToolCalls = 0;
      let visibleText = '';
      let lastState: AttemptState | null = null;
      let history: ConversationItem[] = [...initialInput];

      const outcome = (
        stop: LoopStop,
        reason: string,
        extra: Partial<LoopOutcome> = {},
      ): LoopOutcome => ({
        stop,
        reason,
        attempts,
        toolCalls,
        releasedToolCalls,
        visibleText,
        blockedOnReconciliation: false,
        lastState,
        ...extra,
      });

      /** Stops before starting another action once a declared limit is reached. */
      const limitReached = (budget: BudgetSnapshot): LoopOutcome | null => {
        if (attempts >= Math.min(policy.maxAttempts, budget.maxAttempts)) {
          return outcome('exhausted', 'provider_attempt_limit');
        }
        if (toolCalls >= Math.min(policy.maxToolCalls, budget.maxToolCalls)) {
          return outcome('exhausted', 'tool_call_limit');
        }
        if (now() >= deadline) return outcome('exhausted', 'run_deadline');
        return null;
      };

      /**
       * Refreshes the claim during a long provider turn.
       *
       * A lost claim aborts the turn. This never proves the provider stopped;
       * the settlement path still records whatever outcome was observed.
       */
      const runHeartbeat = (): (() => void) => {
        if (policy.claimHeartbeatMs < 1) return () => {};
        const timer = setInterval(() => {
          void guard.heartbeat().catch(() => controller.abort());
        }, policy.claimHeartbeatMs);
        timer.unref();
        return () => clearInterval(timer);
      };

      const controller = new AbortController();
      const forwardAbort = (): void => controller.abort();
      signal.addEventListener('abort', forwardAbort, { once: true });
      const stopHeartbeat = runHeartbeat();

      sink({
        kind: 'run_state',
        runId: context.runId,
        state: 'running',
        detail: `correlation ${correlationId}`,
      });

      try {
        for (;;) {
          if (signal.aborted) return outcome('cancelled', 'cancelled_before_turn');
          if (controller.signal.aborted) return outcome('cancelled', 'claim_lost');

          const limit = limitReached(launch.budget);
          if (limit !== null) return limit;

          let identity: AttemptIdentity;
          try {
            identity = await guard.beginTurn();
          } catch (error) {
            return outcome('failed', `begin_turn_failed: ${describe(error)}`);
          }
          attempts += 1;

          let turn;
          try {
            turn = await deps.driver.turn({
              model: context.model,
              input: history,
              tools: deps.tools4Provider,
              signal: controller.signal,
              maxOutputTokens: policy.maxOutputTokens,
              identity,
              authorizeAndJournal: (prepared) => guard.authorizeAndJournal(prepared),
              onLifecycle: (event) => guard.observeLifecycle(event),
              onVisibleText: (text) =>
                sink({ kind: 'visible_text', sessionId: context.sessionId, text }),
            });
          } catch (error) {
            // A guard rejection means nothing was sent; it is not a provider failure.
            return outcome('failed', `turn_refused: ${describe(error)}`);
          }

          const parts = splitOutput(turn.output);
          visibleText = parts.visibleText;
          const settled: SettledAttempt = {
            ...identity,
            status: turn.status,
            reason: turn.reason,
            responseId: turn.responseId,
            providerRequestId: turn.requestId,
            possibleCharge: turn.possibleCharge,
            usage: turn.usage,
          };
          const stop: LoopStop =
            turn.status === 'completed' ? 'final_output'
            : turn.status === 'cancelled' ? 'cancelled'
            : turn.status === 'failed' ? 'failed'
            : 'unknown';
          const terminal: TerminalRecord = {
            visibleOutput: turn.output,
            toolCalls: parts.calls,
            responseId: turn.responseId,
            usage: usageOf(settled, stop),
            complete: turn.status === 'completed',
          };

          let settlement: TerminalSettlement;
          try {
            settlement = await guard.settleAttempt(settled, terminal);
          } catch (error) {
            // A failed persistence acknowledgement blocks the next provider request.
            return outcome('blocked', `settle_failed: ${describe(error)}`, {
              blockedOnReconciliation: true,
            });
          }
          lastState = settlement.state;
          sink({
            kind: 'attempt_state',
            runId: context.runId,
            logicalRequestId: identity.logicalRequestId,
            attemptNo: attempts,
            state: settlement.state,
          });

          if (settlement.blockedOnReconciliation) {
            return outcome('blocked', 'blocked_on_reconciliation', { blockedOnReconciliation: true });
          }

          const released = new Set(settlement.releasedToolCalls);
          const executable = parts.calls.filter((call) => released.has(call.callId));
          if (executable.length === 0) {
            // Nothing was released: a partial batch, an empty batch, or a stop.
            // No work happens either way.
            if (parts.calls.length > 0 && stop === 'final_output') {
              return outcome('blocked', 'complete_batch_not_released', { blockedOnReconciliation: true });
            }
            if (stop !== 'final_output') return outcome(stop, `provider_${turn.status}: ${turn.reason}`);
            sink({ kind: 'run_state', runId: context.runId, state: 'final_output', detail: turn.reason });
            return outcome('final_output', 'model_returned_final_output');
          }

          history = [...history, ...turn.output];
          for (const call of executable) {
            if (toolCalls >= Math.min(policy.maxToolCalls, launch.budget.maxToolCalls)) {
              return outcome('exhausted', 'tool_call_limit');
            }
            if (now() >= deadline) return outcome('exhausted', 'run_deadline');
            if (signal.aborted) return outcome('cancelled', 'cancelled_before_tool');
            if (controller.signal.aborted) return outcome('cancelled', 'claim_lost');

            sink({ kind: 'tool_state', callId: call.callId, toolName: call.toolName, state: 'authorizing' });
            const intent: ToolIntent = {
              callId: call.callId,
              toolName: call.toolName,
              argumentsJson: call.argumentsJson,
            };
            try {
              await guard.authorizeTool(intent);
            } catch (error) {
              sink({ kind: 'tool_state', callId: call.callId, toolName: call.toolName, state: 'denied' });
              return outcome('blocked', `tool_not_authorized: ${describe(error)}`, {
                blockedOnReconciliation: true,
              });
            }
            toolCalls += 1;
            releasedToolCalls += 1;

            sink({ kind: 'tool_state', callId: call.callId, toolName: call.toolName, state: 'running' });
            const result = await invokeOne(call);
            try {
              await guard.recordToolResult(intent, result);
            } catch (error) {
              // An undurable result must not become the next model input.
              sink({ kind: 'tool_state', callId: call.callId, toolName: call.toolName, state: 'unknown' });
              return outcome('blocked', `tool_result_not_durable: ${describe(error)}`, {
                blockedOnReconciliation: true,
              });
            }
            sink({ kind: 'tool_state', callId: call.callId, toolName: call.toolName, state: result.status });

            history = [
              ...history,
              { type: 'function_call_output', call_id: call.callId, output: result.outputJson },
            ];
          }
          if (guard.rebuildInput) {
            try { history = [...await guard.rebuildInput()]; }
            catch (error) { return outcome('blocked', `history_not_durable: ${describe(error)}`, { blockedOnReconciliation: true }); }
          }
        }
      } finally {
        stopHeartbeat();
        signal.removeEventListener('abort', forwardAbort);
      }
    },
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}