import { z } from 'zod';

import {
  ROUTES,
  ThreadlineError,
  acceptMemoryInputSchema,
  correctMemoryInputSchema,
  createTaskInputSchema,
  memoryOperationResultSchema,
  memoryQueryResultSchema,
  memoryQuerySchema,
  memoryViewSchema,
  operationViewSchema,
  parseContract,
  proposeMemoryInputSchema,
  safeParseContract,
  requireMemoryInputSchema,
  sourceRangeSchema,
  sourceViewSchema,
  taskOperationResultSchema,
  taskRequirementsViewSchema,
  taskViewSchema,
  type AcceptMemoryInput,
  type CorrectMemoryInput,
  type CreateTaskInput,
  type MemoryOperationResult,
  type MemoryQuery,
  type MemoryQueryResult,
  type MemoryView,
  type OperationView,
  type ProposeMemoryInput,
  type RequireMemoryInput,
  type SourceRange,
  type SourceView,
  type TaskOperationResult,
  type TaskRequirementsView,
  type TaskView,
} from '@threadline/shared';

import type { ApiClient } from './client.js';

/**
 * One core implementation of the semantic-memory and task surface.
 *
 * The human CLI, the read-only MCP server and the temporary verification
 * clients all call these functions; there is no second copy of a route, a
 * validator or a bound. Every response is parsed with the shared contract, so a
 * client can never present a shape the service did not actually validate.
 *
 * Nothing here decides authority. Project scope, human acceptance and grant
 * role are resolved by the service from the credential; this module only
 * forwards the requested target and reports the typed refusal that came back.
 */

export interface MemorySurface {
  queryMemory(input: MemoryQuery): Promise<MemoryQueryResult>;
  inspectMemory(projectId: string, memoryId: string): Promise<MemoryView>;

  createTask(input: CreateTaskInput): Promise<TaskOperationResult>;
  inspectTask(projectId: string, taskId: string): Promise<TaskView>;
  inspectTaskRequirements(projectId: string, taskId: string): Promise<TaskRequirementsView>;
  bindTaskRequirement(input: RequireMemoryInput): Promise<TaskOperationResult>;

  proposeMemory(input: ProposeMemoryInput): Promise<MemoryOperationResult>;
  acceptMemory(input: AcceptMemoryInput): Promise<MemoryOperationResult>;
  correctMemory(input: CorrectMemoryInput): Promise<MemoryOperationResult>;

  inspectOperation(projectId: string, operationId: string): Promise<OperationView>;
  inspectSource(projectId: string, sourceId: string): Promise<SourceView>;
  readSource(projectId: string, sourceId: string, start: number, end: number): Promise<SourceRange>;
}

/**
 * Validates a caller-supplied request against a shared input contract.
 *
 * `safeParse` rather than `parse`: a malformed input document is a caller
 * mistake, and the shared error payload carries a bounded field path instead of
 * a raw validator dump. No submitted value is echoed back.
 */
function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> {
  const result = safeParseContract(schema, value);
  if (result.ok) {
    return result.value;
  }
  throw new ThreadlineError('invalid_request', `The ${label} document is not valid.`, {
    label,
    field: result.path,
  });
}

/** Largest bounded source read any client may request in one call. */
export const MAX_SOURCE_READ_BYTES = 32_768;

/** Bounded wait used when a caller asks to follow an operation to a settled state. */
export const DEFAULT_OPERATION_WAIT_MS = 15_000;
const OPERATION_POLL_INTERVAL_MS = 150;

export function createMemorySurface(client: ApiClient): MemorySurface {
  return {
    async queryMemory(input) {
      const parsed = parseInput(memoryQuerySchema, input, 'memory query');
      const payload = await client.get(ROUTES.memories, {
        projectId: parsed.projectId,
        limit: parsed.limit,
        ...(parsed.taskId == null ? {} : { taskId: parsed.taskId }),
        ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
        ...(parsed.focus === undefined ? {} : { focus: parsed.focus }),
      });
      return parseContract(memoryQueryResultSchema, payload, 'memory query result');
    },

    async inspectMemory(projectId, memoryId) {
      const payload = await client.get(ROUTES.memory(memoryId), { projectId });
      return parseContract(memoryViewSchema, payload, 'memory view');
    },

    async createTask(input) {
      const parsed = parseInput(createTaskInputSchema, input, 'task create');
      const payload = await client.post(ROUTES.tasks, parsed);
      return parseContract(taskOperationResultSchema, payload, 'task create result');
    },

    async inspectTask(projectId, taskId) {
      const payload = await client.get(ROUTES.task(taskId), { projectId });
      return parseContract(taskViewSchema, payload, 'task view');
    },

    async inspectTaskRequirements(projectId, taskId) {
      const payload = await client.get(ROUTES.taskRequirements(taskId), { projectId });
      return parseContract(taskRequirementsViewSchema, payload, 'task requirements view');
    },

    async bindTaskRequirement(input) {
      const parsed = parseInput(requireMemoryInputSchema, input, 'requirement binding');
      // The path and the body must name the same task; the service checks this
      // again, and naming it once here keeps the two routes' contracts aligned.
      const payload = await client.post(ROUTES.taskRequirements(parsed.taskId), parsed);
      return parseContract(taskOperationResultSchema, payload, 'requirement binding result');
    },

    async proposeMemory(input) {
      const parsed = parseInput(proposeMemoryInputSchema, input, 'memory proposal');
      const payload = await client.post(ROUTES.memoryProposals, parsed);
      return parseContract(memoryOperationResultSchema, payload, 'memory proposal result');
    },

    async acceptMemory(input) {
      const parsed = parseInput(acceptMemoryInputSchema, input, 'memory acceptance');
      const payload = await client.post(ROUTES.memoryAccept(parsed.memoryId), parsed);
      return parseContract(memoryOperationResultSchema, payload, 'memory acceptance result');
    },

    async correctMemory(input) {
      const parsed = parseInput(correctMemoryInputSchema, input, 'memory correction');
      const payload = await client.post(ROUTES.memoryCorrections(parsed.memoryId), parsed);
      return parseContract(memoryOperationResultSchema, payload, 'memory correction result');
    },

    async inspectOperation(projectId, operationId) {
      const payload = await client.get(ROUTES.operation(operationId), { projectId });
      return parseContract(operationViewSchema, payload, 'operation view');
    },

    async inspectSource(projectId, sourceId) {
      const payload = await client.get(ROUTES.source(sourceId), { projectId });
      return parseContract(sourceViewSchema, payload, 'source view');
    },

    async readSource(projectId, sourceId, start, end) {
      if (!Number.isInteger(start) || start < 0) {
        throw new ThreadlineError('invalid_request', 'A source read needs a non-negative offset.');
      }
      if (!Number.isInteger(end) || end <= start || end - start > MAX_SOURCE_READ_BYTES) {
        throw new ThreadlineError(
          'invalid_request',
          `A source read must cover between 1 and ${String(MAX_SOURCE_READ_BYTES)} bytes.`,
        );
      }
      const payload = await client.get(ROUTES.sourceRange(sourceId), { projectId, start, end });
      return parseContract(sourceRangeSchema, payload, 'source range');
    },
  };
}

export interface OperationWaitOptions {
  readonly projectId: string;
  readonly timeoutMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * The poll interval keeps the event loop alive on purpose.
 *
 * An unref'd timer would let Node exit between polls with no output and a
 * success exit code, which would report an unfinished operation as a finished
 * one. The wait is already bounded by its deadline.
 */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Follows one operation until it leaves the in-flight states.
 *
 * This never interprets the outcome. `pending`, `leased` and `ambiguous` mean
 * the guarded mutation has no durable result yet, which is reported as such;
 * `committed` and `rejected` are the settled states, and `cancelled` is
 * reported distinctly rather than folded into either.
 */
export async function waitForOperation(
  surface: MemorySurface,
  operationId: string,
  options: OperationWaitOptions,
): Promise<OperationView> {
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const view = await surface.inspectOperation(options.projectId, operationId);
    if (view.state !== 'pending' && view.state !== 'leased') {
      return view;
    }
    if (Date.now() >= deadline) {
      return view;
    }
    await sleep(OPERATION_POLL_INTERVAL_MS);
  }
}

/** True when the operation has no durable outcome yet. */
export function isInFlightState(state: string): boolean {
  return state === 'pending' || state === 'leased';
}

/** True when the guarded mutation committed to the project graph. */
export function isCommittedState(state: string): boolean {
  return state === 'committed';
}

/** True when the operation has no durable outcome yet. */
export function isInFlight(view: OperationView): boolean {
  return isInFlightState(view.state);
}