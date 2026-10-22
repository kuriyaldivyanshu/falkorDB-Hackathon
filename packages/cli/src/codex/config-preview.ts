import { createHash } from 'node:crypto';

/**
 * Shared Codex configuration-preview constants and ownership checks.
 *
 * The preview targets the documented profile file
 * `$CODEX_HOME/threadline.config.toml`, selected by
 * `codex --profile threadline`, because that route is explicitly scoped:
 * nothing loads for sessions started without the profile, and no user-global
 * `hooks.json` (which would affect unrelated projects) is involved.
 *
 * Properties these helpers must keep:
 *
 * - **Deterministic:** identical inputs render identical bytes and digests, so
 *   a preview can be reviewed, diffed and compared against an installed file.
 * - **Non-secret:** only paths and fixed placeholders are rendered. The
 *   credential is never written into configuration; the runtime reads it from
 *   the Threadline home.
 * - **Ownership-aware:** every managed block is delimited by a marker line, and
 *   `checkPreviewOwnership` classifies an existing file as absent, owned,
 *   edited-by-a-human or foreign before any future writer may touch it.
 */

export const CODEX_PROFILE_NAME = 'threadline';
export const CODEX_PROFILE_FILE_NAME = 'threadline.config.toml';
export const CODEX_MANIFEST_FILE_NAME = 'threadline-codex.manifest.json';
export const CODEX_MCP_SERVER_ID = 'threadline';
export const CODEX_OWNERSHIP_MARKER = 'threadline:managed v1';
export const CODEX_OWNERSHIP_MARKER_LINE = `# ${CODEX_OWNERSHIP_MARKER}`;

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

export type PreviewOwnershipState = 'absent' | 'owned' | 'edited' | 'foreign';

export interface PreviewOwnershipCheck {
  readonly state: PreviewOwnershipState;
  readonly detail: string;
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
