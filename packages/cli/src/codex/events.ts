import {
  SOURCE_LIMITS,
  utf8ByteLength,
  type CaptureCompleteness,
  type IdentityPrecision,
  type SourceKind,
} from '@threadline/shared';

/**
 * Codex hook-event normalization.
 *
 * A Codex command hook receives exactly one JSON object on stdin. This module
 * turns that object into one bounded, explicitly-classified capture event for
 * the future memory uploader. It never guesses:
 *
 * - an event name outside the installed allowlist is ignored with a reason,
 * - malformed or oversized input is refused,
 * - a payload cut at the adapter bound is reported as `partial` with a gap
 *   reason instead of being silently shortened,
 * - correlation identifiers that exceed the shared reference bound become
 *   `null` rather than truncated, because a truncated identifier is a wrong
 *   identifier.
 *
 * The encoded surface (event names, input fields, output shapes, bounds) is
 * qualified against the installed `codex-cli` and recorded in
 * `docs/native-integration-contract.md`. This module performs no I/O and holds
 * no credentials.
 */

/** Canonical event kinds: exactly the installed binary's `HookEventName` enum. */
export const CODEX_HOOK_EVENT_KINDS = [
  'preToolUse',
  'permissionRequest',
  'postToolUse',
  'preCompact',
  'postCompact',
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'subagentStart',
  'subagentStop',
  'stop',
  'interrupt',
] as const;
export type CodexHookEventKind = (typeof CODEX_HOOK_EVENT_KINDS)[number];

/** The spellings Codex uses on the hook wire (`hook_event_name`). */
export const CODEX_HOOK_WIRE_NAMES: Readonly<Record<CodexHookEventKind, string>> = {
  preToolUse: 'PreToolUse',
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  preCompact: 'PreCompact',
  postCompact: 'PostCompact',
  sessionStart: 'SessionStart',
  sessionEnd: 'SessionEnd',
  userPromptSubmit: 'UserPromptSubmit',
  subagentStart: 'SubagentStart',
  subagentStop: 'SubagentStop',
  stop: 'Stop',
  interrupt: 'Interrupt',
};

/**
 * Largest hook input this adapter admits, matching the shared request-input
 * bound. Input beyond it is refused outright rather than read unbounded; text
 * fields are separately bounded below so any accepted capture stays well under
 * the shared hook-record bound.
 */
export const CODEX_HOOK_INPUT_MAX_BYTES = SOURCE_LIMITS.maxInputBytes;

/** Bound for one captured visible text field (prompt, tool payload, message). */
export const CODEX_HOOK_TEXT_MAX_BYTES = 64 * 1024;

/** Bound for one correlation reference, matching the shared source contract. */
export const CODEX_HOOK_REF_MAX_BYTES = 256;

/** Bound for a reported unknown event name; arbitrary input is never echoed whole. */
export const CODEX_HOOK_UNKNOWN_NAME_MAX_BYTES = 64;

/** Origin revision for records produced by this adapter surface. */
export const CODEX_HOOK_ORIGIN_REVISION = 'hook-v1';

/**
 * Hook identity is always `provisional` at this boundary.
 *
 * The hook envelope reports the session id, and subagent hooks report the
 * parent session id plus `agent_id`/`agent_type`, so a hook alone cannot prove
 * which thread (root, fork or subagent) produced an event. Strong identity
 * requires the separately qualified correlation path described in the
 * integration contract; until then every hook capture keeps this precision.
 */
export const CODEX_HOOK_IDENTITY_PRECISION: IdentityPrecision = 'provisional';

export interface CodexHookRouting {
  /** Documented `cwd`; routing metadata, never evidence content. */
  readonly workingDirectory: string | null;
  /** Documented `model`; routing metadata, never evidence content. */
  readonly model: string | null;
  /** Documented `permission_mode` when the event carries it. */
  readonly permissionMode: string | null;
}

export type CodexHookPayload =
  | { readonly kind: 'prompt'; readonly text: string; readonly truncated: boolean }
  | {
      readonly kind: 'tool_call';
      readonly toolName: string;
      /** Tool arguments as JSON text, or null when the event carried none. */
      readonly argumentsText: string | null;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'tool_result';
      readonly toolName: string;
      /** Tool result as JSON text, or null when the event carried none. */
      readonly resultText: string | null;
      readonly truncated: boolean;
    }
  | { readonly kind: 'assistant_message'; readonly text: string | null; readonly truncated: boolean }
  | { readonly kind: 'lifecycle'; readonly summary: string; readonly detail: string | null };

export interface CodexHookCapture {
  readonly event: CodexHookEventKind;
  readonly sourceKind: SourceKind;
  /** Stable native occurrence identity; see `buildOriginKey`. */
  readonly originKey: string;
  readonly originRevision: string;
  /** Documented `session_id`, bounded; null when missing or out of bound. */
  readonly nativeSessionRef: string | null;
  /** Documented `turn_id` on turn-scoped events. */
  readonly nativeTurnRef: string | null;
  /** Documented `agent_id` on subagent events. */
  readonly nativeAgentRef: string | null;
  /** Documented `agent_type` on subagent events. */
  readonly nativeAgentType: string | null;
  /** Documented `tool_use_id` on tool events. */
  readonly nativeToolRef: string | null;
  readonly identityPrecision: IdentityPrecision;
  readonly completeness: CaptureCompleteness;
  readonly gapReason: string | null;
  readonly observedAtMs: number;
  readonly routing: CodexHookRouting;
  readonly payload: CodexHookPayload;
  /**
   * Documented input fields that were present and deliberately not captured:
   * transcript paths are never opened, and `stop_hook_active` is a control
   * flag with no evidence value.
   */
  readonly excluded: readonly string[];
}

export type CodexHookNormalization =
  | { readonly status: 'captured'; readonly capture: CodexHookCapture }
  | { readonly status: 'ignored'; readonly reason: 'unknown_event'; readonly reportedEventName: string }
  | {
      readonly status: 'refused';
      readonly reason: 'input_too_large' | 'invalid_json' | 'invalid_shape';
      readonly detail: string;
    };

export interface NormalizeHookInputOptions {
  /** Observation time; injected by callers that need deterministic output. */
  readonly nowMs?: number;
}

const SOURCE_KIND_BY_EVENT: Readonly<Record<CodexHookEventKind, SourceKind>> = {
  preToolUse: 'tool_call',
  permissionRequest: 'permission_outcome',
  postToolUse: 'tool_result',
  preCompact: 'lifecycle',
  postCompact: 'lifecycle',
  sessionStart: 'lifecycle',
  sessionEnd: 'lifecycle',
  userPromptSubmit: 'user_message',
  subagentStart: 'lifecycle',
  subagentStop: 'final_output',
  stop: 'final_output',
  interrupt: 'lifecycle',
};

const LIFECYCLE_SUMMARY_BY_EVENT: Partial<Record<CodexHookEventKind, string>> = {
  preCompact: 'context compaction started',
  postCompact: 'context compaction finished',
  sessionStart: 'session started',
  sessionEnd: 'session ended',
  subagentStart: 'subagent started',
  interrupt: 'turn interrupted',
};

const KNOWN_EVENT_LOOKUP: ReadonlyMap<string, CodexHookEventKind> = buildEventLookup();

const EXCLUDED_FIELD_CANDIDATES = ['transcript_path', 'agent_transcript_path', 'stop_hook_active'] as const;

interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
}

interface BoundedRef {
  readonly value: string | null;
  readonly present: boolean;
}

function buildEventLookup(): ReadonlyMap<string, CodexHookEventKind> {
  const lookup = new Map<string, CodexHookEventKind>();
  for (const kind of CODEX_HOOK_EVENT_KINDS) {
    lookup.set(kind.toLowerCase(), kind);
    lookup.set(CODEX_HOOK_WIRE_NAMES[kind].toLowerCase(), kind);
  }
  return lookup;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Truncates on code-point boundaries so a cut never splits a surrogate pair
 * (which would emit an invalid replacement character into captured bytes).
 */
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

function boundText(value: string, maxBytes: number): BoundedText {
  if (utf8ByteLength(value) <= maxBytes) {
    return { text: value, truncated: false };
  }
  return { text: truncateToBytes(value, maxBytes), truncated: true };
}

/**
 * Reads a correlation reference. A value outside the shared reference bound is
 * dropped to `null` (never truncated) and reported as present so the caller can
 * treat it as a correlation gap rather than an absent field.
 */
function readRef(record: Record<string, unknown>, key: string): BoundedRef {
  const raw = record[key];
  if (typeof raw !== 'string') {
    return { value: null, present: raw !== undefined };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || utf8ByteLength(trimmed) > CODEX_HOOK_REF_MAX_BYTES) {
    return { value: null, present: true };
  }
  return { value: trimmed, present: true };
}

/**
 * Reads a bounded routing string. Over-bound values are dropped to `null`
 * rather than truncated: a shortened path or model slug is a wrong value.
 */
function readRoutingText(record: Record<string, unknown>, key: string, maxBytes: number): string | null {
  const raw = record[key];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || utf8ByteLength(trimmed) > maxBytes) {
    return null;
  }
  return trimmed;
}

/** JSON text for a tool input/response value, bounded and flagged. */
function boundJsonValue(value: unknown, maxBytes: number): BoundedText | null {
  if (value === undefined) {
    return null;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    return null;
  }
  return boundText(encoded, maxBytes);
}

/**
 * Stable native occurrence identity for a hook capture.
 *
 * The key is deterministic over the documented correlation fields. Events
 * without a turn or tool reference (for example `SessionStart`) are unique per
 * session and event; the future uploader must not claim stronger uniqueness
 * than this, and must refuse to append a capture with no session reference.
 */
export function buildOriginKey(capture: {
  readonly event: CodexHookEventKind;
  readonly nativeSessionRef: string | null;
  readonly nativeTurnRef: string | null;
  readonly nativeToolRef: string | null;
}): string {
  const session = capture.nativeSessionRef ?? '-';
  const turn = capture.nativeTurnRef ?? '-';
  const tool = capture.nativeToolRef ?? '-';
  return `codex:${CODEX_HOOK_ORIGIN_REVISION}:${session}:${CODEX_HOOK_WIRE_NAMES[capture.event]}:${turn}:${tool}`;
}

function buildPayload(
  event: CodexHookEventKind,
  record: Record<string, unknown>,
): { readonly payload: CodexHookPayload; readonly truncated: boolean; readonly gapReason: string | null } {
  switch (event) {
    case 'userPromptSubmit': {
      const prompt = record['prompt'];
      if (typeof prompt !== 'string') {
        return { payload: { kind: 'prompt', text: '', truncated: false }, truncated: false, gapReason: 'prompt_missing' };
      }
      const bounded = boundText(prompt, CODEX_HOOK_TEXT_MAX_BYTES);
      return {
        payload: { kind: 'prompt', text: bounded.text, truncated: bounded.truncated },
        truncated: bounded.truncated,
        gapReason: bounded.truncated ? 'payload_exceeded_bound' : null,
      };
    }
    case 'preToolUse':
    case 'permissionRequest': {
      const toolName = readRoutingText(record, 'tool_name', CODEX_HOOK_REF_MAX_BYTES) ?? 'unknown';
      const argumentsText = boundJsonValue(record['tool_input'], CODEX_HOOK_TEXT_MAX_BYTES);
      const truncated = argumentsText?.truncated ?? false;
      return {
        payload: {
          kind: 'tool_call',
          toolName,
          argumentsText: argumentsText === null ? null : argumentsText.text,
          truncated,
        },
        truncated,
        gapReason: truncated ? 'payload_exceeded_bound' : null,
      };
    }
    case 'postToolUse': {
      const toolName = readRoutingText(record, 'tool_name', CODEX_HOOK_REF_MAX_BYTES) ?? 'unknown';
      const resultText = boundJsonValue(record['tool_response'], CODEX_HOOK_TEXT_MAX_BYTES);
      const truncated = resultText?.truncated ?? false;
      return {
        payload: {
          kind: 'tool_result',
          toolName,
          resultText: resultText === null ? null : resultText.text,
          truncated,
        },
        truncated,
        gapReason: truncated ? 'payload_exceeded_bound' : null,
      };
    }
    case 'stop':
    case 'subagentStop': {
      const message = record['last_assistant_message'];
      if (typeof message !== 'string' || message.trim().length === 0) {
        return { payload: { kind: 'assistant_message', text: null, truncated: false }, truncated: false, gapReason: null };
      }
      const bounded = boundText(message, CODEX_HOOK_TEXT_MAX_BYTES);
      return {
        payload: { kind: 'assistant_message', text: bounded.text, truncated: bounded.truncated },
        truncated: bounded.truncated,
        gapReason: bounded.truncated ? 'payload_exceeded_bound' : null,
      };
    }
    default: {
      const summary = LIFECYCLE_SUMMARY_BY_EVENT[event] ?? 'lifecycle event';
      const detail =
        event === 'sessionStart'
          ? readRoutingText(record, 'source', 64)
          : event === 'sessionEnd'
            ? readRoutingText(record, 'reason', 64)
            : event === 'subagentStart'
              ? readRoutingText(record, 'agent_type', CODEX_HOOK_REF_MAX_BYTES)
              : null;
      return { payload: { kind: 'lifecycle', summary, detail }, truncated: false, gapReason: null };
    }
  }
}

/**
 * Normalizes one hook stdin payload.
 *
 * Never throws on hostile input: every outcome is a typed result. Callers must
 * exit `0` for ignored/refused outcomes so the native run continues.
 */
export function normalizeHookInput(
  rawInput: string,
  options: NormalizeHookInputOptions = {},
): CodexHookNormalization {
  if (utf8ByteLength(rawInput) > CODEX_HOOK_INPUT_MAX_BYTES) {
    return {
      status: 'refused',
      reason: 'input_too_large',
      detail: `Hook input exceeds ${String(CODEX_HOOK_INPUT_MAX_BYTES)} UTF-8 bytes.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return { status: 'refused', reason: 'invalid_json', detail: 'Hook input is not valid JSON.' };
  }

  if (!isPlainObject(parsed)) {
    return { status: 'refused', reason: 'invalid_shape', detail: 'Hook input is not a JSON object.' };
  }

  const rawName = parsed['hook_event_name'];
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    return { status: 'refused', reason: 'invalid_shape', detail: 'Hook input has no hook_event_name.' };
  }

  const event = KNOWN_EVENT_LOOKUP.get(rawName.trim().toLowerCase());
  if (event === undefined) {
    return {
      status: 'ignored',
      reason: 'unknown_event',
      reportedEventName: truncateToBytes(rawName.trim(), CODEX_HOOK_UNKNOWN_NAME_MAX_BYTES),
    };
  }

  const sessionRef = readRef(parsed, 'session_id');
  const turnRef = readRef(parsed, 'turn_id');
  const agentRef = readRef(parsed, 'agent_id');
  const agentTypeRef = readRef(parsed, 'agent_type');
  const toolRef = readRef(parsed, 'tool_use_id');

  const built = buildPayload(event, parsed);

  // A present-but-unusable correlation reference is a gap the uploader must be
  // able to see; it is never repaired by truncation.
  const correlationGap =
    sessionRef.present && sessionRef.value === null
      ? 'session_reference_unusable'
      : turnRef.present && turnRef.value === null
        ? 'turn_reference_unusable'
        : null;

  const excluded: string[] = [];
  for (const field of EXCLUDED_FIELD_CANDIDATES) {
    if (parsed[field] !== undefined) {
      excluded.push(field);
    }
  }

  const capture: CodexHookCapture = {
    event,
    sourceKind: SOURCE_KIND_BY_EVENT[event],
    originKey: buildOriginKey({
      event,
      nativeSessionRef: sessionRef.value,
      nativeTurnRef: turnRef.value,
      nativeToolRef: toolRef.value,
    }),
    originRevision: CODEX_HOOK_ORIGIN_REVISION,
    nativeSessionRef: sessionRef.value,
    nativeTurnRef: turnRef.value,
    nativeAgentRef: agentRef.value,
    nativeAgentType: agentTypeRef.value,
    nativeToolRef: toolRef.value,
    identityPrecision: CODEX_HOOK_IDENTITY_PRECISION,
    completeness: built.gapReason !== null || correlationGap !== null ? 'partial' : 'complete',
    gapReason: built.gapReason ?? correlationGap,
    observedAtMs: options.nowMs ?? Date.now(),
    routing: {
      workingDirectory: readRoutingText(parsed, 'cwd', 4096),
      model: readRoutingText(parsed, 'model', CODEX_HOOK_REF_MAX_BYTES),
      permissionMode: readRoutingText(parsed, 'permission_mode', 64),
    },
    payload: built.payload,
    excluded,
  };

  return { status: 'captured', capture };
}
