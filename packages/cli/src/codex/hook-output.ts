import { CONTEXT_DEFAULT_BODY_BYTES, CONTEXT_MAX_BODY_BYTES, utf8ByteLength } from '@threadline/shared';

import { CODEX_HOOK_WIRE_NAMES, type CodexHookEventKind } from './events.js';

/**
 * Hook stdout rendering.
 *
 * A command hook's stdout is a protocol channel, not a log: Codex parses it as
 * hook output, and stray lines corrupt the run. This module renders the exact
 * single JSON object a hook may print, or an explicit refusal decision.
 *
 * Two product rules shape it:
 *
 * - Threadline owns the bytes it supplies. The hook handler is configured with
 *   `additionalContextLimit = 0` (the installed host then passes the text
 *   through without approximate token spilling), so this bound is the only
 *   hard limiter and it is enforced in UTF-8 bytes here.
 * - Degradation is never silent. When context does not fit, the default is
 *   refusal (no partial authority), and any caller-selected truncation is
 *   marked in the emitted text and reported on stderr as well.
 */

/**
 * Events whose hook output can carry model-visible `additionalContext`.
 *
 * Documented support: `SessionStart`, `UserPromptSubmit`, `SubagentStart`,
 * `PreToolUse` and `PostToolUse`. The remaining events accept only common or
 * event-specific output fields, so the adapter must not offer context there.
 */
export const CODEX_CONTEXT_EVENTS = [
  'sessionStart',
  'userPromptSubmit',
  'subagentStart',
  'preToolUse',
  'postToolUse',
] as const;
export type CodexContextEventKind = (typeof CODEX_CONTEXT_EVENTS)[number];

/** Default bound, matching the released default context packet body. */
export const HOOK_ADDITIONAL_CONTEXT_DEFAULT_BYTES = CONTEXT_DEFAULT_BODY_BYTES;

/** Hard upper bound, matching the released maximum context packet body. */
export const HOOK_ADDITIONAL_CONTEXT_MAX_BYTES = CONTEXT_MAX_BODY_BYTES;

/** Smallest bound a truncation marker can meaningfully fit into. */
const HOOK_ADDITIONAL_CONTEXT_MIN_BYTES = 64;

export type HookOutputOverflowPolicy = 'refuse' | 'truncate';

export type HookOutputRefusalReason = 'event_not_supported' | 'context_exceeds_bound' | 'bound_too_small';

export type HookOutputDecision =
  | {
      readonly kind: 'context';
      readonly stdout: string;
      readonly stderr: string | null;
      readonly contextBytes: number;
      readonly truncated: boolean;
    }
  | { readonly kind: 'empty'; readonly stdout: string; readonly stderr: null }
  | {
      readonly kind: 'refused';
      readonly reason: HookOutputRefusalReason;
      readonly stdout: string;
      readonly stderr: string;
    };

export interface RenderHookContextInput {
  readonly event: CodexHookEventKind;
  /** Rendered context packet body, already released by the context service. */
  readonly text: string;
  readonly maxBytes?: number;
  readonly onOverflow?: HookOutputOverflowPolicy;
}

export function isCodexContextEvent(event: CodexHookEventKind): event is CodexContextEventKind {
  return (CODEX_CONTEXT_EVENTS as readonly string[]).includes(event);
}

function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let used = 0;
  let result = '';
  for (const codePoint of value) {
    const size = encoder.encode(codePoint).length;
    if (used + size > maxBytes) {
      break;
    }
    used += size;
    result += codePoint;
  }
  return result;
}

function truncationMarker(totalBytes: number, boundBytes: number): string {
  return `\n\n[threadline: context truncated to ${String(boundBytes)} of ${String(totalBytes)} bytes]`;
}

function refusalLine(reason: HookOutputRefusalReason, detail: string): string {
  return `threadline: hook context ${reason}: ${detail}\n`;
}

function renderContextLine(event: CodexContextEventKind, text: string): string {
  const payload = {
    hookSpecificOutput: {
      hookEventName: CODEX_HOOK_WIRE_NAMES[event],
      additionalContext: text,
    },
  };
  // Exactly one JSON line; the hook entry point must write nothing else to
  // stdout and keep diagnostics on stderr.
  return `${JSON.stringify(payload)}\n`;
}

/**
 * Renders the hook stdout for one delivered-or-refused context emission.
 *
 * The returned `stdout` is the complete protocol output: either one JSON line
 * or the empty string ("exit 0 with no output" is a documented success path,
 * which is why every refusal degrades to it). `stderr` carries the visible
 * explanation; callers exit `0` in every outcome so a Threadline failure never
 * blocks the native session.
 */
export function renderHookContextOutput(input: RenderHookContextInput): HookOutputDecision {
  const maxBytes = input.maxBytes ?? HOOK_ADDITIONAL_CONTEXT_DEFAULT_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < HOOK_ADDITIONAL_CONTEXT_MIN_BYTES || maxBytes > HOOK_ADDITIONAL_CONTEXT_MAX_BYTES) {
    throw new RangeError(
      `Hook context bound must be an integer between ${String(HOOK_ADDITIONAL_CONTEXT_MIN_BYTES)} and ${String(
        HOOK_ADDITIONAL_CONTEXT_MAX_BYTES,
      )} bytes.`,
    );
  }

  if (!isCodexContextEvent(input.event)) {
    return {
      kind: 'refused',
      reason: 'event_not_supported',
      stdout: '',
      stderr: refusalLine(
        'event_not_supported',
        `${CODEX_HOOK_WIRE_NAMES[input.event]} has no model-visible additionalContext boundary; no hook output was emitted.`,
      ),
    };
  }

  if (input.text.trim().length === 0) {
    return { kind: 'empty', stdout: '', stderr: null };
  }

  const totalBytes = utf8ByteLength(input.text);
  if (totalBytes <= maxBytes) {
    return {
      kind: 'context',
      stdout: renderContextLine(input.event, input.text),
      stderr: null,
      contextBytes: totalBytes,
      truncated: false,
    };
  }

  const policy: HookOutputOverflowPolicy = input.onOverflow ?? 'refuse';
  if (policy === 'refuse') {
    return {
      kind: 'refused',
      reason: 'context_exceeds_bound',
      stdout: '',
      stderr: refusalLine(
        'context_exceeds_bound',
        `${String(totalBytes)} bytes exceed the ${String(maxBytes)} byte bound; the packet was withheld rather than partially delivered.`,
      ),
    };
  }

  // Truncation keeps the context available but must stay visible: the emitted
  // text carries a marker with the exact sizes, and the decision reports it.
  const marker = truncationMarker(totalBytes, maxBytes);
  const markerBytes = utf8ByteLength(marker);
  if (markerBytes >= maxBytes) {
    return {
      kind: 'refused',
      reason: 'bound_too_small',
      stdout: '',
      stderr: refusalLine('bound_too_small', 'The configured bound cannot fit a truncation marker.'),
    };
  }
  const body = truncateToBytes(input.text, maxBytes - markerBytes);
  const rendered = `${body}${marker}`;
  return {
    kind: 'context',
    stdout: renderContextLine(input.event, rendered),
    stderr: refusalLine(
      'context_exceeds_bound',
      `${String(totalBytes)} bytes exceeded the ${String(maxBytes)} byte bound; the packet was truncated with an in-band marker.`,
    ),
    contextBytes: utf8ByteLength(rendered),
    truncated: true,
  };
}
