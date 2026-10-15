import {
  CRITERION_KINDS,
  PROTOCOL_VERSION,
  errorPayload,
  isCommandName,
  isUuid,
  type AcceptedCriterion,
  type AcceptedRequirement,
  type CommandName,
  type CommandRequest,
  type CriterionKind,
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

const MAX_GOAL_TEXT_LENGTH = 20_000;
const MAX_CRITERION_TEXT_LENGTH = 4_000;
const MAX_REQUIREMENTS = 32;
const MAX_CRITERIA = 64;

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

  if (command === 'task.accept_goal') {
    return validateGoalAdmission(input, limits);
  }
  return validateDevelopmentEcho(input, limits);
}

/**
 * Goal admission.
 *
 * This validates shape, bounds and identity — never meaning. The accepted goal
 * text and criteria are recorded exactly as the human accepted them; the
 * backend does not reinterpret prose into tests or invent a criterion.
 */
function validateGoalAdmission(
  input: Record<string, unknown>,
  limits: BackendLimits,
): ParseCommandResult {
  const unknownKey = findUnknownKey(input, [
    'projectId',
    'requestId',
    'fixtureId',
    'goalText',
    'requirements',
    'criteria',
  ]);
  if (unknownKey !== null) {
    return rejectInput(`Unknown input field "${unknownKey}".`, 'task.accept_goal accepts only projectId, requestId, fixtureId, goalText, requirements and criteria.');
  }

  const projectId = input['projectId'];
  if (!isUuid(projectId)) {
    return rejectInput('projectId must be a UUID.', 'Use the project id reported by GET /auth/session or by init.');
  }
  const requestId = input['requestId'];
  if (!isUuid(requestId)) {
    return rejectInput(
      'requestId must be a UUID.',
      'It is the durable idempotency key. Reuse the same value on retry; a new value starts a new admission.',
    );
  }
  const fixtureId = input['fixtureId'];
  if (typeof fixtureId !== 'string' || fixtureId.trim().length === 0 || fixtureId.length > 128) {
    return rejectInput('fixtureId must be a non-empty string of at most 128 characters.');
  }
  const goalText = input['goalText'];
  if (typeof goalText !== 'string' || goalText.trim().length === 0) {
    return rejectInput('goalText must be a non-empty string.');
  }
  if (goalText.length > MAX_GOAL_TEXT_LENGTH) {
    return rejectInput(
      `goalText exceeds the ${String(MAX_GOAL_TEXT_LENGTH)} character limit.`,
      'Summarise the accepted goal; the full source stays in the project message.',
    );
  }

  const requirements = input['requirements'];
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return rejectInput('requirements must be a non-empty array.');
  }
  if (requirements.length > MAX_REQUIREMENTS) {
    return rejectInput(`At most ${String(MAX_REQUIREMENTS)} requirements may be accepted at once.`);
  }
  const parsedRequirements: AcceptedRequirement[] = [];
  for (const entry of requirements) {
    if (!isPlainObject(entry)) {
      return rejectInput('Each requirement must be an object.');
    }
    const field = entry['field'];
    const type = entry['type'];
    const value = entry['value'];
    const minimum = entry['minimum'];
    const maximum = entry['maximum'];
    const revision = entry['revision'];
    if (typeof field !== 'string' || field.trim().length === 0 || field.length > 64) {
      return rejectInput('Each requirement needs a field name of at most 64 characters.');
    }
    if (type !== 'integer') {
      return rejectInput(`Requirement "${field}" must declare type "integer" at this milestone.`);
    }
    if (!isInteger(value) || !isInteger(minimum) || !isInteger(maximum)) {
      return rejectInput(`Requirement "${field}" needs integer value, minimum and maximum.`);
    }
    if (!isInteger(revision) || revision < 1) {
      return rejectInput(`Requirement "${field}" needs a positive integer revision.`);
    }
    if (value < minimum || value > maximum) {
      return rejectInput(
        `Requirement "${field}" value is outside its accepted range.`,
        'The backend does not widen an accepted range; ask the human to accept a different value.',
      );
    }
    parsedRequirements.push({ field, type: 'integer', value, minimum, maximum, revision });
  }

  const criteria = input['criteria'];
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return rejectInput('criteria must be a non-empty array.');
  }
  if (criteria.length > MAX_CRITERIA) {
    return rejectInput(`At most ${String(MAX_CRITERIA)} criteria may be accepted at once.`);
  }
  const parsedCriteria: AcceptedCriterion[] = [];
  for (const entry of criteria) {
    if (!isPlainObject(entry)) {
      return rejectInput('Each criterion must be an object.');
    }
    const kind = entry['kind'];
    const ref = entry['ref'];
    const text = entry['text'];
    const required = entry['required'];
    const expectedExitCode = entry['expectedExitCode'];
    if (typeof kind !== 'string' || !CRITERION_KINDS.includes(kind as CriterionKind)) {
      return rejectInput(`Criterion kind must be one of ${CRITERION_KINDS.join(', ')}.`);
    }
    if (typeof ref !== 'string' || ref.trim().length === 0 || ref.length > 128) {
      return rejectInput('Each criterion needs a ref of at most 128 characters.');
    }
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_CRITERION_TEXT_LENGTH) {
      return rejectInput(
        `Each criterion needs text of at most ${String(MAX_CRITERION_TEXT_LENGTH)} characters.`,
      );
    }
    if (typeof required !== 'boolean') {
      return rejectInput(`Criterion "${ref}" needs a boolean "required".`);
    }
    if (expectedExitCode !== null && !isInteger(expectedExitCode)) {
      return rejectInput(`Criterion "${ref}" expectedExitCode must be an integer or null.`);
    }
    parsedCriteria.push({
      kind: kind as CriterionKind,
      ref,
      text,
      required,
      expectedExitCode,
    });
  }

  if (new Set(parsedRequirements.map(r => r.field)).size !== parsedRequirements.length || new Set(parsedCriteria.map(c => c.ref)).size !== parsedCriteria.length) return rejectInput('Requirement fields and criterion references must be unique.');
  void limits;
  return {
    ok: true,
    parsed: {
      command: 'task.accept_goal',
      input: {
        projectId,
        requestId,
        fixtureId,
        goalText,
        requirements: parsedRequirements,
        criteria: parsedCriteria,
      },
    },
  };
}

function rejectInput(message: string, hint?: string): ParseCommandResult {
  return {
    ok: false,
    error: errorPayload('invalid_request', message, hint === undefined ? undefined : { hint }),
  };
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

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
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