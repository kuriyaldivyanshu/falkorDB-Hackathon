import { z } from 'zod';

import { operationStateSchema } from './operations.js';
import { byteBoundedText, uuidSchema, utf8ByteLength } from './validation.js';

/**
 * Accepted memory contracts.
 *
 * A `Memory` is a stable logical identity; its authority is the accepted
 * `MemoryVersion` its single `CURRENT` edge names. Versions are immutable:
 * corrections add a version and supersede an older one rather than rewriting
 * an observation.
 *
 * Four kinds are versioned the same way but validated differently:
 *
 * - **semantic** — requirements, decisions and scoped facts. An agent finding
 *   is a proposal; obligations and decisions require explicit human acceptance.
 * - **episodic** — an attempted action and its observed outcome. A captured
 *   supported outcome may be admitted deterministically as a proposal-free
 *   observation, but a root cause is never inferred from an exit status.
 * - **procedural** — reusable steps with prerequisites and supporting outcomes.
 *   Validation needs declared review plus compatible observed reuse.
 * - **handoff** — an offer of current task state to another session. It does not
 *   transfer hidden native state and does not control a process.
 */

export const MEMORY_KINDS = ['semantic', 'episodic', 'procedural', 'handoff'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Version acceptance state. `proposed` candidates never govern. */
export const VERSION_ACCEPTANCE = ['proposed', 'accepted', 'superseded', 'retracted'] as const;
export type VersionAcceptance = (typeof VERSION_ACCEPTANCE)[number];

export const SEMANTIC_SUBTYPES = ['requirement', 'decision', 'fact'] as const;
export type SemanticSubtype = (typeof SEMANTIC_SUBTYPES)[number];

export const EPISODE_OUTCOMES = ['succeeded', 'failed', 'denied', 'interrupted', 'unknown'] as const;
export type EpisodeOutcome = (typeof EPISODE_OUTCOMES)[number];

export const PROCEDURE_STATES = ['candidate', 'trialled', 'validated', 'invalidated'] as const;
export type ProcedureState = (typeof PROCEDURE_STATES)[number];

export const HANDOFF_STATES = ['offered', 'accepted', 'revoked', 'expired', 'blocked'] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

/** Content bounds, in UTF-8 bytes, matching the storage contract. */
export const MEMORY_LIMITS = {
  maxVersionBytes: 16 * 1024,
  maxSemanticStatementBytes: 4 * 1024,
  maxEpisodeFieldBytes: 2 * 1024,
  maxProcedureStepBytes: 512,
  maxProcedureSteps: 8,
  maxHandoffBodyBytes: 8 * 1024,
  maxTaskTitleBytes: 256,
  maxRecallFocusBytes: 1024,
  maxApplicabilityPredicates: 16,
  maxApplicabilityValues: 16,
  maxSourceClosure: 64,
} as const;

/**
 * Allowlisted applicability predicate keys.
 *
 * Applicability is a versioned data structure, never executable code and never
 * model-authored Cypher. Unsupported or unknown predicates exclude optional
 * advice; they never silently match.
 */
export const APPLICABILITY_KEYS = [
  'task_family',
  'schema_version',
  'contract_version',
  'runtime',
  'tool',
  'path_scope',
  'parameter',
] as const;
export type ApplicabilityKey = (typeof APPLICABILITY_KEYS)[number];

export const APPLICABILITY_OPERATORS = ['equals', 'in', 'present'] as const;
export type ApplicabilityOperator = (typeof APPLICABILITY_OPERATORS)[number];

export const applicabilityPredicateSchema = z.object({
  key: z.enum(APPLICABILITY_KEYS),
  operator: z.enum(APPLICABILITY_OPERATORS),
  /** `equals`/`in` carry values; `present` asserts the key is known. */
  values: z.array(byteBoundedText(256)).max(MEMORY_LIMITS.maxApplicabilityValues),
});
export type ApplicabilityPredicate = z.infer<typeof applicabilityPredicateSchema>;

export const applicabilitySchema = z.object({
  predicates: z.array(applicabilityPredicateSchema).max(MEMORY_LIMITS.maxApplicabilityPredicates),
});
export type Applicability = z.infer<typeof applicabilitySchema>;

/**
 * The exact conditions an observation was made under.
 *
 * Deliberately separate from `applicability`: what was checked while observing
 * is historical fact, while applicability decides whether the lesson still
 * helps. Changing an unrelated requirement must not erase a still-applicable
 * lesson, and it must not silently re-label the old observation.
 */
export const observedUnderSchema = z.object({
  taskFamily: z.string().max(256).nullable(),
  contractVersion: z.string().max(128).nullable(),
  runtime: z.string().max(128).nullable(),
  tool: z.string().max(128).nullable(),
  paths: z.array(byteBoundedText(1024)).max(16),
  /** Semantic parameter values in force when the observation was made. */
  parameters: z.record(z.string().max(128), z.string().max(512)),
});
export type ObservedUnder = z.infer<typeof observedUnderSchema>;

export const semanticContentSchema = z.object({
  kind: z.literal('semantic'),
  subtype: z.enum(SEMANTIC_SUBTYPES),
  statement: byteBoundedText(MEMORY_LIMITS.maxSemanticStatementBytes),
});

export const episodicContentSchema = z.object({
  kind: z.literal('episodic'),
  action: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  outcome: z.enum(EPISODE_OUTCOMES),
  /** What was observed. Never a claimed root cause. */
  observation: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  uncertainty: byteBoundedText(512).nullable(),
});

const procedureStepSchema = z.object({
  index: z.number().int().min(0).max(MEMORY_LIMITS.maxProcedureSteps - 1),
  text: byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes),
});

export const proceduralContentSchema = z.object({
  kind: z.literal('procedural'),
  goal: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  steps: z.array(procedureStepSchema).min(1).max(MEMORY_LIMITS.maxProcedureSteps),
  /** Declared conditions that must hold before reuse. */
  prerequisites: z.array(byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes)).max(8),
  parameters: z.array(z.object({
    name: byteBoundedText(128),
    value: byteBoundedText(512),
  })).max(16),
  procedureState: z.enum(PROCEDURE_STATES),
  /** Review that allowed validation; required for `validated`. */
  reviewRef: z.string().max(256).nullable(),
});

export const handoffContentSchema = z.object({
  kind: z.literal('handoff'),
  objective: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  openWork: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  unresolved: z.array(byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes)).max(16),
  state: z.enum(HANDOFF_STATES),
  fromSessionId: uuidSchema.nullable(),
  toSessionId: uuidSchema.nullable(),
  taskRevision: z.string().max(128).nullable(),
});

export const memoryContentSchema = z.discriminatedUnion('kind', [
  semanticContentSchema,
  episodicContentSchema,
  proceduralContentSchema,
  handoffContentSchema,
]);
export type MemoryContent = z.infer<typeof memoryContentSchema>;

export const memoryVersionSchema = z.object({
  versionId: uuidSchema,
  memoryId: uuidSchema,
  kind: z.enum(MEMORY_KINDS),
  content: memoryContentSchema,
  acceptance: z.enum(VERSION_ACCEPTANCE),
  authorPrincipalId: uuidSchema,
  authorSessionId: uuidSchema.nullable(),
  /** Human principal that accepted this version, when acceptance was explicit. */
  acceptedByPrincipalId: uuidSchema.nullable(),
  createdAtMs: z.number().int().nonnegative(),
  observedAtMs: z.number().int().nonnegative(),
  /** Direct flattened source closure: at most 64 source revisions. */
  sourceIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
  sourceLinkIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  supersedesVersionId: uuidSchema.nullable(),
  contradictsVersionIds: z.array(uuidSchema).max(8),
  /** Delegation marker: `observed` episodes are deterministic, `authored` are proposals. */
  delegation: z.enum(['observed', 'authored']),
});
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;

export const memoryViewSchema = z.object({
  memoryId: uuidSchema,
  kind: z.enum(MEMORY_KINDS),
  /** The task whose requirements this read traversed; `null` for a project-wide read. */
  taskId: uuidSchema.nullable(),
  current: memoryVersionSchema.nullable(),
  candidates: z.array(memoryVersionSchema).max(8),
});
export type MemoryView = z.infer<typeof memoryViewSchema>;

/**
 * A proposal from a producer (model or human) for new semantic/procedural
 * memory, or a new version of an existing Memory.
 */
export const proposeMemoryInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema.nullable().optional(),
  /** Present when proposing a further version of an existing Memory. */
  memoryId: uuidSchema.nullable().optional(),
  content: memoryContentSchema,
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  /** Bounded direct evidence closure; a semantic version must cite at least one. */
  sourceIds: z.array(uuidSchema).min(1).max(MEMORY_LIMITS.maxSourceClosure),
  /** Declared contradictions. Recorded as declared; never inferred or resolved. */
  contradictsVersionIds: z.array(uuidSchema).max(8).optional(),
  expectedCurrentVersionId: uuidSchema.nullable().optional(),
  idempotencyKey: byteBoundedText(200),
});
export type ProposeMemoryInput = z.infer<typeof proposeMemoryInputSchema>;

/** Explicit human acceptance of a proposed version. */
export const acceptMemoryInputSchema = z.object({
  projectId: uuidSchema,
  memoryId: uuidSchema,
  versionId: uuidSchema,
  /** The head this acceptance expects; `null` means the memory has no head yet. */
  expectedCurrentVersionId: uuidSchema.nullable(),
  reason: byteBoundedText(512).nullable().optional(),
  idempotencyKey: byteBoundedText(200),
});
export type AcceptMemoryInput = z.infer<typeof acceptMemoryInputSchema>;

/** A correction: a new accepted version that supersedes the named head. */
export const correctMemoryInputSchema = z.object({
  projectId: uuidSchema,
  memoryId: uuidSchema,
  expectedCurrentVersionId: uuidSchema,
  content: memoryContentSchema,
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  /** Bounded direct evidence closure; a semantic version must cite at least one. */
  sourceIds: z.array(uuidSchema).min(1).max(MEMORY_LIMITS.maxSourceClosure),
  /** Declared contradictions. Recorded as declared; never inferred or resolved. */
  contradictsVersionIds: z.array(uuidSchema).max(8).optional(),
  reason: byteBoundedText(512),
  idempotencyKey: byteBoundedText(200),
});
export type CorrectMemoryInput = z.infer<typeof correctMemoryInputSchema>;

/** A deterministic observed episode, admitted from supported captured evidence. */
export const recordEpisodeInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema.nullable().optional(),
  action: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  outcome: z.enum(EPISODE_OUTCOMES),
  observation: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  uncertainty: byteBoundedText(512).nullable().optional(),
  sourceIds: z.array(uuidSchema).min(1).max(MEMORY_LIMITS.maxSourceClosure),
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  idempotencyKey: byteBoundedText(200),
});
export type RecordEpisodeInput = z.infer<typeof recordEpisodeInputSchema>;

export const memoryQuerySchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema.nullable().optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  /** Bounded free-text focus over task title/statement; never a graph query. */
  focus: byteBoundedText(MEMORY_LIMITS.maxRecallFocusBytes).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;

export function memoryContentByteLength(content: MemoryContent): number {
  return utf8ByteLength(JSON.stringify(content));
}

export function memoryContentFits(content: MemoryContent): boolean {
  return memoryContentByteLength(content) <= MEMORY_LIMITS.maxVersionBytes;
}

/** A bounded task that groups requirements, memory and coordination. */
export const TASK_STATES = ['open', 'closed'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const taskViewSchema = z.object({
  taskId: uuidSchema,
  projectId: uuidSchema,
  title: byteBoundedText(MEMORY_LIMITS.maxTaskTitleBytes),
  taskFamily: z.string().max(128).nullable(),
  state: z.enum(TASK_STATES),
  /** Opaque revision token; equality is the guard for task-scoped writes. */
  revision: z.string().min(1).max(64),
  createdAtMs: z.number().int().nonnegative(),
  /** Task revision, not a completion claim. */
  requiredMemoryIds: z.array(uuidSchema).max(16),
});
export type TaskView = z.infer<typeof taskViewSchema>;

export const createTaskInputSchema = z.object({
  projectId: uuidSchema,
  title: byteBoundedText(MEMORY_LIMITS.maxTaskTitleBytes),
  taskFamily: z.string().max(128).nullable().optional(),
  idempotencyKey: byteBoundedText(200),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/** Binds a stable obligation identity to a task. Resolution is separate. */
export const requireMemoryInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema,
  memoryId: uuidSchema,
  expectedTaskRevision: z.string().min(1).max(64),
  idempotencyKey: byteBoundedText(200),
});
export type RequireMemoryInput = z.infer<typeof requireMemoryInputSchema>;

export const memoryOperationResultSchema = z.object({
  operationId: uuidSchema,
  state: operationStateSchema,
  memoryId: uuidSchema.nullable(),
  versionId: uuidSchema.nullable(),
  /** Present only for a committed operation. */
  committedAtMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});
export type MemoryOperationResult = z.infer<typeof memoryOperationResultSchema>;

/** A bounded page of memory views, newest identity first. */
export const memoryQueryResultSchema = z.object({
  memories: z.array(memoryViewSchema).max(50),
  /** True when the bounded scan stopped before this project/task set was exhausted. */
  hasMore: z.boolean(),
});
export type MemoryQueryResult = z.infer<typeof memoryQueryResultSchema>;

/**
 * How a required Memory resolves right now.
 *
 * `current` is the single accepted head. A requirement with no head, or with
 * more than one `CURRENT` edge observed, is reported explicitly rather than
 * picking a winner — a read never invents authority.
 */
export const MEMORY_REQUIREMENT_STATES = ['current', 'missing_current', 'duplicate_current'] as const;
export type MemoryRequirementState = (typeof MEMORY_REQUIREMENT_STATES)[number];

export const taskRequirementResolutionSchema = z.object({
  memoryId: uuidSchema,
  kind: z.enum(MEMORY_KINDS),
  state: z.enum(MEMORY_REQUIREMENT_STATES),
  current: memoryVersionSchema.nullable(),
});
export type TaskRequirementResolution = z.infer<typeof taskRequirementResolutionSchema>;

/** The exact current requirement versions for a task, with the task revision read. */
export const taskRequirementsViewSchema = z.object({
  taskId: uuidSchema,
  revision: z.string().min(1).max(64),
  requirements: z.array(taskRequirementResolutionSchema).max(16),
});
export type TaskRequirementsView = z.infer<typeof taskRequirementsViewSchema>;

/** Result of admitting a task intent; the task view carries the revision. */
export const taskOperationResultSchema = z.object({
  operationId: uuidSchema,
  state: operationStateSchema,
  taskId: uuidSchema,
  /** Present for a requirement binding. */
  memoryId: uuidSchema.nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
});
export type TaskOperationResult = z.infer<typeof taskOperationResultSchema>;

/**
 * The durable canonical form of a memory proposal or correction.
 *
 * This is not a request body. A content-bearing memory intent is captured as
 * one immutable `memory_proposal` Source holding exactly this document, and the
 * operation row references that source; the commit worker re-reads and
 * validates the document before writing anything. One definition serves the
 * admitting service and the worker, so the captured content cannot drift from
 * what was committed.
 */
export const MEMORY_DOCUMENT_VERSION = 1;

export const memoryDocumentSchema = z.object({
  documentVersion: z.literal(MEMORY_DOCUMENT_VERSION),
  operationKind: z.enum(['memory.propose', 'memory.correct']),
  memoryId: uuidSchema,
  /** `create` mints a new Memory identity; `attach` proposes onto an existing one. */
  memoryMode: z.enum(['create', 'attach']),
  versionId: uuidSchema,
  content: memoryContentSchema,
  applicability: applicabilitySchema,
  observedUnder: observedUnderSchema,
  sourceIds: z.array(uuidSchema).min(1).max(MEMORY_LIMITS.maxSourceClosure),
  contradictsVersionIds: z.array(uuidSchema).max(8),
  originTaskId: uuidSchema.nullable(),
  expectedHead: uuidSchema.nullable(),
  reason: byteBoundedText(512).nullable(),
});
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;

/** Deterministic serialization: one construction site, fixed member order. */
export function encodeMemoryDocument(document: MemoryDocument): string {
  return JSON.stringify({
    documentVersion: document.documentVersion,
    operationKind: document.operationKind,
    memoryId: document.memoryId,
    memoryMode: document.memoryMode,
    versionId: document.versionId,
    content: document.content,
    applicability: document.applicability,
    observedUnder: document.observedUnder,
    sourceIds: [...document.sourceIds],
    contradictsVersionIds: [...document.contradictsVersionIds],
    originTaskId: document.originTaskId,
    expectedHead: document.expectedHead,
    reason: document.reason,
  });
}
