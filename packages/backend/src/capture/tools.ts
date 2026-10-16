import { READ_ONLY_FUNCTIONS, resolveReadOnlyFunction } from '../workspace/tools.js';

import { SOURCE_RETRIEVAL_FUNCTION, SOURCE_RETRIEVAL_TOOL_NAME } from './sources.js';
import { TACTICAL_FUNCTIONS, resolveTacticalTool, type TacticalToolName } from '../tactical/tools.js';

/**
 * The model-facing tool set.
 *
 * M04 advertises seven tools: three workspace tools, Source retrieval, and
 * three tactical tools for checkpoint publication, plan updates and refresh.
 * The workspace-only registry remains separate. Shell execution and registered
 * commands are deferred to later milestones.
 */
export const MODEL_TOOL_FUNCTIONS = Object.freeze([
  ...READ_ONLY_FUNCTIONS,
  SOURCE_RETRIEVAL_FUNCTION,
  ...TACTICAL_FUNCTIONS,
]);

/** Dotted harness names, which are what the runtime loop reasons about. */
export const MODEL_TOOL_NAMES = Object.freeze([
  'workspace.read',
  'workspace.search',
  'workspace.inspect',
  SOURCE_RETRIEVAL_TOOL_NAME,
  'memory.checkpoint',
  'task.update_plan',
  'memory.refresh',
] as const);

export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];

const names: Readonly<Record<string, ModelToolName>> = Object.freeze({
  workspace_read: 'workspace.read',
  workspace_search: 'workspace.search',
  workspace_inspect: 'workspace.inspect',
  memory_retrieve: SOURCE_RETRIEVAL_TOOL_NAME,
  memory_checkpoint: 'memory.checkpoint',
  task_update_plan: 'task.update_plan',
  memory_refresh: 'memory.refresh',
});

/** True when a harness name is served by the tactical service rather than a workspace. */
export function isTacticalName(name: ModelToolName): name is ModelToolName & TacticalToolName {
  return resolveTacticalTool(name.replace('.', '_')) !== null;
}

/**
 * Resolves an OpenAI wire name to a harness tool name.
 *
 * An unregistered name resolves to `null` so the loop refuses it before any
 * workspace or Source access happens.
 */
export function resolveModelTool(name: string): ModelToolName | null {
  return Object.hasOwn(names, name) ? names[name] ?? null : null;
}

/**
 * The M02 workspace mapping is re-exported because the loop needs to decide
 * which invoker owns a resolved name.
 */
export { resolveReadOnlyFunction };
