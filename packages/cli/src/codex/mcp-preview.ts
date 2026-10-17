import { createHash } from 'node:crypto';

import {
  CODEX_MANIFEST_FILE_NAME,
  CODEX_MCP_SERVER_ID,
  CODEX_OWNERSHIP_MARKER,
  CODEX_OWNERSHIP_MARKER_LINE,
  CODEX_PROFILE_FILE_NAME,
  CODEX_PROFILE_NAME,
  CODEX_QUALIFIED_VERSION,
  type CodexOwnershipManifest,
  type ConfigPreviewFile,
  checkPreviewOwnership,
  shellQuote,
  tomlBasicString,
  type PreviewOwnershipCheck,
} from './config-preview.js';

/**
 * The executable, MCP-only Codex configuration preview.
 *
 * The qualification renderer (`renderCodexConfigPreview`) also installs hook
 * entries for `threadline codex-hook`, and this build has no such command. A
 * preview that names a command which does not exist is not installable, so this
 * module renders the same route — the `$CODEX_HOME/threadline.config.toml`
 * profile selected with `codex --profile threadline` — with the stdio MCP
 * server alone.
 *
 * Everything the qualification established is preserved: deterministic bytes,
 * the same ownership marker and manifest shape, the same `checkPreviewOwnership`
 * classification, safe quoting, and no credential in the rendered output. Only
 * the hook entries are omitted, and the preview states that explicitly rather
 * than implying a capture path this build does not have.
 *
 * This renderer performs no I/O and writes nothing.
 */

export const MCP_SERVER_STARTUP_TIMEOUT_SEC = 10;
export const MCP_SERVER_TOOL_TIMEOUT_SEC = 30;

export interface CodexMcpPreviewInput {
  /** Absolute path of the Codex home the preview targets. Never written to. */
  readonly codexHome: string;
  /** Absolute path of the trusted runtime executable (for example Node.js). */
  readonly executable: string;
  /** Absolute path of the Threadline CLI entry script that serves `mcp`. */
  readonly entryScript: string;
  /** Absolute path of the Threadline installation root. Never a secret value. */
  readonly threadlineHome: string;
  /** The one project this server is bound to. Configuration, not a tool argument. */
  readonly projectId: string;
}

export interface CodexMcpPreview {
  readonly harness: 'codex';
  readonly qualifiedHarnessVersion: string;
  readonly profileName: string;
  readonly mcpServerId: string;
  readonly mode: 'mcp-only';
  readonly files: readonly ConfigPreviewFile[];
  readonly ownership: CodexOwnershipManifest;
  /** The exact command a reviewer can copy; identical bytes to the profile args. */
  readonly serverCommand: { readonly executable: string; readonly args: readonly string[] };
  readonly notes: readonly string[];
}

function assertAbsoluteSingleLinePath(value: string, label: string): string {
  if (value.length === 0 || value.includes('\u0000') || value.includes('\n') || value.includes('\r')) {
    throw new TypeError(`${label} must be a non-empty single-line path.`);
  }
  if (!value.startsWith('/')) {
    throw new TypeError(`${label} must be an absolute path.`);
  }
  return value;
}

function sha256Digest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/** The exact argument vector the rendered stdio server receives. */
export function mcpServerArguments(input: CodexMcpPreviewInput): readonly string[] {
  return [input.entryScript, 'mcp', '--home', input.threadlineHome, '--project', input.projectId];
}

/**
 * The shell command a reviewer can copy and run by hand.
 *
 * Each argument is quoted exactly once. The project id and home are already
 * validated as single-line absolute-safe values; the credential never appears,
 * because the server reads it from the Threadline home at startup.
 */
export function renderMcpServerCommand(input: CodexMcpPreviewInput): string {
  return [input.executable, ...mcpServerArguments(input)].map((part) => shellQuote(part)).join(' ');
}

function renderMcpOnlyProfile(input: CodexMcpPreviewInput): string {
  const lines: string[] = [];
  lines.push(CODEX_OWNERSHIP_MARKER_LINE);
  lines.push('# Generated preview only: this build does not install Codex configuration.');
  lines.push(`# Select with: codex --profile ${CODEX_PROFILE_NAME}`);
  lines.push('# Read-only memory tools. This preview installs no hooks:');
  lines.push('# `threadline codex-hook` is not implemented in this build.');
  lines.push('');
  lines.push(`[mcp_servers.${CODEX_MCP_SERVER_ID}]`);
  lines.push(`command = ${tomlBasicString(input.executable)}`);
  lines.push(`args = [${mcpServerArguments(input).map((part) => tomlBasicString(part)).join(', ')}]`);
  // Memory is additive: a missing Threadline service must not block Codex.
  lines.push('required = false');
  lines.push(`startup_timeout_sec = ${String(MCP_SERVER_STARTUP_TIMEOUT_SEC)}`);
  lines.push(`tool_timeout_sec = ${String(MCP_SERVER_TOOL_TIMEOUT_SEC)}`);
  lines.push(`env = { THREADLINE_HOME = ${tomlBasicString(input.threadlineHome)} }`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Renders the MCP-only profile, its ownership manifest and the notes a
 * reviewer needs before installing anything.
 */
export function renderCodexMcpPreview(input: CodexMcpPreviewInput): CodexMcpPreview {
  const codexHome = assertAbsoluteSingleLinePath(input.codexHome, 'codexHome').replace(/\/+$/, '');
  assertAbsoluteSingleLinePath(input.executable, 'executable');
  assertAbsoluteSingleLinePath(input.entryScript, 'entryScript');
  assertAbsoluteSingleLinePath(input.threadlineHome, 'threadlineHome');
  if (input.projectId.length === 0 || input.projectId.includes('\n') || input.projectId.includes('\r')) {
    throw new TypeError('projectId must be a non-empty single-line value.');
  }

  const profilePath = `${codexHome}/${CODEX_PROFILE_FILE_NAME}`;
  const manifestPath = `${codexHome}/${CODEX_MANIFEST_FILE_NAME}`;
  const profileContent = renderMcpOnlyProfile(input);

  const manifest: CodexOwnershipManifest = {
    kind: 'threadline-codex-ownership',
    manifestVersion: 1,
    marker: CODEX_OWNERSHIP_MARKER,
    harness: { name: 'codex', qualifiedVersion: CODEX_QUALIFIED_VERSION },
    profileName: CODEX_PROFILE_NAME,
    ownedEntries: {
      mcpServers: [CODEX_MCP_SERVER_ID],
      // No hook event is owned by this preview: the hook command is unimplemented.
      hookEvents: [],
    },
    files: [{ role: 'profile', path: profilePath, digest: sha256Digest(profileContent) }],
    policy: {
      replace: 'marker-and-digest-match',
      editedFile: 'manual-resolution-required',
      foreignEntries: 'refuse-and-report',
      secrets: 'process-environment-only',
    },
  };
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;

  return {
    harness: 'codex',
    qualifiedHarnessVersion: CODEX_QUALIFIED_VERSION,
    profileName: CODEX_PROFILE_NAME,
    mcpServerId: CODEX_MCP_SERVER_ID,
    mode: 'mcp-only',
    files: [
      { path: profilePath, role: 'profile', content: profileContent, digest: sha256Digest(profileContent) },
      { path: manifestPath, role: 'manifest', content: manifestContent, digest: sha256Digest(manifestContent) },
    ],
    ownership: manifest,
    serverCommand: { executable: input.executable, args: mcpServerArguments(input) },
    notes: [
      `Select the profile with \`codex --profile ${CODEX_PROFILE_NAME}\`; sessions without it load nothing.`,
      `The stdio server is bound to project ${input.projectId} at startup; a tool call cannot select another project, tenant or service address.`,
      'Every exposed tool is read-only: there is no acceptance, proposal, correction or requirement-binding tool.',
      'The credential is read from the Threadline home at run time and is never written into Codex configuration.',
      'No hook entry is rendered because `threadline codex-hook` is not implemented in this build.',
      'Native runtime hook execution, MCP tool-call identity and fork/subagent correlation remain unqualified.',
      'This command renders bytes only; it writes nothing into the Codex home.',
    ],
  };
}

/**
 * Classifies the files a future installer would replace.
 *
 * The classification is the same one the qualification established, applied to
 * what exists on disk right now. Nothing is modified: `edited` still requires a
 * human and `foreign` is still never touched.
 */
export function classifyPreviewTargets(
  preview: CodexMcpPreview,
  existing: ReadonlyMap<string, string>,
): ReadonlyArray<PreviewOwnershipCheck & { readonly role: ConfigPreviewFile['role'] }> {
  return preview.files.map((file) => ({
    role: file.role,
    ...checkPreviewOwnership(existing.get(file.path) ?? null, file),
  }));
}