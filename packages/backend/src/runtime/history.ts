import { createHash } from 'node:crypto';

import type { ConversationItem } from '../provider/responses.js';

/**
 * Caller-owned conversation history.
 *
 * Every provider input is rebuilt here from durable local records. Nothing is
 * fetched from a provider-hosted thread, `previous_response_id` is never used,
 * and the frontend never contributes a buffer. A turn whose durable evidence is
 * missing or inconsistent blocks the next request rather than being guessed.
 */

/**
 * One durable record the coordinator stores.
 *
 * `bytes`/`digest` bind the stored content; `ordinal` preserves the order the
 * records were durably written in, which is the only ordering that matters.
 */
export type DurableRecord =
  | {
      readonly kind: 'user_message';
      readonly ordinal: number;
      readonly text: string;
      readonly bytes: number;
      readonly digest: string;
    }
  | {
      readonly kind: 'assistant_message';
      readonly ordinal: number;
      readonly text: string;
      readonly bytes: number;
      readonly digest: string;
      /** True only when this was the whole terminal visible output. */
      readonly terminal: boolean;
    }
  | {
      readonly kind: 'tool_call';
      readonly ordinal: number;
      readonly callId: string;
      readonly toolName: string;
      readonly argumentsJson: string;
      readonly bytes: number;
      readonly digest: string;
    }
  | {
      readonly kind: 'tool_result';
      readonly ordinal: number;
      readonly callId: string;
      readonly outputJson: string;
      readonly bytes: number;
      readonly digest: string;
    }
  | {
      /**
       * System or current-authority content, such as the accepted requirements
       * and the task the model is working on.
       */
      readonly kind: 'authority';
      readonly ordinal: number;
      readonly text: string;
      readonly bytes: number;
      readonly digest: string;
    };

export class HistoryUnavailableError extends Error {
  constructor(reason: string) {
    super(`Conversation history cannot be reconstructed: ${reason}`);
    this.name = 'HistoryUnavailableError';
  }
}

export interface RebuildResult {
  readonly items: readonly ConversationItem[];
  /** SHA-256 over the exact reconstructed input, for the attempt journal. */
  readonly digest: string;
  readonly recordCount: number;
}

/**
 * Rebuilds the exact next provider input from durable records.
 *
 * Enforced here:
 * - records are ordered by their durable ordinal, never by arrival;
 * - every record's stored digest must match its content;
 * - a tool call with no matching result is incomplete, so the next turn blocks;
 * - a result with no preceding call is inconsistent, so the next turn blocks;
 * - duplicate call ids are inconsistent;
 * - a trailing assistant message ends the conversation: the next input would be
 *   asking the model to continue its own final answer.
 */
export function rebuildNextInput(records: readonly DurableRecord[]): RebuildResult {
  if (records.length === 0) {
    throw new HistoryUnavailableError('no durable records were supplied');
  }
  const ordered = [...records].sort((a, b) => a.ordinal - b.ordinal);
  const seenOrdinals = new Set<number>();
  for (const record of ordered) {
    if (seenOrdinals.has(record.ordinal)) {
      throw new HistoryUnavailableError(`two durable records share ordinal ${record.ordinal}`);
    }
    seenOrdinals.add(record.ordinal);
    verifyDigest(record);
  }

  const items: ConversationItem[] = [];
  const openCalls = new Set<string>();
  const completedCalls = new Set<string>();
  let trailingTerminal = false;

  for (const record of ordered) {
    switch (record.kind) {
      case 'authority':
        trailingTerminal = false;
        items.push({ role: 'user', content: record.text });
        break;
      case 'user_message':
        trailingTerminal = false;
        items.push({ role: 'user', content: record.text });
        break;
      case 'assistant_message': {
        trailingTerminal = record.terminal;
        items.push({ role: 'assistant', content: record.text });
        break;
      }
      case 'tool_call': {
        if (openCalls.has(record.callId) || completedCalls.has(record.callId)) {
          throw new HistoryUnavailableError(`call id ${record.callId} appears more than once`);
        }
        openCalls.add(record.callId);
        trailingTerminal = false;
        items.push({
          type: 'function_call',
          call_id: record.callId,
          name: record.toolName,
          arguments: record.argumentsJson,
        });
        break;
      }
      case 'tool_result': {
        if (!openCalls.has(record.callId)) {
          throw new HistoryUnavailableError(
            `tool result ${record.callId} has no preceding durable call record`,
          );
        }
        openCalls.delete(record.callId);
        completedCalls.add(record.callId);
        trailingTerminal = false;
        items.push({ type: 'function_call_output', call_id: record.callId, output: record.outputJson });
        break;
      }
    }
  }

  if (openCalls.size > 0) {
    throw new HistoryUnavailableError(
      `call ${[...openCalls].join(', ')} has no durable result; the next turn cannot be prepared`,
    );
  }
  if (trailingTerminal) {
    throw new HistoryUnavailableError(
      'the last durable record is a terminal assistant message, so inference already ended',
    );
  }

  const digest = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  return { items, digest, recordCount: ordered.length };
}

function verifyDigest(record: DurableRecord): void {
  const content =
    record.kind === 'tool_call'
      ? JSON.stringify({ callId: record.callId, name: record.toolName, arguments: record.argumentsJson })
      : record.kind === 'tool_result'
        ? record.outputJson
        : record.text;
  if (record.bytes !== Buffer.byteLength(content)) {
    throw new HistoryUnavailableError(
      `record ${record.ordinal} (${record.kind}) does not match its stored byte length`,
    );
  }
  if (record.digest !== createHash('sha256').update(content).digest('hex')) {
    throw new HistoryUnavailableError(`record ${record.ordinal} (${record.kind}) does not match its stored digest`);
  }
}

/**
 * Appends the records one completed turn produced.
 *
 * Only a terminal visible message is stored as terminal. A turn that ended
 * unknown contributes no assistant record, so it cannot end a conversation.
 */
export function recordsForTurn(input: {
  readonly startOrdinal: number;
  readonly visibleOutput: readonly ConversationItem[];
  readonly toolCalls: readonly { callId: string; toolName: string; argumentsJson: string }[];
  readonly toolResults: readonly { callId: string; outputJson: string }[];
}): DurableRecord[] {
  const records: DurableRecord[] = [];
  let ordinal = input.startOrdinal;

  for (const item of input.visibleOutput) {
    if ('role' in item && item.role === 'assistant') {
      records.push({
        kind: 'assistant_message',
        ordinal: ordinal++,
        text: item.content,
        bytes: Buffer.byteLength(item.content),
        digest: createHash('sha256').update(item.content).digest('hex'),
        terminal: input.toolCalls.length === 0,
      });
    }
  }
  for (const call of input.toolCalls) {
    const content = JSON.stringify({ callId: call.callId, name: call.toolName, arguments: call.argumentsJson });
    records.push({
      kind: 'tool_call',
      ordinal: ordinal++,
      callId: call.callId,
      toolName: call.toolName,
      argumentsJson: call.argumentsJson,
      bytes: Buffer.byteLength(content),
      digest: createHash('sha256').update(content).digest('hex'),
    });
  }
  for (const result of input.toolResults) {
    records.push({
      kind: 'tool_result',
      ordinal: ordinal++,
      callId: result.callId,
      outputJson: result.outputJson,
      bytes: Buffer.byteLength(result.outputJson),
      digest: createHash('sha256').update(result.outputJson).digest('hex'),
    });
  }
  return records;
}