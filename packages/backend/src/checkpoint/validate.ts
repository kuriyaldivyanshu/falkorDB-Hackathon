import {
  CHECKPOINT_SCHEMA_VERSION,
  EPISODE_SCHEMA_VERSION,
  MAX_AFFECTED_PATHS,
  MAX_COVERAGE_STREAMS,
  MAX_EPISODE_SOURCES,
  MAX_FAILURE_SIGNATURE_LENGTH,
  MAX_NEXT_ACTION_LENGTH,
  MAX_PLAN_STEPS,
  MAX_PROGRESS_LENGTH,
  MAX_STEP_TEXT_LENGTH,
  MAX_UNRESOLVED_EFFECTS,
  OBSERVED_OUTCOMES,
  PLAN_STEP_STATUSES,
  isAllowedStepTransition,
  isDecimalSequence,
  parseSequence,
  sequenceExceeds,
  type CauseStatus,
  type CheckpointManifest,
  type CoveredPosition,
  type DecimalSequence,
  type MemoryEpisode,
  type ObservedOutcome,
  type PlanStepStatus,
  type TacticalPlanStep,
} from '@threadline/shared';

/**
 * Runtime validation for the checkpoint manifest and memory episode.
 *
 * Two layers, deliberately separate.
 *
 * The **structural** layer enforces the two committed JSON schemas exactly: the
 * required keys, the `additionalProperties: false`, the consts, the enums, the
 * patterns, the lengths and the `maxItems`. It is written against those two
 * files rather than pulled from a schema engine, so it cannot drift from them by
 * accident, and so the backend gains no dependency for two fixed documents.
 *
 * The **semantic** layer covers what JSON Schema cannot express: unique coverage
 * entries per session, unique step ids, at most one in-progress step, allowed
 * transitions, a covered position never ahead of the admitted frontier, and the
 * four-stream bound.
 *
 * Sequences are compared with `BigInt` throughout. A position beyond
 * `Number.MAX_SAFE_INTEGER` is legal, and converting one to a JS number would
 * round it — which would let a checkpoint claim coverage it does not have.
 */

export interface ValidationFailure {
  readonly field: string;
  readonly reason: string;
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

function fail(failures: ValidationFailure[], field: string, reason: string): void {
  failures.push({ field, reason });
}

const HEX64 = /^[a-f0-9]{64}$/;
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Rejects any key the schema does not declare.
 *
 * `additionalProperties: false` is what stops a caller smuggling an
 * authority-bearing field past validation into a stored manifest.
 */
function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  failures: ValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(failures, `${prefix}${key}`, 'this property is not permitted by the schema');
    }
  }
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  prefix: string,
  failures: ValidationFailure[],
): void {
  for (const key of required) {
    if (!(key in value)) {
      fail(failures, `${prefix}${key}`, 'this property is required');
    }
  }
}

function nullableHex64(
  value: unknown,
  field: string,
  failures: ValidationFailure[],
): void {
  if (value === null) return;
  if (typeof value !== 'string' || !HEX64.test(value)) {
    fail(failures, field, 'expected null or 64 lowercase hexadecimal characters');
  }
}

function boundedString(
  value: unknown,
  field: string,
  max: number,
  failures: ValidationFailure[],
): void {
  if (typeof value !== 'string') {
    fail(failures, field, 'expected a string');
    return;
  }
  if ([...value].length > max) {
    fail(failures, field, `expected at most ${max} characters`);
  }
}

/* ------------------------------------------------------------------ */
/* Structural: checkpoint manifest                                     */
/* ------------------------------------------------------------------ */

const CHECKPOINT_REQUIRED = [
  'schema_version',
  'task_id',
  'run_id',
  'graph_epoch',
  'task_revision',
  'requirement_revision',
  'candidate_digest',
  'environment_digest',
  'covered_capture_positions',
  'progress',
  'next_action',
  'tactical_plan',
  'unresolved_effects',
  'pending_question_id',
  'episode_source_ids',
  'visibility',
  'producer_kind',
] as const;

const CHECKPOINT_ALLOWED = [...CHECKPOINT_REQUIRED] as readonly string[];

function validateCoverageStructurally(value: unknown, failures: ValidationFailure[]): CoveredPosition[] {
  if (!Array.isArray(value)) {
    fail(failures, 'covered_capture_positions', 'expected an array');
    return [];
  }
  if (value.length > MAX_COVERAGE_STREAMS) {
    fail(
      failures,
      'covered_capture_positions',
      `expected at most ${MAX_COVERAGE_STREAMS} session streams`,
    );
  }
  const out: CoveredPosition[] = [];
  value.forEach((entry, index) => {
    const field = `covered_capture_positions[${index}]`;
    if (!isPlainObject(entry)) {
      fail(failures, field, 'expected an object');
      return;
    }
    rejectUnknown(entry, ['session_id', 'capture_seq', 'graph_admitted_capture_seq'], `${field}.`, failures);
    requireKeys(entry, ['session_id', 'capture_seq', 'graph_admitted_capture_seq'], `${field}.`, failures);
    if (typeof entry['session_id'] !== 'string' || entry['session_id'].length === 0) {
      fail(failures, `${field}.session_id`, 'expected a non-empty string');
    }
    if (!isDecimalSequence(entry['capture_seq'])) {
      fail(failures, `${field}.capture_seq`, 'expected a decimal sequence string');
    }
    if (!isDecimalSequence(entry['graph_admitted_capture_seq'])) {
      fail(failures, `${field}.graph_admitted_capture_seq`, 'expected a decimal sequence string');
    }
    if (
      isDecimalSequence(entry['capture_seq']) &&
      isDecimalSequence(entry['graph_admitted_capture_seq']) &&
      sequenceExceeds(entry['graph_admitted_capture_seq'], entry['capture_seq'])
    ) {
      // Admission cannot be ahead of capture: nothing is admitted that was not
      // captured first.
      fail(
        failures,
        `${field}.graph_admitted_capture_seq`,
        'graph admission cannot be ahead of the captured position',
      );
    }
    out.push({
      session_id: String(entry['session_id']),
      capture_seq: String(entry['capture_seq']),
      graph_admitted_capture_seq: String(entry['graph_admitted_capture_seq']),
    });
  });
  return out;
}

function validatePlanStructurally(value: unknown, failures: ValidationFailure[]): TacticalPlanStep[] {
  if (!Array.isArray(value)) {
    fail(failures, 'tactical_plan', 'expected an array');
    return [];
  }
  if (value.length > MAX_PLAN_STEPS) {
    fail(failures, 'tactical_plan', `expected at most ${MAX_PLAN_STEPS} steps`);
  }
  const out: TacticalPlanStep[] = [];
  value.forEach((entry, index) => {
    const field = `tactical_plan[${index}]`;
    if (!isPlainObject(entry)) {
      fail(failures, field, 'expected an object');
      return;
    }
    rejectUnknown(entry, ['step_id', 'text', 'status'], `${field}.`, failures);
    requireKeys(entry, ['step_id', 'text', 'status'], `${field}.`, failures);
    if (typeof entry['step_id'] !== 'string' || entry['step_id'].length === 0) {
      fail(failures, `${field}.step_id`, 'expected a non-empty string');
    }
    boundedString(entry['text'], `${field}.text`, MAX_STEP_TEXT_LENGTH, failures);
    if (!PLAN_STEP_STATUSES.includes(entry['status'] as PlanStepStatus)) {
      fail(failures, `${field}.status`, `expected one of ${PLAN_STEP_STATUSES.join(', ')}`);
    }
    out.push({
      step_id: String(entry['step_id']),
      text: String(entry['text']),
      status: entry['status'] as PlanStepStatus,
    });
  });
  return out;
}

function validateEffectsStructurally(value: unknown, failures: ValidationFailure[]): CheckpointManifest['unresolved_effects'] {
  if (!Array.isArray(value)) {
    fail(failures, 'unresolved_effects', 'expected an array');
    return [];
  }
  if (value.length > MAX_UNRESOLVED_EFFECTS) {
    fail(failures, 'unresolved_effects', `expected at most ${MAX_UNRESOLVED_EFFECTS} entries`);
  }
  const out: { execution_id: string; status: 'running' | 'unknown'; source_id: string }[] = [];
  value.forEach((entry, index) => {
    const field = `unresolved_effects[${index}]`;
    if (!isPlainObject(entry)) {
      fail(failures, field, 'expected an object');
      return;
    }
    rejectUnknown(entry, ['execution_id', 'status', 'source_id'], `${field}.`, failures);
    requireKeys(entry, ['execution_id', 'status', 'source_id'], `${field}.`, failures);
    for (const key of ['execution_id', 'source_id']) {
      if (typeof entry[key] !== 'string' || (entry[key] as string).length === 0) {
        fail(failures, `${field}.${key}`, 'expected a non-empty string');
      }
    }
    if (entry['status'] !== 'running' && entry['status'] !== 'unknown') {
      fail(failures, `${field}.status`, "expected 'running' or 'unknown'");
    }
    out.push({
      execution_id: String(entry['execution_id']),
      status: entry['status'] as 'running' | 'unknown',
      source_id: String(entry['source_id']),
    });
  });
  return out;
}

export function validateCheckpointManifest(input: unknown): Validated<CheckpointManifest> {
  const failures: ValidationFailure[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, failures: [{ field: '', reason: 'expected an object' }] };
  }
  rejectUnknown(input, CHECKPOINT_ALLOWED, '', failures);
  requireKeys(input, CHECKPOINT_REQUIRED, '', failures);

  if (input['schema_version'] !== CHECKPOINT_SCHEMA_VERSION) {
    fail(failures, 'schema_version', `expected the constant ${CHECKPOINT_SCHEMA_VERSION}`);
  }
  for (const key of ['task_id', 'run_id', 'graph_epoch']) {
    if (typeof input[key] !== 'string' || (input[key] as string).length === 0) {
      fail(failures, key, 'expected a non-empty string');
    }
  }
  for (const key of ['task_revision', 'requirement_revision']) {
    if (!isDecimalSequence(input[key])) {
      fail(failures, key, 'expected a decimal sequence string');
    }
  }
  nullableHex64(input['candidate_digest'], 'candidate_digest', failures);
  nullableHex64(input['environment_digest'], 'environment_digest', failures);

  const covered = validateCoverageStructurally(input['covered_capture_positions'], failures);
  boundedString(input['progress'], 'progress', MAX_PROGRESS_LENGTH, failures);
  boundedString(input['next_action'], 'next_action', MAX_NEXT_ACTION_LENGTH, failures);
  const plan = validatePlanStructurally(input['tactical_plan'], failures);
  const effects = validateEffectsStructurally(input['unresolved_effects'], failures);

  const pendingQuestionId = input['pending_question_id'];
  if (pendingQuestionId !== null && (typeof pendingQuestionId !== 'string' || pendingQuestionId.length === 0)) {
    fail(failures, 'pending_question_id', 'expected a non-empty string or null');
  }

  if (!Array.isArray(input['episode_source_ids'])) {
    fail(failures, 'episode_source_ids', 'expected an array');
  } else {
    if (input['episode_source_ids'].length > MAX_EPISODE_SOURCES) {
      fail(failures, 'episode_source_ids', `expected at most ${MAX_EPISODE_SOURCES} entries`);
    }
    input['episode_source_ids'].forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        fail(failures, `episode_source_ids[${index}]`, 'expected a non-empty string');
      }
    });
  }

  if (!['project', 'user', 'session'].includes(String(input['visibility']))) {
    fail(failures, 'visibility', "expected 'project', 'user' or 'session'");
  }
  if (!['service', 'agent_proposal'].includes(String(input['producer_kind']))) {
    fail(failures, 'producer_kind', "expected 'service' or 'agent_proposal'");
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const manifest = {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    task_id: String(input['task_id']),
    run_id: String(input['run_id']),
    graph_epoch: String(input['graph_epoch']),
    task_revision: String(input['task_revision']),
    requirement_revision: String(input['requirement_revision']),
    candidate_digest: (input['candidate_digest'] ?? null) as string | null,
    environment_digest: (input['environment_digest'] ?? null) as string | null,
    covered_capture_positions: covered,
    progress: String(input['progress']),
    next_action: String(input['next_action']),
    tactical_plan: plan,
    unresolved_effects: effects,
    pending_question_id: (pendingQuestionId ?? null) as string | null,
    episode_source_ids: (input['episode_source_ids'] as string[]).slice(),
    visibility: input['visibility'] as CheckpointManifest['visibility'],
    producer_kind: input['producer_kind'] as CheckpointManifest['producer_kind'],
  } satisfies CheckpointManifest;

  return { ok: true, value: manifest };
}

/* ------------------------------------------------------------------ */
/* Semantic invariants                                                 */
/* ------------------------------------------------------------------ */

export interface FrontierInput {
  /** The highest captured position actually durable for that session. */
  readonly capturedThrough: DecimalSequence;
  /** The highest position whose graph admission has been reconciled. */
  readonly admittedThrough: DecimalSequence;
}

export interface SemanticOptions {
  /** Per-session frontier, supplied by the caller from real stored state. */
  readonly frontiers?: Readonly<Record<string, FrontierInput>>;
  /** The plan as it stands before the patch, for transition checking. */
  readonly previousPlan?: readonly TacticalPlanStep[];
}

/**
 * Applies the invariants JSON Schema cannot state.
 *
 * Each one exists because the corresponding mistake is otherwise invisible: a
 * duplicate coverage row looks like extra progress, a repeated `in_progress`
 * hides which step is real, and a forward step transition silently rewrites
 * recorded work.
 */
export function validateCheckpointSemantics(
  manifest: CheckpointManifest,
  options: SemanticOptions = {},
): Validated<CheckpointManifest> {
  const failures: ValidationFailure[] = [];

  // Coverage entries are unique per session. Two rows for one session would make
  // "the covered position" ambiguous.
  const seenSessions = new Set<string>();
  for (const entry of manifest.covered_capture_positions) {
    if (seenSessions.has(entry.session_id)) {
      fail(
        failures,
        'covered_capture_positions',
        `session ${entry.session_id} appears more than once`,
      );
    }
    seenSessions.add(entry.session_id);
  }
  if (manifest.covered_capture_positions.length > MAX_COVERAGE_STREAMS) {
    fail(
      failures,
      'covered_capture_positions',
      `expected at most ${MAX_COVERAGE_STREAMS} distinct session streams`,
    );
  }

  // Coverage may never claim more than has actually been captured and admitted.
  for (const entry of manifest.covered_capture_positions) {
    const frontier = options.frontiers?.[entry.session_id];
    if (frontier === undefined) {
      continue;
    }
    // BigInt comparison throughout: a position beyond 2^53 must not round.
    if (parseSequence(entry.capture_seq) > parseSequence(frontier.capturedThrough)) {
      fail(
        failures,
        `covered_capture_positions.${entry.session_id}.capture_seq`,
        `claims ${entry.capture_seq} but only ${frontier.capturedThrough} is captured`,
      );
    }
    if (parseSequence(entry.graph_admitted_capture_seq) > parseSequence(frontier.admittedThrough)) {
      fail(
        failures,
        `covered_capture_positions.${entry.session_id}.graph_admitted_capture_seq`,
        `claims ${entry.graph_admitted_capture_seq} but only ${frontier.admittedThrough} is admitted`,
      );
    }
  }

  // Plan step ids are stable and unique; at most one step is in progress.
  const seenSteps = new Set<string>();
  for (const step of manifest.tactical_plan) {
    if (seenSteps.has(step.step_id)) {
      fail(failures, 'tactical_plan', `step ${step.step_id} appears more than once`);
    }
    seenSteps.add(step.step_id);
  }
  const inProgress = manifest.tactical_plan.filter((step) => step.status === 'in_progress');
  if (inProgress.length > 1) {
    fail(
      failures,
      'tactical_plan',
      `at most one step may be in progress, found ${inProgress.length}`,
    );
  }

  // Transitions are checked against the previous plan, so a patch cannot move a
  // completed step backwards.
  if (options.previousPlan !== undefined) {
    const previous = new Map(options.previousPlan.map((step) => [step.step_id, step.status]));
    for (const step of manifest.tactical_plan) {
      const before = previous.get(step.step_id);
      if (before !== undefined && !isAllowedStepTransition(before, step.status)) {
        fail(
          failures,
          `tactical_plan.${step.step_id}`,
          `cannot move from ${before} to ${step.status}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true, value: manifest };
}

/* ------------------------------------------------------------------ */
/* Structural: memory episode                                          */
/* ------------------------------------------------------------------ */

const EPISODE_REQUIRED = [
  'schema_version',
  'task_id',
  'session_id',
  'source_id',
  'capture_seq',
  'tool_name',
  'command_id',
  'observed_outcome',
  'exit_code',
  'failure_signature',
  'affected_paths',
  'candidate_digest',
  'environment_digest',
  'requirement_revision',
  'cause_status',
  'next_action',
] as const;

const EPISODE_ALLOWED = [...EPISODE_REQUIRED] as readonly string[];
const CAUSE_STATUSES: readonly CauseStatus[] = ['not-inferred', 'hypothesis', 'reproduced'];

export function validateMemoryEpisode(input: unknown): Validated<MemoryEpisode> {
  const failures: ValidationFailure[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, failures: [{ field: '', reason: 'expected an object' }] };
  }
  rejectUnknown(input, EPISODE_ALLOWED, '', failures);
  requireKeys(input, EPISODE_REQUIRED, '', failures);

  if (input['schema_version'] !== EPISODE_SCHEMA_VERSION) {
    fail(failures, 'schema_version', `expected the constant ${EPISODE_SCHEMA_VERSION}`);
  }
  for (const key of ['task_id', 'session_id', 'source_id', 'tool_name']) {
    if (typeof input[key] !== 'string' || (input[key] as string).length === 0) {
      fail(failures, key, 'expected a non-empty string');
    }
  }
  if (!isDecimalSequence(input['capture_seq'])) {
    fail(failures, 'capture_seq', 'expected a decimal sequence string');
  }
  if (!isDecimalSequence(input['requirement_revision'])) {
    fail(failures, 'requirement_revision', 'expected a decimal sequence string');
  }

  const commandId = input['command_id'];
  if (commandId !== null && (typeof commandId !== 'string' || commandId.length === 0)) {
    fail(failures, 'command_id', 'expected a non-empty string or null');
  }

  if (!OBSERVED_OUTCOMES.includes(input['observed_outcome'] as ObservedOutcome)) {
    fail(failures, 'observed_outcome', `expected one of ${OBSERVED_OUTCOMES.join(', ')}`);
  }

  const exitCode = input['exit_code'];
  if (exitCode !== null && (typeof exitCode !== 'number' || !Number.isInteger(exitCode))) {
    fail(failures, 'exit_code', 'expected an integer or null');
  }

  const signature = input['failure_signature'];
  if (signature !== null) {
    boundedString(signature, 'failure_signature', MAX_FAILURE_SIGNATURE_LENGTH, failures);
  }

  if (!Array.isArray(input['affected_paths'])) {
    fail(failures, 'affected_paths', 'expected an array');
  } else {
    if (input['affected_paths'].length > MAX_AFFECTED_PATHS) {
      fail(failures, 'affected_paths', `expected at most ${MAX_AFFECTED_PATHS} entries`);
    }
    input['affected_paths'].forEach((entry, index) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        fail(failures, `affected_paths[${index}]`, 'expected a non-empty string');
      }
    });
  }

  nullableHex64(input['candidate_digest'], 'candidate_digest', failures);
  nullableHex64(input['environment_digest'], 'environment_digest', failures);

  if (!CAUSE_STATUSES.includes(input['cause_status'] as CauseStatus)) {
    fail(failures, 'cause_status', `expected one of ${CAUSE_STATUSES.join(', ')}`);
  }
  boundedString(input['next_action'], 'next_action', MAX_NEXT_ACTION_LENGTH, failures);

  // A recorded nonzero exit is an observation, never a cause. Claiming
  // `reproduced` without one would be a fabricated causal claim.
  if (input['cause_status'] === 'reproduced' && typeof exitCode !== 'number') {
    fail(
      failures,
      'cause_status',
      'a reproduced cause requires an observed exit code',
    );
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    value: {
      schema_version: EPISODE_SCHEMA_VERSION,
      task_id: String(input['task_id']),
      session_id: String(input['session_id']),
      source_id: String(input['source_id']),
      capture_seq: String(input['capture_seq']),
      tool_name: String(input['tool_name']),
      command_id: (commandId ?? null) as string | null,
      observed_outcome: input['observed_outcome'] as ObservedOutcome,
      exit_code: (exitCode ?? null) as number | null,
      failure_signature: (signature ?? null) as string | null,
      affected_paths: ((input['affected_paths'] as string[]) ?? []).slice(),
      candidate_digest: (input['candidate_digest'] ?? null) as string | null,
      environment_digest: (input['environment_digest'] ?? null) as string | null,
      requirement_revision: String(input['requirement_revision']),
      cause_status: input['cause_status'] as CauseStatus,
      next_action: String(input['next_action']),
    } satisfies MemoryEpisode,
  };
}

/** Convenience: structure then semantics. */
export function validateCheckpoint(
  input: unknown,
  options?: SemanticOptions,
): Validated<CheckpointManifest> {
  const structural = validateCheckpointManifest(input);
  if (!structural.ok) {
    return structural;
  }
  return validateCheckpointSemantics(structural.value, options);
}