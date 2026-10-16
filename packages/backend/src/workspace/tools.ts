import type { ReadOnlyToolName } from './read-only.js';

/** OpenAI wire names are mapped explicitly to the harness's dotted names. */
const integer = (maximum: number, minimum = 0) => ({ type: ['integer', 'null'], minimum, maximum });
const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const READ_ONLY_FUNCTIONS = [
  { type: 'function', name: 'workspace_read', description: 'Read a bounded UTF-8 range from a registered workspace file. Returns a full-file SHA-256 digest and explicit truncation.', strict: true,
    parameters: schema({ path: { type: 'string' }, offset: integer(50 * 1024 * 1024), maxBytes: integer(32768, 1) }) },
  { type: 'function', name: 'workspace_search', description: 'Search literal case-sensitive text in registered workspace files. No regex or shell. Results include source digests and explicit truncation.', strict: true,
    parameters: schema({ query: { type: 'string', minLength: 1, maxLength: 512 }, maxResults: integer(30, 1) }) },
  { type: 'function', name: 'workspace_inspect', description: 'List bounded registered workspace file paths and sizes. Hidden files, dependencies and symlinks are excluded.', strict: true,
    parameters: schema({ maxFiles: integer(1000, 1) }) },
] as const;
const names: Readonly<Record<string, ReadOnlyToolName>> = Object.freeze({
  workspace_read: 'workspace.read', workspace_search: 'workspace.search', workspace_inspect: 'workspace.inspect',
});
export function resolveReadOnlyFunction(name: string): ReadOnlyToolName | null {
  return Object.hasOwn(names, name) ? names[name] ?? null : null;
}
