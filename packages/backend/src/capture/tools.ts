import { READ_ONLY_FUNCTIONS, resolveReadOnlyFunction } from '../workspace/tools.js';

import { SOURCE_RETRIEVAL_FUNCTION, SOURCE_RETRIEVAL_TOOL_NAME } from './sources.js';

/**
 * The model-facing tool set.
 *
 * M03 adds `memory.retrieve(mode=source)` alongside the three M02 workspace
 * tools. The workspace registry in `workspace/tools.ts` is deliberately left at
 * three so the M02 exposure claim stays exactly true, while the set actually
 * advertised to a provider is four. Nothing here is a search, a shell, a
 * registered command or a checkpoint tool.
 */
export const MODEL_TOOL_FUNCTIONS = Object.freeze([...READ_ONLY_FUNCTIONS, SOURCE_RETRIEVAL_FUNCTION]);

/** Dotted harness names, which are what the runtime loop reasons about. */
export const MODEL_TOOL_NAMES = Object.freeze([
  'workspace.read',
  'workspace.search',
  'workspace.inspect',
  SOURCE_RETRIEVAL_TOOL_NAME,
] as const);

export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];

const names: Readonly<Record<string, ModelToolName>> = Object.freeze({
  workspace_read: 'workspace.read',
  workspace_search: 'workspace.search',
  workspace_inspect: 'workspace.inspect',
  memory_retrieve: SOURCE_RETRIEVAL_TOOL_NAME,
});

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
