import {
  MAX_NEXT_ACTION_LENGTH,
  MAX_PLAN_STEPS,
  MAX_PROGRESS_LENGTH,
  MAX_STEP_TEXT_LENGTH,
  PLAN_STEP_STATUSES,
  ThreadlineError,
  isDecimalSequence,
  type CheckpointFreshness,
  type CheckpointRejection,
  type CheckpointResult,
  type CheckpointScope,
  type CheckpointService,
  type CheckpointSubmission,
  type PlanPatch,
  type PlanStepStatus,
  type PublicationState,
  type TacticalPlanStep,
  type TacticalStateView,
} from '@threadline/shared';

/**
 * M04 tactical tools: `memory.checkpoint`, `task.update_plan`, `memory.refresh`.
 *
 * This module owns only the **tool boundary** — what a model may propose, what
 * is refused before the service is reached, and how an outcome is rendered back
 * to the model. It holds no checkpoint state, no revision arithmetic and no
 * authority decision. The authoritative checkpoint manifest, its merge rules and
 * its concurrency are Agent A's, reached through the narrow port below.
 *
 * Three rules are enforced here rather than left to the service, because a
 * refusal at the boundary is cheaper and clearer than a rejection after a write:
 *
 * 1. **Server-owned fields cannot be supplied.** Authority, coverage, candidate
 *    and environment binding, and Source identities are resolved by the server.
 *    A model that sends one is refused by name; the field is never silently
 *    dropped, because a silently ignored override reads as a successful write.
 * 2. **Shape is bounded at the tool.** The limits come from
 *    `memory-checkpoint.schema.json`: progress 2 000 characters, next action
 *    1 000, at most eight plan steps, step text at most 300. Out-of-shape input
 *    is refused before any service call.
 * 3. **An outcome is reported as the backend stated it.** Accepted, replayed,
 *    pending, conflict and blocked are five different answers and none of them
 *    is collapsed into "done".
 *
 * Nothing here completes a task, verifies one, or grants protected completion.
 * An all-completed plan is a statement about the model's own checklist, never
 * about the task.
 */

/* ------------------------------------------------------------------ */
/* Schema limits                                                       */
/* ------------------------------------------------------------------ */

/**
 * The authored limits, taken from Agent A's published contract rather than
 * restated here, so the schema, the tool boundary and the backend cannot drift.
 * They correspond to `memory-checkpoint.schema.json`.
 */
export const CHECKPOINT_LIMITS = Object.freeze({
  progressChars: MAX_PROGRESS_LENGTH,
  nextActionChars: MAX_NEXT_ACTION_LENGTH,
  planSteps: MAX_PLAN_STEPS,
  stepTextChars: MAX_STEP_TEXT_LENGTH,
});

export const PLAN_STATUSES = PLAN_STEP_STATUSES;

/**
 * Fields the server resolves. A model-supplied value is refused, not ignored.
 *
 * These are named rather than enumerated exhaustively, because the set of
 * server-owned fields is A's to define; what matters at this boundary is that
 * anything on this list is refused rather than quietly accepted.
 */
export const SERVER_OWNED_FIELDS = Object.freeze([
  'schema_version',
  'task_id',
  'run_id',
  'graph_epoch',
  'task_revision',
  'requirement_revision',
  'candidate_digest',
  'environment_digest',
  'covered_capture_positions',
  'unresolved_effects',
  'pending_question_id',
  'episode_source_ids',
  'visibility',
  'producer_kind',
  // `expectedRevision` is deliberately absent: it is the caller's own stale
  // detection token, not a value the server owns. Refusing it would make a
  // stale-safe patch impossible, and accepting an *actual* revision is what
  // would be an override.
  'coverage',
  'authority',
  'sourceId',
  'sourceIds',
  'requestId',
  // `operationId` is minted by the composed adapter, so a model supplying one
  // would be claiming an identity it was never given.
  'operationId',
] as const);

export class TacticalToolError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'server_owned_field'
      | 'limit_exceeded'
      | 'unsupported_mode'
      | 'unavailable',
    message: string,
    /** Names the offending field when the refusal is about one. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'TacticalToolError';
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function boundedText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new TacticalToolError('invalid_input', `${field} must be a string.`, field);
  // Characters, not bytes: the schema states maxLength, and a model writing
  // non-ASCII progress is not malformed.
  if ([...value].length > maximum) {
    throw new TacticalToolError('limit_exceeded', `${field} exceeds ${maximum} characters.`, field);
  }
  return value;
}

/**
 * Validates a plan: bounded length, bounded step text, known statuses and at
 * most one step in progress.
 */
export function validatePlan(value: unknown, field = 'plan'): readonly TacticalPlanStep[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TacticalToolError('invalid_input', `${field} must be an array.`, field);
  if (value.length > CHECKPOINT_LIMITS.planSteps) {
    throw new TacticalToolError('limit_exceeded', `${field} accepts at most ${CHECKPOINT_LIMITS.planSteps} steps.`, field);
  }
  const seen = new Set<string>();
  let inProgress = 0;
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TacticalToolError('invalid_input', `${field}[${index}] must be an object.`, field);
    }
    const step = entry as Record<string, unknown>;
    for (const key of Object.keys(step)) {
      if (!['stepId', 'text', 'status'].includes(key)) {
        throw new TacticalToolError('invalid_input', `${field}[${index}] has an unknown field "${key}".`, key);
      }
      if ((SERVER_OWNED_FIELDS as readonly string[]).includes(key)) {
        throw new TacticalToolError('server_owned_field', `${field}[${index}].${key} is resolved by the server.`, key);
      }
    }
    const stepId = step['stepId'];
    if (typeof stepId !== 'string' || stepId.length === 0 || stepId.length > 128) {
      throw new TacticalToolError('invalid_input', `${field}[${index}].stepId is required.`, 'stepId');
    }
    if (seen.has(stepId)) throw new TacticalToolError('invalid_input', `${field} repeats step id "${stepId}".`, 'stepId');
    seen.add(stepId);
    const text = boundedText(step['text'], `${field}[${index}].text`, CHECKPOINT_LIMITS.stepTextChars);
    if (text === undefined) throw new TacticalToolError('invalid_input', `${field}[${index}].text is required.`, 'text');
    const status = step['status'];
    if (typeof status !== 'string' || !(PLAN_STEP_STATUSES as readonly string[]).includes(status)) {
      throw new TacticalToolError('invalid_input', `${field}[${index}].status must be one of ${PLAN_STEP_STATUSES.join(', ')}.`, 'status');
    }
    if (status === 'in_progress') inProgress += 1;
    // A's wire shape: `step_id`, not `stepId`.
    return { step_id: stepId, text, status: status as PlanStepStatus } satisfies TacticalPlanStep;
  }).map((step) => {
    if (inProgress > 1) {
      throw new TacticalToolError('invalid_input', `${field} allows at most one in-progress step.`, 'status');
    }
    return step;
  });
}

/**
 * Rejects a server-owned field by name.
 *
 * Refusing rather than dropping is the whole point: a model that believes it set
 * coverage or a Source must learn that it did not.
 */
export function refuseServerOwnedFields(input: Record<string, unknown>, extra: readonly string[] = []): void {
  for (const key of Object.keys(input)) {
    if ((SERVER_OWNED_FIELDS as readonly string[]).includes(key) || extra.includes(key)) {
      throw new TacticalToolError(
        'server_owned_field',
        `"${key}" is resolved by the server and cannot be set from a tool call.`,
        key,
      );
    }
  }
}

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TacticalToolError('invalid_input', 'Arguments must be an object.');
  }
  return input as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Bounded proposal shapes                                             */
/* ------------------------------------------------------------------ */

export interface CheckpointProposal {
  readonly progress?: string;
  readonly nextAction?: string;
  readonly plan?: readonly TacticalPlanStep[];
  /** The revision the caller believes is current, for a stale-safe write. */
  readonly baseRevision?: string;
}

export interface PlanProposal {
  readonly steps: readonly PlanPatch[];
  readonly baseRevision?: string;
}

export function parseCheckpointProposal(input: unknown): CheckpointProposal {
  const raw = requireObject(input);
  refuseServerOwnedFields(raw);
  for (const key of Object.keys(raw)) {
    if (!['progress', 'nextAction', 'plan', 'baseRevision'].includes(key)) {
      throw new TacticalToolError('invalid_input', `Unknown field "${key}".`, key);
    }
  }
  const progress = boundedText(raw['progress'], 'progress', CHECKPOINT_LIMITS.progressChars);
  const nextAction = boundedText(raw['nextAction'], 'nextAction', CHECKPOINT_LIMITS.nextActionChars);
  const plan = validatePlan(raw['plan']);
  const baseRevision = readBaseRevision(raw['baseRevision']);
  if (progress === undefined && nextAction === undefined && plan.length === 0) {
    throw new TacticalToolError('invalid_input', 'A checkpoint must propose progress, a next action, or a plan.');
  }
  return { progress, nextAction, plan, baseRevision };
}

/**
 * Parses a plan patch.
 *
 * A patch is per-step and additive: unrelated steps are preserved by the
 * backend's merge. A model therefore cannot replace the whole checklist by
 * omission, and a patch for an unrelated step id cannot silently drop it.
 */
export function parsePlanProposal(input: unknown): PlanProposal {
  const raw = requireObject(input);
  refuseServerOwnedFields(raw);
  for (const key of Object.keys(raw)) {
    if (!['steps', 'baseRevision'].includes(key)) {
      throw new TacticalToolError('invalid_input', `Unknown field "${key}".`, key);
    }
  }
  const steps = parsePlanPatch(raw['steps']);
  if (steps.length === 0) throw new TacticalToolError('invalid_input', 'A plan update must patch at least one step.', 'steps');
  return { steps, baseRevision: readBaseRevision(raw['baseRevision']) };
}

function readBaseRevision(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  // A decimal string: revisions are `bigint` in SQL and must not round.
  if (!isDecimalSequence(value)) {
    throw new TacticalToolError('invalid_input', 'baseRevision must be a decimal string.', 'baseRevision');
  }
  return value;
}

/** Validates a bounded per-step patch. Only `stepId` is required. */
function parsePlanPatch(value: unknown): readonly PlanPatch[] {
  if (!Array.isArray(value)) throw new TacticalToolError('invalid_input', 'steps must be an array.', 'steps');
  if (value.length > CHECKPOINT_LIMITS.planSteps) {
    throw new TacticalToolError('limit_exceeded', `steps accepts at most ${CHECKPOINT_LIMITS.planSteps} entries.`, 'steps');
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TacticalToolError('invalid_input', `steps[${index}] must be an object.`, 'steps');
    }
    const step = entry as Record<string, unknown>;
    for (const key of Object.keys(step)) {
      if (!['stepId', 'text', 'status'].includes(key)) {
        throw new TacticalToolError('invalid_input', `steps[${index}] has an unknown field "${key}".`, key);
      }
    }
    const stepId = step['stepId'];
    if (typeof stepId !== 'string' || stepId.length === 0 || stepId.length > 128) {
      throw new TacticalToolError('invalid_input', `steps[${index}].stepId is required.`, 'stepId');
    }
    if (seen.has(stepId)) throw new TacticalToolError('invalid_input', `steps repeats step id "${stepId}".`, 'stepId');
    seen.add(stepId);
    const text = boundedText(step['text'], `steps[${index}].text`, CHECKPOINT_LIMITS.stepTextChars);
    const status = step['status'];
    if (status !== undefined && status !== null
      && (typeof status !== 'string' || !(PLAN_STEP_STATUSES as readonly string[]).includes(status))) {
      throw new TacticalToolError('invalid_input', `steps[${index}].status must be one of ${PLAN_STEP_STATUSES.join(', ')}.`, 'status');
    }
    return { step_id: stepId, ...(text === undefined ? {} : { text }), ...(status === undefined || status === null ? {} : { status: status as PlanStepStatus }) };
  });
}

/* ------------------------------------------------------------------ */
/* Ports                                                               */
/* ------------------------------------------------------------------ */

/**
 * How a submission ended, as this module presents it.
 *
 * A's `PublicationState` and `CheckpointRejection` are authoritative; this is
 * the model-facing summary, and it deliberately keeps `rejected` separate from
 * `pending` and `ambiguous`.
 */
export type OutcomeKind = 'committed' | 'pending' | 'ambiguous' | 'rejected';

/** Which rejection the model is told about, without leaking store detail. */
export type RejectionKind =
  | 'stale_revision'
  | 'payload_conflict'
  | 'invalid'
  | 'sources_unavailable'
  | 'coverage_beyond_frontier'
  | 'stream_limit'
  | 'blocked_by_gap'
  | 'awaiting_run_binding'
  | 'unauthorized';

const REJECTION_KINDS: readonly RejectionKind[] = [
  'stale_revision', 'payload_conflict', 'invalid', 'sources_unavailable',
  'coverage_beyond_frontier', 'stream_limit', 'blocked_by_gap',
  'awaiting_run_binding', 'unauthorized',
];

export function rejectionKindOf(rejection: CheckpointRejection): RejectionKind {
  return REJECTION_KINDS.includes(rejection.kind as RejectionKind) ? rejection.kind as RejectionKind : 'invalid';
}

export interface TacticalInvocations {
  readonly checkpoint: number;
  readonly updatePlan: number;
  readonly refresh: number;
}

/**
 * The scope every call is fenced by.
 *
 * Resolved from the authenticated session by Agent A's composition; this module
 * only carries it. A model never supplies any part of it.
 */
export interface TacticalTools {
  /**
   * `operationId` must be the **durable tool execution identity** the guard
   * allocated for this logical invocation, never a fresh id per attempt.
   *
   * That anchor is what makes a retry safe: resubmitting the same intent reuses
   * the same identity, so the backend replays the original outcome instead of
   * minting a second write, while a genuinely different invocation gets a
   * different identity and cannot be silently merged with the first. A random id
   * generated per attempt would defeat both properties.
   */
  invoke(name: TacticalToolName, input: unknown, operationId: string): Promise<unknown>;
  readonly calls: TacticalInvocations;
  /** The scope the adapter was composed with, for diagnostics. */
  readonly scope: CheckpointScope;
}

/**
 * Builds the invocation adapter over Agent A's `CheckpointService`.
 *
 * `operationId` must be stable for a retried logical update: A treats the same
 * id with the same payload as a replay and a changed payload as a conflict.
 */
export function createTacticalTools(options: {
  service: CheckpointService;
  scope: CheckpointScope;
}): TacticalTools {
  const calls = { checkpoint: 0, updatePlan: 0, refresh: 0 } as { checkpoint: number; updatePlan: number; refresh: number };

  const submission = (proposal: Omit<CheckpointSubmission, 'operationId'>, operationId: string): CheckpointSubmission => ({
    ...proposal,
    operationId,
  });

  /** Renders an authoritative result without upgrading its durability. */
  const render = (result: CheckpointResult): Record<string, unknown> => {
    const base: Record<string, unknown> = { operationId: result.operationId, outcome: result.state satisfies PublicationState };
    if (result.rejection !== undefined) {
      return {
        ...base,
        outcome: 'rejected' satisfies OutcomeKind,
        rejection: rejectionKindOf(result.rejection),
        detail: result.rejection,
        // A rejection names the revision to reconcile against, when it has one.
        currentRevision: result.rejection.kind === 'stale_revision' ? result.rejection.currentRevision : null,
        // The previous valid checkpoint is retained, so a refused write leaves
        // the task with the state it already had.
        previousRevision: result.previous?.checkpointRevision ?? null,
      };
    }
    return {
      ...base,
      revision: result.revision ?? null,
      // An accepted update always exposes its durable Source, or says the
      // pointer or graph admission is still outstanding.
      checkpointSourceId: result.checkpointSourceId ?? null,
      manifestArtifactId: result.manifestArtifactId ?? null,
      sourcePublished: result.state === 'committed' && typeof result.checkpointSourceId === 'string',
      previousRevision: result.previous?.checkpointRevision ?? null,
      // Stated on every accepted path so acceptance is never read as completion.
      taskCompleted: false,
      taskVerified: false,
    };
  };

  return {
    calls,
    scope: options.scope,
    async invoke(name: TacticalToolName, input: unknown, operationId: string) {
    if (typeof operationId !== 'string' || operationId.length === 0) {
      // A submission without a durable identity could be minted twice.
      throw new TacticalToolError('invalid_input', 'A durable operation identity is required.');
    }
      if (name === 'memory.refresh') {
        if(Object.keys(requireObject(input)).length)throw new TacticalToolError('invalid_input','memory.refresh accepts no arguments.');
        calls.refresh += 1;
        const view: TacticalStateView = await options.service.inspect(options.scope);
        return renderState(view);
      }
      if (name === 'memory.checkpoint') {
        calls.checkpoint += 1;
        const proposal = parseCheckpointProposal(input);
        // Proposed narrative state and plan patches travel separately: the
        // backend merges the patch and never replaces unrelated steps.
        const proposed = {
          ...(proposal.progress === undefined ? {} : { progress: proposal.progress }),
          ...(proposal.nextAction === undefined ? {} : { next_action: proposal.nextAction }),
        };
        const planPatch = (proposal.plan ?? []).map(toPatch);
        return render(await options.service.submit(options.scope, submission({
          ...(Object.keys(proposed).length > 0 ? { proposed } : {}),
          ...(planPatch.length > 0 ? { planPatch } : {}),
          ...(proposal.baseRevision === undefined ? {} : { baseRevision: proposal.baseRevision }),
        }, operationId)));
      }
      if (name === 'task.update_plan') {
        calls.updatePlan += 1;
        const proposal = parsePlanProposal(input);
        return render(await options.service.submit(options.scope, submission({
          planPatch: proposal.steps,
          ...(proposal.baseRevision === undefined ? {} : { baseRevision: proposal.baseRevision }),
        }, operationId)));
      }
      throw new ThreadlineError('invalid_request', 'That tactical tool is not recognised.');
    },
  };
}

const toPatch = (step: TacticalPlanStep): PlanPatch => ({ step_id: step.step_id, text: step.text, status: step.status });

/**
 * Renders the current structured state.
 *
 * `memory.refresh` is scoped to M04's structured state: it reports freshness,
 * the pointer, pending coverage and blocking gaps. It does not search the graph,
 * select relevance, or build a context packet, and it does not claim the model's
 * loaded context was updated.
 */
function renderState(view: TacticalStateView): Record<string, unknown> {
  return {
    freshness: view.freshness satisfies CheckpointFreshness,
    checkpointRevision: view.pointer?.checkpointRevision ?? null,
    sourceId: view.pointer?.checkpointSourceId ?? null,
    awaitingRunBinding: view.awaitingRunBinding,
    criticalCapturePending:view.criticalCapturePending??false,
    unavailableSourceIds:view.unavailableSourceIds??[],
    pendingReplacement:view.pendingReplacement??null,
    pendingCoverage: view.pendingCoverage.map((entry) => ({ sessionId: entry.session_id, captureSeq: entry.capture_seq })),
    blockingGap: view.blockingGap === null || view.blockingGap === undefined
      ? null
      : { sessionId: view.blockingGap.sessionId, fromSeq: view.blockingGap.fromSeq, toSeq: view.blockingGap.toSeq },
    episodes: view.episodes.length,
    // A refresh reports state; it never asserts the model reloaded anything.
    loadedContextAcknowledged: false,
  };
}

/* ------------------------------------------------------------------ */
/* Provider wire schema                                                */
/* ------------------------------------------------------------------ */

const schema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const stepProperties = {
  stepId: { type: 'string', minLength: 1, maxLength: 128 },
  text: { type: 'string', minLength: 1, maxLength: CHECKPOINT_LIMITS.stepTextChars },
  status: { type: 'string', enum: [...PLAN_STEP_STATUSES] },
} as const;

const planSchema = {
  type: 'array',
  minItems: 0,
  maxItems: CHECKPOINT_LIMITS.planSteps,
  items: { type: 'object', properties: stepProperties, required: ['stepId', 'text', 'status'], additionalProperties: false },
} as const;

const patchSchema = {
  type: 'array',
  minItems: 1,
  maxItems: CHECKPOINT_LIMITS.planSteps,
  // Only `stepId` is required: a patch may move status or rewrite text alone.
  items: { type: 'object', properties: {stepId:stepProperties.stepId,
    text:{...stepProperties.text,type:['string','null']},
    status:{type:['string','null'],enum:[...PLAN_STEP_STATUSES,null]}},
    required: ['stepId','text','status'], additionalProperties: false },
} as const;

const baseRevisionSchema = { type: ['string', 'null'], pattern: '^[0-9]+$', maxLength: 24 } as const;

/**
 * The three M04 tools, advertised alongside the four M03 tools for a total of
 * seven. No server-owned field appears in any schema, so a model is never
 * invited to send one.
 */
export const TACTICAL_FUNCTIONS = [
  { type: 'function', name: 'memory_checkpoint', description: 'Record bounded progress, the next action and a tactical plan. Authority, coverage, candidate binding and Source identities are resolved by the server and cannot be set here. Does not complete or verify the task.', strict: true,
    parameters: schema({
      progress: { type: ['string','null'], maxLength: CHECKPOINT_LIMITS.progressChars },
      nextAction: { type: ['string','null'], maxLength: CHECKPOINT_LIMITS.nextActionChars },
      plan: planSchema,
      baseRevision: baseRevisionSchema,
    }) },
  { type: 'function', name: 'task_update_plan', description: 'Patch bounded plan steps by stable id; unrelated steps are preserved. Completing every step does not complete or verify the task.', strict: true,
    parameters: schema({ steps: patchSchema, baseRevision: baseRevisionSchema }) },
  { type: 'function', name: 'memory_refresh', description: 'Stage the current bounded authority and sourced memory packet. It replaces the memory block before the next dependent turn; staging does not acknowledge provider delivery.', strict: true,
    parameters: schema({}) },
] as const;

export const TACTICAL_TOOL_NAMES = Object.freeze([
  'memory.checkpoint',
  'task.update_plan',
  'memory.refresh',
] as const);

export type TacticalToolName = (typeof TACTICAL_TOOL_NAMES)[number];

const tacticalNames: Readonly<Record<string, TacticalToolName>> = Object.freeze({
  memory_checkpoint: 'memory.checkpoint',
  task_update_plan: 'task.update_plan',
  memory_refresh: 'memory.refresh',
});

export function resolveTacticalTool(name: string): TacticalToolName | null {
  return Object.hasOwn(tacticalNames, name) ? tacticalNames[name] ?? null : null;
}
