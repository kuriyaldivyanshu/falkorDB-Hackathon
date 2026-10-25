import { z } from 'zod';

import { guardedMutationV3Schema, operationStateSchema } from './operations.js';
import { expectedPolicyV3Schema, policyFenceV3Schema } from './policy.js';
import { CONTRACT_PROTOCOL_VERSION_V3 } from './protocol.js';
import { byteBoundedText, isoInstantSchema, utf8ByteLength, uuidSchema } from './validation.js';

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

/**
 * How precisely the evidence behind an episode was established.
 *
 * `authored` is an assertion somebody wrote down: a report, a recollection or a
 * transcription. It is admissible memory, but it never becomes more certain
 * because it was asserted by a tool or repeated.
 *
 * `observed` is a narrower claim. It says this service resolved the episode's
 * outcome itself from evidence that passed its own eligibility checks. It is
 * **server-assigned**: a request may ask for it, but only the server can grant
 * it, and a caller that asks without qualifying evidence is refused rather than
 * quietly downgraded.
 *
 * Neither value says the underlying native execution did what it claimed. Native
 * observation is not provider-wire proof, and an exit status alone never
 * establishes a root cause or the success of a wider task.
 */
export const EPISODE_EVIDENCE_PRECISIONS = ['authored', 'observed'] as const;
export type EpisodeEvidencePrecision = (typeof EPISODE_EVIDENCE_PRECISIONS)[number];

/**
 * Source kinds that may carry outcome evidence, as a recorded fact about the
 * evidence itself.
 *
 * This list is deliberately narrow and is a *necessary* condition, never a
 * sufficient one. Declaring `kind` in a request only chooses which catalog an
 * entry lands in; eligibility is resolved by this service from durable facts,
 * including the kind of the principal that produced the evidence.
 */
export const OBSERVED_EVIDENCE_SOURCE_KINDS = ['procedure_outcome', 'tool_result', 'permission_outcome'] as const;
export type ObservedEvidenceSourceKind = (typeof OBSERVED_EVIDENCE_SOURCE_KINDS)[number];

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
  maxProcedurePrerequisites: 8,
  maxProcedureParameters: 16,
  /** Episode versions whose recorded outcomes this procedure cites as support. */
  maxProcedureSupports: 8,
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

/**
 * The stored form of an episodic version.
 *
 * `evidencePrecision` is server-resolved at admission from the eligibility of
 * the cited evidence, never taken from the request. An authored assertion that
 * reaches this contract stays `authored`, however it was captured.
 */
export const episodicContentSchema = z.object({
  kind: z.literal('episodic'),
  action: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  outcome: z.enum(EPISODE_OUTCOMES),
  /** What was observed. Never a claimed root cause. */
  observation: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  uncertainty: byteBoundedText(512).nullable(),
  evidencePrecision: z.enum(EPISODE_EVIDENCE_PRECISIONS),
});
export type EpisodicContent = z.infer<typeof episodicContentSchema>;

const procedureStepSchema = z.object({
  index: z.number().int().min(0).max(MEMORY_LIMITS.maxProcedureSteps - 1),
  text: byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes),
});

/**
 * The stored form of a procedure version.
 *
 * `procedureState` and `reviewRef` are recorded facts about the version, never
 * author input: admission copies them from the server-resolved outcome of the
 * operation, so a caller cannot write `validated` into a proposal. Validation
 * additionally needs a declared review *and* compatible observed reuse, which no
 * transition in this build performs; the compatible-reuse gate is N04.
 *
 * `supportedBy` names episode versions, never outcomes. The outcome each one
 * actually recorded is read back from project memory when the procedure is
 * read, so a procedure cannot claim support its evidence does not carry.
 */
export const proceduralContentSchema = z.object({
  kind: z.literal('procedural'),
  goal: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  steps: z.array(procedureStepSchema).min(1).max(MEMORY_LIMITS.maxProcedureSteps),
  /** Declared conditions that must hold before reuse. */
  prerequisites: z.array(byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes)).max(MEMORY_LIMITS.maxProcedurePrerequisites),
  parameters: z.array(z.object({
    name: byteBoundedText(128),
    value: byteBoundedText(512),
  })).max(MEMORY_LIMITS.maxProcedureParameters),
  procedureState: z.enum(PROCEDURE_STATES),
  /** Review that allowed validation; null until that gate exists. */
  reviewRef: z.string().max(256).nullable(),
  supportedBy: z.array(uuidSchema).max(MEMORY_LIMITS.maxProcedureSupports)
    .refine((ids) => new Set(ids).size === ids.length, 'Supporting episode versions must be unique.'),
});
export type ProceduralContent = z.infer<typeof proceduralContentSchema>;

/**
 * What a caller may author for a procedure.
 *
 * Narrower than the stored form on purpose, and strict about it: procedure
 * state, its review reference and its supporting-episode references are resolved
 * by this service, so sending one is an explicit refusal rather than a silently
 * dropped field. A caller that was told its procedure validated and got a
 * candidate instead would have been misled; a refusal cannot.
 *
 * A caller supplies the steps and declares the support it claims; the worker
 * checks every reference against project memory before anything is committed.
 */
export const procedureAuthoringSchema = z.strictObject({
  kind: z.literal('procedural'),
  goal: byteBoundedText(MEMORY_LIMITS.maxEpisodeFieldBytes),
  steps: z.array(procedureStepSchema).min(1).max(MEMORY_LIMITS.maxProcedureSteps),
  prerequisites: z.array(byteBoundedText(MEMORY_LIMITS.maxProcedureStepBytes)).max(MEMORY_LIMITS.maxProcedurePrerequisites),
  parameters: z.array(z.object({
    name: byteBoundedText(128),
    value: byteBoundedText(512),
  })).max(MEMORY_LIMITS.maxProcedureParameters),
  /** Episode versions this proposal claims as support. Checked, never trusted. */
  supportedBy: z.array(uuidSchema).max(MEMORY_LIMITS.maxProcedureSupports)
    .refine((ids) => new Set(ids).size === ids.length, 'Supporting episode versions must be unique.'),
});
export type ProcedureAuthoring = z.infer<typeof procedureAuthoringSchema>;

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

/**
 * What a caller may author in a proposal or correction.
 *
 * Only semantic and procedural content appears here. An episode arrives through
 * `memory.episode.record`, which resolves its own evidence precision instead of
 * accepting one, and a handoff is its own operation and state machine in N04.
 * A procedure narrows to `procedureAuthoringSchema` so its state, review
 * reference and supporting-episode set stay server-resolved.
 */
export const memoryAuthoringSchema = z.discriminatedUnion('kind', [
  semanticContentSchema,
  procedureAuthoringSchema,
]);
export type MemoryAuthoring = z.infer<typeof memoryAuthoringSchema>;

/**
 * Resolves an authored form into the durable stored form.
 *
 * This is the single place a procedure's state is decided at admission. Only
 * `candidate` is reachable here: human acceptance makes a candidate current,
 * and validated reuse needs a declared review plus compatible observed reuse,
 * which no transition in this build performs.
 */
export function resolveMemoryContent(authoring: MemoryAuthoring): MemoryContent {
  if (authoring.kind !== 'procedural') {
    return authoring;
  }
  return {
    kind: 'procedural',
    goal: authoring.goal,
    steps: authoring.steps,
    prerequisites: authoring.prerequisites,
    parameters: authoring.parameters,
    procedureState: 'candidate',
    reviewRef: null,
    supportedBy: [...authoring.supportedBy],
  };
}

/**
 * Projects a stored form back to what the caller authored.
 *
 * Request digests are taken over this projection, so a digest never includes a
 * server-resolved decision and an exact retry still matches its first admission.
 * Episodic and handoff content is not authorable through a proposal, so
 * projecting one is an internal error rather than a lossy conversion.
 */
export function authorMemoryContent(content: MemoryContent): MemoryAuthoring {
  if (content.kind === 'procedural') {
    return {
      kind: 'procedural',
      goal: content.goal,
      steps: content.steps,
      prerequisites: content.prerequisites,
      parameters: content.parameters,
      supportedBy: [...content.supportedBy],
    };
  }
  if (content.kind === 'semantic') {
    return content;
  }
  throw new Error(`Memory content of kind ${content.kind} cannot be authored through a proposal.`);
}

/**
 * One episode version another version cites as supporting reuse.
 *
 * The reference names a version, never an outcome. The outcome that episode
 * actually recorded, and the conditions it was observed under, are read back
 * from project memory with this view: a procedure cannot claim support its
 * evidence does not carry, and a later summary cannot relabel it.
 */
export const memorySupportSchema = z.object({
  versionId: uuidSchema,
  memoryId: uuidSchema,
  /** The referenced version's recorded outcome, verbatim. */
  outcome: z.enum(EPISODE_OUTCOMES),
  observedUnder: observedUnderSchema,
  observedAtMs: z.number().int().nonnegative(),
});
export type MemorySupport = z.infer<typeof memorySupportSchema>;

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
  /**
   * How precisely this version's evidence was established. Present for an
   * episodic version, where it is the difference between a recorded assertion
   * and a service-resolved outcome; `null` for kinds that carry no observation.
   */
  evidencePrecision: z.enum(EPISODE_EVIDENCE_PRECISIONS).nullable(),
  /** Episodes this procedure cites as support, resolved from project memory. */
  supports: z.array(memorySupportSchema).max(MEMORY_LIMITS.maxProcedureSupports),
  /** Accepting human's reason, when acceptance recorded one. */
  acceptReason: byteBoundedText(512).nullable(),
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
 * A proposal from a producer (model or human) for new semantic/episodic/
 * procedural memory, or a new version of an existing Memory.
 *
 * `content` is the authored form, never the stored one: a caller cannot supply
 * a procedure's state or review reference through this contract.
 */
export const proposeMemoryInputSchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema.nullable().optional(),
  /** Present when proposing a further version of an existing Memory. */
  memoryId: uuidSchema.nullable().optional(),
  content: memoryAuthoringSchema,
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
  content: memoryAuthoringSchema,
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

/**
 * One attempted action and the outcome that was actually established for it.
 *
 * `outcome` is a claim about *this action under the recorded
 * `observedUnder`*, never a claim about a wider task. `succeeded`/`failed`
 * report what was observed; `denied`, `interrupted` and `unknown` stay distinct,
 * because a denied action and an unknown action are different facts and neither
 * one is a failure to have tried.
 *
 * `uncertainty` is required for an unknown outcome: an episode that does not
 * know what happened must say so rather than record a bare `unknown`.
 *
 * `evidencePrecision` is a request, not a grant. `observed` is honoured only
 * when every cited source passes this service's own eligibility checks; a
 * request for `observed` without qualifying evidence is refused rather than
 * silently recorded as authored.
 */
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
  evidencePrecision: z.enum(EPISODE_EVIDENCE_PRECISIONS).optional(),
  idempotencyKey: byteBoundedText(200),
});
export type RecordEpisodeInput = z.infer<typeof recordEpisodeInputSchema>;

export const memoryQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
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
  nextCursor: z.string().max(2048).nullable().optional(),
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
 *
 * The version stays `1`: the shapes this checkpoint adds belong to kinds that
 * were never admissible before, so a document captured by an earlier build is
 * still exactly a semantic proposal or correction and still re-derives to the
 * same request digest.
 */
export const MEMORY_DOCUMENT_VERSION = 1;

export const memoryDocumentSchema = z.object({
  documentVersion: z.literal(MEMORY_DOCUMENT_VERSION),
  operationKind: z.enum(['memory.propose', 'memory.correct', 'memory.episode.record']),
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
  /**
   * Evidence precision the caller *asked* for; part of the request digest so an
   * exact retry matches. The precision the server actually granted is recorded
   * in `content.evidencePrecision` and is resolved from eligibility, not input.
   */
  requestedEvidencePrecision: z.enum(EPISODE_EVIDENCE_PRECISIONS).nullable().optional(),
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
    requestedEvidencePrecision: document.requestedEvidencePrecision ?? null,
  });
}

export const MEMORY_KINDS_V3 = [...MEMORY_KINDS, 'preference', 'progress'] as const;
export const MEMORY_METADATA_MAX_ASSOCIATIONS_V3 = 32;

const memoryAssociationFieldsV3 = {
  field: z.enum(['session', 'agent', 'task', 'topic', 'ticket', 'feature', 'tag']),
  value: byteBoundedText(256),
};
const hasValidTaskAssociationV3 = (v: { field: string; value: string }): boolean =>
  v.field !== 'task' || uuidSchema.safeParse(v.value).success;

/** Caller-authored associations contain no attributed actor or confirmation
 * fact. Manual provenance requests confirmation under current authorization
 * and mutation guards; the backend stamps the authenticated actor and result.
 * Inferred provenance remains unconfirmed and its source reference is checked. */
export const memoryAssociationInputV3Schema = z.discriminatedUnion('provenance', [
  z.strictObject({ provenance: z.literal('manual'), ...memoryAssociationFieldsV3 }),
  z.strictObject({ provenance: z.literal('inferred'), ...memoryAssociationFieldsV3,
    sourceVersionId: uuidSchema }),
]).refine(hasValidTaskAssociationV3, 'Task associations require a task UUID.');
export type MemoryAssociationInputV3 = z.infer<typeof memoryAssociationInputV3Schema>;

/** Stored, server-attributed view only. Labels never grant authority or task
 * ownership; an inferred association never encodes a confirmed association. */
export const memoryAssociationV3Schema = z.discriminatedUnion('provenance', [
  z.strictObject({ provenance: z.literal('manual'), confirmed: z.literal(true),
    ...memoryAssociationFieldsV3, assertedByPrincipalId: uuidSchema }),
  z.strictObject({ provenance: z.literal('inferred'), confirmed: z.literal(false),
    ...memoryAssociationFieldsV3, sourceVersionId: uuidSchema }),
]).refine(hasValidTaskAssociationV3, 'Task associations require a task UUID.');
export type MemoryAssociationV3 = z.infer<typeof memoryAssociationV3Schema>;

const memoryMetadataFieldsV3 = {
  projectId: uuidSchema,
  date: isoInstantSchema.nullable(),
  dateProvenance: z.enum(['manual', 'inferred']).nullable(),
};
const hasDateProvenanceV3 = (v: { date: string | null; dateProvenance: string | null }): boolean =>
  (v.date === null) === (v.dateProvenance === null);
export const memoryMetadataInputV3Schema = z.strictObject({
  ...memoryMetadataFieldsV3,
  associations: z.array(memoryAssociationInputV3Schema).max(MEMORY_METADATA_MAX_ASSOCIATIONS_V3),
}).refine(hasDateProvenanceV3, 'A date and its provenance must be supplied together.');
export type MemoryMetadataInputV3 = z.infer<typeof memoryMetadataInputV3Schema>;

export const memoryMetadataV3Schema = z.strictObject({
  projectId: memoryMetadataFieldsV3.projectId,
  associations: z.array(memoryAssociationV3Schema).max(MEMORY_METADATA_MAX_ASSOCIATIONS_V3),
  date: memoryMetadataFieldsV3.date,
  dateProvenance: memoryMetadataFieldsV3.dateProvenance,
}).refine(hasDateProvenanceV3, 'A date and its provenance must be supplied together.');
export type MemoryMetadataV3 = z.infer<typeof memoryMetadataV3Schema>;

export const preferenceContentV3Schema = z.strictObject({
  kind: z.literal('preference'), statement: byteBoundedText(4096),
  conditions: z.array(byteBoundedText(512)).max(8),
});
export type PreferenceContentV3 = z.infer<typeof preferenceContentV3Schema>;
export const progressContentV3Schema = z.strictObject({
  kind: z.literal('progress'), objective: byteBoundedText(2048),
  state: z.enum(['in_progress', 'blocked', 'completed', 'unknown']),
  progress: byteBoundedText(2048),
  blockers: z.array(byteBoundedText(512)).max(8),
  openQuestions: z.array(byteBoundedText(512)).max(8),
  nextSteps: z.array(byteBoundedText(512)).max(8),
}).refine((v) => v.state !== 'blocked' || v.blockers.length > 0,
  'Blocked progress requires an explicit blocker.');
export type ProgressContentV3 = z.infer<typeof progressContentV3Schema>;

/** V3 reuses existing content shapes with strict boundaries. Procedure reuse
 * qualification remains deferred; only candidate procedures can be recorded. */
export const memoryAuthoringV3Schema = z.union([
  semanticContentSchema.strict(), preferenceContentV3Schema, progressContentV3Schema,
  episodicContentSchema.omit({ evidencePrecision: true }).strict(),
  procedureAuthoringSchema.extend({
    steps: z.array(procedureStepSchema.strict()).min(1).max(MEMORY_LIMITS.maxProcedureSteps),
    parameters: z.array(z.strictObject({ name: byteBoundedText(128), value: byteBoundedText(512) }))
      .max(MEMORY_LIMITS.maxProcedureParameters),
  }),
]).refine((v) => utf8ByteLength(JSON.stringify(v)) <= MEMORY_LIMITS.maxVersionBytes,
  'Memory content exceeds the version byte limit.');
export type MemoryAuthoringV3 = z.infer<typeof memoryAuthoringV3Schema>;

const initialMemoryAuthoringV3Schema = z.strictObject({
  projectId: uuidSchema,
  content: memoryAuthoringV3Schema,
  metadata: memoryMetadataInputV3Schema,
  sourceVersionIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
});
type InitialMemoryAuthoringV3 = z.infer<typeof initialMemoryAuthoringV3Schema>;

/** Exact UTF-8 size of the canonical initial proposed version after backend
 * attribution and normalization. UUID placeholders reserve only fixed-width
 * bytes, never identities/authority. The canonical initial record uses an ISO
 * timestamp from Date.toISOString() (24 bytes), unpinned/unflagged markers,
 * proposed acceptance and no conflicts. Episodes normalize to authored and
 * procedures to candidate. This is a representability check, not admission or
 * authentication; services must still validate their actual final record,
 * including any later acceptance, marker or conflict transition. */
export function initialMemoryRecordByteLengthV3(input: InitialMemoryAuthoringV3): number {
  const uuid = '00000000-0000-4000-8000-000000000000';
  const content = input.content.kind === 'episodic'
    ? { ...input.content, evidencePrecision: 'authored' }
    : input.content.kind === 'procedural'
      ? { ...input.content, procedureState: 'candidate', reviewRef: null }
      : input.content;
  return utf8ByteLength(JSON.stringify({
    protocolVersion: CONTRACT_PROTOCOL_VERSION_V3,
    projectId: input.projectId, memoryId: uuid, versionId: uuid,
    content,
    metadata: {
      projectId: input.metadata.projectId,
      associations: input.metadata.associations.map((association) => association.provenance === 'manual'
        ? { ...association, confirmed: true, assertedByPrincipalId: uuid }
        : { ...association, confirmed: false }),
      date: input.metadata.date, dateProvenance: input.metadata.dateProvenance,
    },
    acceptance: { state: 'proposed' }, markers: { pinned: false, stale: { state: 'unflagged' } },
    sourceVersionIds: input.sourceVersionIds, conflictIds: [], createdAt: '2000-01-01T00:00:00.000Z',
  }));
}
const fitsInitialMemoryRecordV3 = (input: InitialMemoryAuthoringV3): boolean =>
  initialMemoryRecordByteLengthV3(input) <= MEMORY_LIMITS.maxVersionBytes;

/** Proposal input has no acceptance, visibility or evidence-precision override.
 * Policy acceptance is resolved by the service, never a caller-selected flag. */
export const proposeMemoryV3Schema = initialMemoryAuthoringV3Schema.extend({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  requestId: uuidSchema, guard: expectedPolicyV3Schema,
}).refine((v) => v.projectId === v.metadata.projectId, 'Metadata must name the selected project.')
  .refine(fitsInitialMemoryRecordV3, 'Authoring cannot fit an initial stored memory version.');
export type ProposeMemoryV3 = z.infer<typeof proposeMemoryV3Schema>;
export const correctMemoryV3Schema = guardedMutationV3Schema.extend({
  ...initialMemoryAuthoringV3Schema.pick({ content: true, metadata: true, sourceVersionIds: true }).shape,
  reason: byteBoundedText(512),
}).refine((v) => v.projectId === v.metadata.projectId, 'Correction metadata must keep project scope.')
  .refine(fitsInitialMemoryRecordV3, 'Correction cannot fit an initial stored memory version.');
export type CorrectMemoryV3 = z.infer<typeof correctMemoryV3Schema>;

/** This is an owner-controlled policy view, not model input. Defaults require
 * human review; owner_policy requires a matching current owner rule at runtime. */
export const memoryAcceptancePolicyV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), projectId: uuidSchema,
  ownerPrincipalId: uuidSchema, fence: policyFenceV3Schema,
  defaultAcceptance: z.literal('human_review'),
  rules: z.array(z.strictObject({ ruleId: uuidSchema,
    kind: z.enum(MEMORY_KINDS_V3), semanticSubtype: z.enum(SEMANTIC_SUBTYPES).nullable(),
    acceptance: z.enum(['human_review', 'owner_policy']),
  }).refine((v) => (v.kind === 'semantic') === (v.semanticSubtype !== null),
    'Only semantic rules have a semantic subtype.')).max(32),
});
export type MemoryAcceptancePolicyV3 = z.infer<typeof memoryAcceptancePolicyV3Schema>;
export const memoryAcceptanceV3Schema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('proposed') }),
  z.strictObject({ state: z.literal('accepted'), acceptedAt: isoInstantSchema,
    authority: z.discriminatedUnion('basis', [
      z.strictObject({ basis: z.literal('human'), principalId: uuidSchema }),
      z.strictObject({ basis: z.literal('owner_policy'), ownerPrincipalId: uuidSchema,
        ruleId: uuidSchema, fence: policyFenceV3Schema }),
    ]),
  }),
  z.strictObject({ state: z.literal('superseded'), supersededByVersionId: uuidSchema }),
  z.strictObject({ state: z.literal('retracted'), reason: byteBoundedText(512) }),
]);
export type MemoryAcceptanceV3 = z.infer<typeof memoryAcceptanceV3Schema>;
export const acceptMemoryV3Schema = guardedMutationV3Schema.extend({
  proposalVersionId: uuidSchema,
});
export type AcceptMemoryV3 = z.infer<typeof acceptMemoryV3Schema>;

export const memoryMarkersV3Schema = z.strictObject({
  pinned: z.boolean(),
  stale: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('unflagged') }),
    z.strictObject({ state: z.literal('flagged'), reason: byteBoundedText(512), flaggedAt: isoInstantSchema }),
  ]),
});
export type MemoryMarkersV3 = z.infer<typeof memoryMarkersV3Schema>;
/** Pin affects ranking only; it cannot extend retention, confer acceptance or
 * bypass denial. These edits are guarded mutations, not direct content edits. */
export const markMemoryV3Schema = guardedMutationV3Schema.extend({ markers: memoryMarkersV3Schema });
export type MarkMemoryV3 = z.infer<typeof markMemoryV3Schema>;
export const memoryVersionRefV3Schema = z.strictObject({ memoryId: uuidSchema, versionId: uuidSchema });
export type MemoryVersionRefV3 = z.infer<typeof memoryVersionRefV3Schema>;
const conflictParticipantsV3Schema = z.array(memoryVersionRefV3Schema).min(2).max(16)
  .refine((v) => new Set(v.map((p) => p.memoryId)).size === v.length,
    'A conflict must name distinct memories with their current versions.');
export const memoryConflictV3Schema = z.strictObject({
  conflictId: uuidSchema, projectId: uuidSchema,
  participants: conflictParticipantsV3Schema,
  resolution: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('unresolved') }),
    z.strictObject({ state: z.literal('resolved'), resolutionVersionId: uuidSchema,
      resolvedByPrincipalId: uuidSchema, resolvedAt: isoInstantSchema }),
  ]),
});
export type MemoryConflictV3 = z.infer<typeof memoryConflictV3Schema>;
export const resolveMemoryConflictV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), requestId: uuidSchema,
  projectId: uuidSchema, guard: expectedPolicyV3Schema,
  conflictId: uuidSchema, expectedParticipants: conflictParticipantsV3Schema,
  resolution: byteBoundedText(4096),
});
export type ResolveMemoryConflictV3 = z.infer<typeof resolveMemoryConflictV3Schema>;

/** Sharing publishes a new destination proposal under destination policy.
 * Origin details stay in the protected dependency ledger, not recipient text. */
export const shareMemoryV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), requestId: uuidSchema,
  originProjectId: uuidSchema, origin: memoryVersionRefV3Schema,
  originGuard: expectedPolicyV3Schema, destinationProjectId: uuidSchema,
  destinationGuard: expectedPolicyV3Schema,
  selectedSourceVersionIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
}).refine((v) => v.originProjectId !== v.destinationProjectId,
  'Sharing requires a separate destination project.');
export type ShareMemoryV3 = z.infer<typeof shareMemoryV3Schema>;
export const sharingLineageV3Schema = z.strictObject({
  publicationId: uuidSchema, destination: memoryVersionRefV3Schema,
  dependencyLedgerRef: uuidSchema,
  originDisclosure: z.literal('protected'),
});
export type SharingLineageV3 = z.infer<typeof sharingLineageV3Schema>;

/** Requested knowledge transfer only; no execution/claim transfer or inferred
 * task ownership. This shape serves both stored handoff content and requested
 * composition; composition additionally uses the recall packet's whole budget. */
export const requestedHandoffV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3), projectId: uuidSchema,
  kind: z.literal('handoff'), requestId: uuidSchema, taskId: uuidSchema.nullable(),
  fromSessionId: uuidSchema.nullable(),
  progressVersionIds: z.array(uuidSchema).max(16),
  objective: byteBoundedText(2048), conditions: z.array(byteBoundedText(512)).max(8),
  outcomes: z.array(z.strictObject({ outcome: z.enum(EPISODE_OUTCOMES),
    precision: z.enum(EPISODE_EVIDENCE_PRECISIONS), sourceVersionId: uuidSchema })).max(8),
  unresolved: z.array(byteBoundedText(512)).max(16),
  sourceVersionIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
  state: z.enum(['ready', 'incomplete', 'conflict', 'unavailable']),
  limitations: z.array(byteBoundedText(256)).max(16),
}).refine((v) => v.state === 'ready' || v.limitations.length > 0,
  'Incomplete handoffs require explicit limitations.');
export type RequestedHandoffV3 = z.infer<typeof requestedHandoffV3Schema>;

export const memoryContentV3Schema = z.union([
  semanticContentSchema.strict(), preferenceContentV3Schema, progressContentV3Schema,
  episodicContentSchema.strict(),
  proceduralContentSchema.extend({
    procedureState: z.literal('candidate'), reviewRef: z.null(),
    steps: z.array(procedureStepSchema.strict()).min(1).max(MEMORY_LIMITS.maxProcedureSteps),
    parameters: z.array(z.strictObject({ name: byteBoundedText(128), value: byteBoundedText(512) }))
      .max(MEMORY_LIMITS.maxProcedureParameters),
  }).strict(),
  requestedHandoffV3Schema,
]).refine((v) => utf8ByteLength(JSON.stringify(v)) <= MEMORY_LIMITS.maxVersionBytes,
  'Stored content exceeds the version byte limit.');
export type MemoryContentV3 = z.infer<typeof memoryContentV3Schema>;
export const memoryRecordV3Schema = z.strictObject({
  protocolVersion: z.literal(CONTRACT_PROTOCOL_VERSION_V3),
  projectId: uuidSchema, memoryId: uuidSchema, versionId: uuidSchema,
  content: memoryContentV3Schema, metadata: memoryMetadataV3Schema,
  acceptance: memoryAcceptanceV3Schema, markers: memoryMarkersV3Schema,
  sourceVersionIds: z.array(uuidSchema).max(MEMORY_LIMITS.maxSourceClosure),
  conflictIds: z.array(uuidSchema).max(16),
  createdAt: isoInstantSchema,
}).refine((v) => v.projectId === v.metadata.projectId,
  'Stored metadata must match the memory project.')
  .refine((v) => !('projectId' in v.content) || v.content.projectId === v.projectId,
    'Handoff content must match the memory project.')
  .refine((v) => utf8ByteLength(JSON.stringify(v)) <= MEMORY_LIMITS.maxVersionBytes,
    'The complete memory version exceeds its byte limit.');
export type MemoryRecordV3 = z.infer<typeof memoryRecordV3Schema>;
