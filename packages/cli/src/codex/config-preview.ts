import { createHash } from 'node:crypto';

import { CODEX_HOOK_WIRE_NAMES, type CodexHookEventKind } from './events.js';
import { isCodexContextEvent } from './hook-output.js';

/**
 * Codex configuration preview.
 *
 * Renders the exact bytes a future installation step would place in an
 * isolated Codex home, without writing anything. The selected route is the
 * documented profile file `$CODEX_HOME/threadline.config.toml`, selected by
 * `codex --profile threadline`, because that route is explicitly scoped:
 * nothing loads for sessions started without the profile, and no user-global
 * `hooks.json` (which would affect unrelated projects) is involved.
 *
 * Properties this module must keep:
 *
 * - **Deterministic:** identical inputs render identical bytes and digests, so
 *   the preview can be reviewed, diffed and compared against an installed
 *   file.
 * - **Non-secret:** only paths and fixed placeholders are rendered. The
 *   credential is never written into configuration; the runtime reads it from
 *   the Threadline home.
 * - **Ownership-aware:** every managed block is delimited by a marker line, and
 *   `checkPreviewOwnership` classifies an existing file as absent, owned,
 *   edited-by-a-human or foreign before any future writer may touch it.
 */

export const CODEX_QUALIFIED_VERSION = '0.163.0';
export const CODEX_PROFILE_NAME = 'threadline';
export const CODEX_PROFILE_FILE_NAME = 'threadline.config.toml';
export const CODEX_MANIFEST_FILE_NAME = 'threadline-codex.manifest.json';
export const CODEX_MCP_SERVER_ID = 'threadline';
export const CODEX_OWNERSHIP_MARKER = 'threadline:managed v1';
export const CODEX_OWNERSHIP_MARKER_LINE = `# ${CODEX_OWNERSHIP_MARKER}`;

/**
 * Hook events the preview installs.
 *
 * This is the capture-and-context set: the visible boundaries where Threadline
 * both observes permitted records and can deliver context. Events without a
 * model-visible context boundary are left to a later decision so the installed
 * set stays minimal and justified.
 */
export const CODEX_PREVIEW_HOOK_EVENTS = [
  'sessionStart',
  'userPromptSubmit',
  'preToolUse',
  'postToolUse',
  'stop',
  'sessionEnd',
] as const satisfies readonly CodexHookEventKind[];

export interface CodexConfigPreviewInput {
  /** Absolute path of the Codex home the preview targets. */
  readonly codexHome: string;
  /** Absolute path of the trusted runtime executable (for example Node.js). */
  readonly executable: string;
  /** Absolute path of the Threadline Codex entry script. */
  readonly entryScript: string;
  /** Absolute path of the Threadline service home. Never a secret value. */
  readonly threadlineHome: string;
}

export interface ConfigPreviewFile {
  readonly path: string;
  readonly role: 'profile' | 'manifest';
  readonly content: string;
  /** `sha256:<hex>` over the exact file bytes. */
  readonly digest: string;
}

export interface CodexOwnershipManifest {
  readonly kind: 'threadline-codex-ownership';
  readonly manifestVersion: 1;
  readonly marker: string;
  readonly harness: { readonly name: 'codex'; readonly qualifiedVersion: string };
  readonly profileName: string;
  readonly ownedEntries: {
    readonly mcpServers: readonly string[];
    readonly hookEvents: readonly string[];
  };
  readonly files: readonly { readonly role: ConfigPreviewFile['role']; readonly path: string; readonly digest: string }[];
  readonly policy: {
    readonly replace: 'marker-and-digest-match';
    readonly editedFile: 'manual-resolution-required';
    readonly foreignEntries: 'refuse-and-report';
    readonly secrets: 'process-environment-only';
  };
}

export interface CodexConfigPreview {
  readonly harness: 'codex';
  readonly qualifiedHarnessVersion: string;
  readonly profileName: string;
  readonly mcpServerId: string;
  readonly files: readonly ConfigPreviewFile[];
  readonly ownership: CodexOwnershipManifest;
  readonly notes: readonly string[];
}

export type PreviewOwnershipState = 'absent' | 'owned' | 'edited' | 'foreign';

export interface PreviewOwnershipCheck {
  readonly state: PreviewOwnershipState;
  readonly detail: string;
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

/** Renders a TOML basic string with all control characters escaped. */
export function tomlBasicString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return `\\u${code.toString(16).padStart(4, '0')}`;
    });
  return `"${escaped}"`;
}

/**
 * POSIX single-quote escaping for the hook `command` string.
 *
 * Codex runs hook commands through a shell, so a path containing spaces or
 * metacharacters must be quoted exactly once, here.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function joinedCommand(parts: readonly string[]): string {
  return parts.map((part) => shellQuote(part)).join(' ');
}

function hookCommand(input: CodexConfigPreviewInput, event: CodexHookEventKind): string {
  return joinedCommand([input.executable, input.entryScript, 'codex-hook', CODEX_HOOK_WIRE_NAMES[event], '--home', input.threadlineHome]);
}

function hookTimeoutSeconds(event: CodexHookEventKind): number {
  // SessionEnd is documented as bounded to one through three seconds.
  return event === 'sessionEnd' ? 2 : 10;
}

function renderProfile(input: CodexConfigPreviewInput): string {
  const lines: string[] = [];
  lines.push(CODEX_OWNERSHIP_MARKER_LINE);
  lines.push('# Generated preview only: this build does not install Codex configuration.');
  lines.push(`# Select with: codex --profile ${CODEX_PROFILE_NAME}`);
  lines.push('# Non-managed hooks must be reviewed and trusted (`/hooks`) before they run.');
  lines.push('');
  lines.push(`[mcp_servers.${CODEX_MCP_SERVER_ID}]`);
  lines.push(`command = ${tomlBasicString(input.executable)}`);
  lines.push(
    `args = [${[input.entryScript, 'mcp', '--home', input.threadlineHome].map((part) => tomlBasicString(part)).join(', ')}]`,
  );
  // Memory is additive: a missing Threadline service must not block Codex.
  lines.push('required = false');
  lines.push('startup_timeout_sec = 10');
  lines.push('tool_timeout_sec = 30');
  lines.push(`env = { THREADLINE_HOME = ${tomlBasicString(input.threadlineHome)} }`);
  for (const event of CODEX_PREVIEW_HOOK_EVENTS) {
    const wire = CODEX_HOOK_WIRE_NAMES[event];
    lines.push('');
    lines.push(`# threadline:begin hook:${wire}`);
    lines.push(`[[hooks.${wire}]]`);
    lines.push(`[[hooks.${wire}.hooks]]`);
    lines.push('type = "command"');
    lines.push(`command = ${tomlBasicString(hookCommand(input, event))}`);
    lines.push(`timeout = ${String(hookTimeoutSeconds(event))}`);
    if (isCodexContextEvent(event)) {
      // The host then passes the handler's text through without approximate
      // token spilling; the adapter enforces its own hard byte bound.
      lines.push('additionalContextLimit = 0');
    }
    lines.push(`# threadline:end hook:${wire}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderManifestFile(manifest: CodexOwnershipManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Renders the complete preview: profile file, ownership manifest and notes.
 *
 * The manifest's own digest is intentionally not part of its own content (a
 * file cannot contain its digest); it is computed for verification instead.
 */
export function renderCodexConfigPreview(input: CodexConfigPreviewInput): CodexConfigPreview {
  const codexHome = assertAbsoluteSingleLinePath(input.codexHome, 'codexHome');
  assertAbsoluteSingleLinePath(input.executable, 'executable');
  assertAbsoluteSingleLinePath(input.entryScript, 'entryScript');
  assertAbsoluteSingleLinePath(input.threadlineHome, 'threadlineHome');

  const profilePath = `${codexHome.replace(/\/+$/, '')}/${CODEX_PROFILE_FILE_NAME}`;
  const manifestPath = `${codexHome.replace(/\/+$/, '')}/${CODEX_MANIFEST_FILE_NAME}`;
  const profileContent = renderProfile(input);

  // The manifest lists the other managed files. It cannot list its own digest
  // (a file cannot contain its digest), so a verifier computes that separately.
  const manifest: CodexOwnershipManifest = {
    kind: 'threadline-codex-ownership',
    manifestVersion: 1,
    marker: CODEX_OWNERSHIP_MARKER,
    harness: { name: 'codex', qualifiedVersion: CODEX_QUALIFIED_VERSION },
    profileName: CODEX_PROFILE_NAME,
    ownedEntries: {
      mcpServers: [CODEX_MCP_SERVER_ID],
      hookEvents: CODEX_PREVIEW_HOOK_EVENTS.map((event) => CODEX_HOOK_WIRE_NAMES[event]),
    },
    files: [{ role: 'profile', path: profilePath, digest: sha256Digest(profileContent) }],
    policy: {
      replace: 'marker-and-digest-match',
      editedFile: 'manual-resolution-required',
      foreignEntries: 'refuse-and-report',
      secrets: 'process-environment-only',
    },
  };
  const manifestContent = renderManifestFile(manifest);

  return {
    harness: 'codex',
    qualifiedHarnessVersion: CODEX_QUALIFIED_VERSION,
    profileName: CODEX_PROFILE_NAME,
    mcpServerId: CODEX_MCP_SERVER_ID,
    files: [
      { path: profilePath, role: 'profile', content: profileContent, digest: sha256Digest(profileContent) },
      { path: manifestPath, role: 'manifest', content: manifestContent, digest: sha256Digest(manifestContent) },
    ],
    ownership: manifest,
    notes: [
      `Select the profile with \`codex --profile ${CODEX_PROFILE_NAME}\`; sessions without it load nothing.`,
      'Review and trust the hooks with `/hooks` before they run; trust is recorded against each hook hash.',
      'additionalContextLimit = 0 relies on the adapter enforcing its own byte bound.',
      'The credential is read from the Threadline home at run time and never written into Codex configuration.',
      'The `mcp` and `codex-hook` entry points do not exist in this build; the preview is not installable yet.',
    ],
  };
}

/**
 * Marker detection is role-aware: the profile is TOML with a dedicated marker
 * line, while the manifest is JSON that carries `kind` and `marker` fields.
 * The profile check is line-exact so an incidental mention of the marker text
 * inside another value never counts as ownership.
 */
function hasOwnershipMarker(content: string, role: ConfigPreviewFile['role']): boolean {
  if (role === 'profile') {
    return content.split('\n').some((line) => line === CODEX_OWNERSHIP_MARKER_LINE);
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    return record['kind'] === 'threadline-codex-ownership' && record['marker'] === CODEX_OWNERSHIP_MARKER;
  } catch {
    return false;
  }
}

/**
 * Classifies an existing target file before a future writer may touch it.
 *
 * `owned` requires either the exact preview bytes, or the role-appropriate
 * marker plus a match against `recordedDigest` — the digest the installed
 * manifest recorded for that file. The second rule keeps an unchanged
 * installation replaceable after preview inputs change; without it, a stale but
 * untouched file would be indistinguishable from a human edit. The manifest
 * cannot record its own digest, so its entry is classified by the preview
 * bytes and marker alone. `edited` always requires human resolution, and
 * `foreign` files are never modified or removed.
 */
export function checkPreviewOwnership(
  existingContent: string | null,
  expected: ConfigPreviewFile,
  recordedDigest?: string,
): PreviewOwnershipCheck {
  if (existingContent === null || existingContent.length === 0) {
    return { state: 'absent', detail: `${expected.path} is absent.` };
  }
  if (existingContent === expected.content) {
    return { state: 'owned', detail: `${expected.path} matches the previewed bytes exactly.` };
  }
  if (
    recordedDigest !== undefined &&
    hasOwnershipMarker(existingContent, expected.role) &&
    sha256Digest(existingContent) === recordedDigest
  ) {
    return { state: 'owned', detail: `${expected.path} matches the ownership digest recorded at installation.` };
  }
  if (hasOwnershipMarker(existingContent, expected.role)) {
    return {
      state: 'edited',
      detail: `${expected.path} carries the Threadline ownership marker but matches neither the preview bytes nor a recorded digest; a human must resolve it.`,
    };
  }
  return {
    state: 'foreign',
    detail: `${expected.path} exists without the Threadline ownership marker; Threadline will not modify or remove it.`,
  };
}
