import { randomUUID } from 'node:crypto';

import {
  ThreadlineError,
  createTaskInputSchema,
  parseContract,
  requireMemoryInputSchema,
  taskOperationResultSchema,
  taskRequirementsViewSchema,
  taskViewSchema,
  type TaskOperationResult,
  type TaskRequirementsView,
  type TaskView,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest } from '../storage/digest.js';
import type { GraphStore } from '../storage/graph.js';
import {
  projectRootIdFor,
  readTaskRequirementHeadRows,
  readTaskRow,
  readVersionDetailRows,
} from '../storage/memoryGraph.js';
import type { SqlDatabase } from '../storage/pg.js';
import { withProjectWriteLock } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { requirePermission } from './permissions.js';
import {
  classifyDedupe,
  findIntentByKey,
  insertIntent,
  intentKeyFor,
  requireActiveProjectRoot,
  requireProjectScope,
  requireWriteRole,
  toMemoryVersion,
  toTaskOperationResult,
  withGraphRead,
} from './semanticSupport.js';

/**
 * Task creation, inspection and requirement binding.
 *
 * A task is a bounded coordination object: a title, an optional family, an
 * opaque revision token and a bounded set of required memory identities. The
 * task record itself lives in the project graph; its mutation intents live in
 * the SQL ledger and commit through the same guarded worker path as memory.
 *
 * Requirement binding names a stable memory identity, not a version: the task
 * keeps requiring that memory while its accepted version moves, and the
 * requirements read resolves the exact current version each time.
 */

export interface TaskService {
  create(call: AuthenticatedCall, input: unknown): Promise<TaskOperationResult>;
  view(call: AuthenticatedCall, projectId: string, taskId: string): Promise<TaskView>;
  require(call: AuthenticatedCall, input: unknown): Promise<TaskOperationResult>;
  requirements(call: AuthenticatedCall, projectId: string, taskId: string): Promise<TaskRequirementsView>;
}

export interface TaskServiceDeps {
  readonly db: SqlDatabase;
  readonly graphStore: GraphStore;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  const requireGraph = (call: AuthenticatedCall): ReturnType<GraphStore['graph']> => {
    const graphKey = call.scope.graphKey;
    if (graphKey === null) {
      throw new ThreadlineError('storage_unavailable', 'FalkorDB is not configured for this service.');
    }
    return deps.graphStore.graph(graphKey);
  };

  const admitTaskIntent = async (
    call: AuthenticatedCall,
    projectId: string,
    intent: {
      readonly kind: 'task.create' | 'task.require';
      readonly idempotencyKey: string;
      readonly requestDigest: string;
      readonly payload: Record<string, unknown>;
      readonly operationId: string;
      readonly intentMemoryId?: string | null;
      readonly intentTaskId: string;
      readonly expectedTaskRevision?: string | null;
    },
  ): Promise<TaskOperationResult> => {
    const operationKey = intentKeyFor(intent.kind, intent.idempotencyKey);
    const record = await withProjectWriteLock(deps.db, call.scope.tenantId, projectId, async (tx) => {
      const existing = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (existing !== null) {
        return classifyDedupe(existing, call.scope.principalId, intent.requestDigest);
      }
      await insertIntent(tx, call.scope.tenantId, projectId, {
        id: intent.operationId,
        kind: intent.kind,
        operationKey,
        requestDigest: intent.requestDigest,
        actorPrincipalId: call.scope.principalId,
        actorTokenId: call.tokenId,
        nativeSessionId: call.scope.nativeSessionId,
        graphEpoch: call.scope.graphEpoch ?? '00000000-0000-0000-0000-000000000000',
        privacyRevision: call.scope.privacyRevision ?? '0',
        payload: intent.payload,
        createdAt: clock(),
        intentTaskId: intent.intentTaskId,
        intentMemoryId: intent.intentMemoryId ?? null,
        expectedTaskRevision: intent.expectedTaskRevision ?? null,
      });
      const inserted = await findIntentByKey(tx, call.scope.tenantId, projectId, operationKey);
      if (inserted === null) {
        throw new ThreadlineError('internal_error', 'The admitted operation could not be read back.');
      }
      return classifyDedupe(inserted, call.scope.principalId, intent.requestDigest);
    });
    logger.log({
      level: 'info',
      message: 'Task intent admitted for graph commitment.',
      fields: { operationId: record.operationId, kind: intent.kind, state: record.state },
    });
    return parseContract(taskOperationResultSchema, toTaskOperationResult(record), 'task operation result');
  };

  return {
    async create(call, input): Promise<TaskOperationResult> {
      const parsed = parseContract(createTaskInputSchema, input, 'task creation input');
      requireProjectScope(call, parsed.projectId);
      requireWriteRole(call);
      const taskFamily = parsed.taskFamily ?? null;
      return admitTaskIntent(call, parsed.projectId, {
        kind: 'task.create',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest: canonicalDigest({
          kind: 'task.create',
          projectId: parsed.projectId,
          title: parsed.title,
          taskFamily,
        }),
        payload: { title: parsed.title, taskFamily },
        operationId: randomUUID(),
        intentTaskId: randomUUID(),
      });
    },

    async view(call, projectId, taskId): Promise<TaskView> {
      requirePermission(call, 'read');
      requireProjectScope(call, projectId);
      const graph = requireGraph(call);
      return withGraphRead(async () => {
        await requireActiveProjectRoot(graph, call);
        const row = await readTaskRow(graph, projectRootIdFor(projectId), taskId);
        if (row === null || row.title === null || row.state === null || row.revision === null) {
          throw new ThreadlineError('not_found', 'No such task exists in this project scope.');
        }
        return parseContract(
          taskViewSchema,
          {
            taskId,
            projectId,
            title: row.title,
            taskFamily: row.task_family,
            state: row.state,
            revision: row.revision,
            createdAtMs: row.created_at_ms ?? 0,
            requiredMemoryIds: [...row.required_memory_ids].sort(),
          },
          'task view',
        );
      });
    },

    async require(call, input): Promise<TaskOperationResult> {
      const parsed = parseContract(requireMemoryInputSchema, input, 'task requirement input');
      requireProjectScope(call, parsed.projectId);
      requireWriteRole(call);
      return admitTaskIntent(call, parsed.projectId, {
        kind: 'task.require',
        idempotencyKey: parsed.idempotencyKey,
        requestDigest: canonicalDigest({
          kind: 'task.require',
          projectId: parsed.projectId,
          taskId: parsed.taskId,
          memoryId: parsed.memoryId,
          expectedTaskRevision: parsed.expectedTaskRevision,
        }),
        payload: {},
        operationId: randomUUID(),
        intentTaskId: parsed.taskId,
        intentMemoryId: parsed.memoryId,
        expectedTaskRevision: parsed.expectedTaskRevision,
      });
    },

    async requirements(call, projectId, taskId): Promise<TaskRequirementsView> {
      requirePermission(call, 'read');
      requireProjectScope(call, projectId);
      const graph = requireGraph(call);
      return withGraphRead(async () => {
        await requireActiveProjectRoot(graph, call);
        const rows = await readTaskRequirementHeadRows(graph, projectRootIdFor(projectId), taskId);
        if (rows === null) {
          throw new ThreadlineError('not_found', 'No such task exists in this project scope.');
        }
        const revision = rows[0]?.revision ?? null;
        if (revision === null) {
          throw new ThreadlineError('authority_unavailable', 'The task revision could not be read from the project graph.');
        }
        const resolved = rows.filter((row) => row.memory_id !== null);
        const currentIds = new Set<string>();
        for (const row of resolved) {
          if (row.current_version_ids.length === 1) {
            currentIds.add(row.current_version_ids[0] ?? '');
          }
        }
        const details = new Map(
          (await readVersionDetailRows(graph, [...currentIds])).map((detail) => [detail.version_id ?? '', detail]),
        );
        const requirements = resolved.map((row) => {
          const memoryId = row.memory_id ?? '';
          const currentVersionIds = [...new Set(row.current_version_ids)];
          if (currentVersionIds.length === 0) {
            return { memoryId, kind: row.memory_kind, state: 'missing_current' as const, current: null };
          }
          if (currentVersionIds.length > 1) {
            return { memoryId, kind: row.memory_kind, state: 'duplicate_current' as const, current: null };
          }
          const detail = details.get(currentVersionIds[0] ?? '');
          if (detail === undefined || !detail.is_current || detail.acceptance !== 'accepted') {
            throw new ThreadlineError(
              'authority_conflict',
              'A required memory head could not be resolved consistently; retry the read.',
            );
          }
          return {
            memoryId,
            kind: row.memory_kind,
            state: 'current' as const,
            current: toMemoryVersion(detail),
          };
        });
        return parseContract(
          taskRequirementsViewSchema,
          { taskId, revision, requirements },
          'task requirements view',
        );
      });
    },
  };
}
