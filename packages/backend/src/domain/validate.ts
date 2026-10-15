import {
  PROTOCOL_VERSION,
  errorPayload,
  isCommandName,
  type CommandName,
  type CommandRequest,
  type ThreadlineErrorPayload,
} from '@threadline/shared';

import type { BackendLimits } from '../config.js';

/**
 * Validates an untrusted request body into a typed command.
 *
 * This is the only place external input becomes a domain call, so it is kept
 * free of HTTP types and can be reused by any future transport. Submitted
 * values are never echoed into the error payload.
 */

export type ParsedCommand = {
  readonly [C in CommandName]: {
    readonly command: C;
    readonly input: CommandRequest<C>['input'];
  };
}[CommandName];

export type ParseCommandResult =
  | { readonly ok: true; readonly parsed: ParsedCommand }
  | { readonly ok: false; readonly error: ThreadlineErrorPayload };

export function parseCommandRequest(body: unknown, limits: BackendLimits): ParseCommandResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      error: errorPayload('invalid_request', 'The request body must be a JSON object.', {
        hint: `Send {"protocolVersion":${PROTOCOL_VERSION},"command":"development.echo","input":{...}}.`,
      }),
    };
  }

  const versionIssue = validateProtocolVersion(body['protocolVersion']);
  if (versionIssue) {
    return { ok: false, error: versionIssue };
  }

  const command = body['command'];
  if (typeof command !== 'string') {
    return {
      ok: false,
      error: errorPayload('invalid_request', 'The "command" field is required.', {
        hint: 'Send a command name from the published command registry.',
      }),
    };
  }
  if (!isCommandName(command)) {
    return {
      ok: false,
      error: errorPayload('unknown_command', `"${command}" is not a known command.`, {
        hint: 'Call GET /healthz for the backend version, then use a name from the shared command registry.',
      }),
    };
  }

  const allowedKeys = ['protocolVersion', 'command', 'input'];
  const unknownKey = findUnknownKey(body, allowedKeys);
  if (unknownKey !== null) {
    return {
      ok: false,
      error: errorPayload('invalid_request', `Unknown request field "${unknownKey}".`, {
        hint: `This protocol version accepts only ${allowedKeys.join(', ')}.`,
      }),
    };
  }

  const input = body['input'];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: errorPayload('invalid_request', 'The "input" field must be a JSON object.', {
        hint: 'Send the documented input object for this command.',
      }),
    };
  }

  // Each command validates its own input; only 'development.echo' exists now.
  return validateDevelopmentEcho(input, limits);
}

function validateDevelopmentEcho(
  input: Record<string, unknown>,
  limits: BackendLimits,
): ParseCommandResult {
  const unknownKey = findUnknownKey(input, ['text']);
  if (unknownKey !== null) {
    return {
      ok: false,
      error: errorPayload('invalid_request', `Unknown input field "${unknownKey}".`, {
        hint: 'development.echo accepts only "text".',
      }),
    };
  }
  const text = input['text'];
  if (typeof text !== 'string') {
    return {
      ok: false,
      error: errorPayload('invalid_request', 'development.echo requires a string "text".', {
        hint: 'Send {"text":"..."}. The text itself is not repeated in this error.',
      }),
    };
  }
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: errorPayload('invalid_request', 'development.echo requires non-empty "text".', {
        hint: 'Send at least one non-whitespace character.',
      }),
    };
  }
  if (text.length > limits.maxCommandTextLength) {
    return {
      ok: false,
      error: errorPayload(
        'invalid_request',
        `development.echo text exceeds the configured limit of ${limits.maxCommandTextLength} characters.`,
        { limit: limits.maxCommandTextLength, received: text.length },
      ),
    };
  }
  return { ok: true, parsed: { command: 'development.echo', input: { text } } };
}

function validateProtocolVersion(value: unknown): ThreadlineErrorPayload | null {
  if (value === undefined) {
    return errorPayload('invalid_request', 'The "protocolVersion" field is required.', {
      hint: `Send ${PROTOCOL_VERSION}, the version this backend implements.`,
    });
  }
  if (value !== PROTOCOL_VERSION) {
    return errorPayload(
      'invalid_request',
      `This backend speaks protocol version ${PROTOCOL_VERSION}, not ${String(value)}.`,
      { expected: PROTOCOL_VERSION },
    );
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findUnknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return key;
    }
  }
  return null;
}