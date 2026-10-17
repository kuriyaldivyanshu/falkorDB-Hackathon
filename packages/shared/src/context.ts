/**
 * M05.3 — bounded context packets, request budget and context occurrences.
 *
 * This module is the integration seam. It is published **before** the selector
 * is implemented so Agent B can bind against a stable surface rather than a
 * provisional one, and so the pieces that must agree about one request budget
 * have one vocabulary.
 *
 * Four states are kept strictly apart, because the most expensive confusion in
 * this area is treating local persistence as proof of provider receipt:
 *
 * 1. **staged** — the packet bytes exist as an immutable artifact. Nothing has
 *    been sent and nothing has been admitted.
 * 2. **journaled** — a `model_requests` row exists for an attempt that carries
 *    this packet. The provider has not acknowledged anything.
 * 3. **dispatch_observed** — the transport reported that it sent. This is an
 *    observation about our own side of the socket, not about the provider.
 * 4. **outcome_unknown** — the acknowledgement was lost. The attempt may or may
 *    not have been accepted and possibly charged.
 *
 * A local persistence step never claims a provider receipt. `occurrenceId`
 * records one *use* of one packet by one attempt; two attempts using the same
 * packet are two occurrences, and re-persisting one occurrence deduplicates.
 */

import type { DecimalSequence } from './checkpoint.js';

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

/**
 * Selection priority.
 *
 * `P0` is governing authority and unresolved effects: exact, mandatory, and
 * **never** ordered by similarity. `P1` is current blockers and applicable
 * diagnostics. `P2` is compatible advice. `P3` is bulk reference.
 */
export type ContextPriority = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * How an item was represented in the packet.
 *
 * `exact` carries the whole binding. `excerpt` carries a bounded part of it.
 * `reference` names it without inlining it. The distinction matters for audit:
 * a reference is not a weaker copy of exact authority, it is a pointer.
 */
export type Representation = 'exact' | 'excerpt' | 'reference';

/**
 * What an item is, which determines whether it is mandatory.
 *
 * Anything that states an obligation is mandatory regardless of priority band,
 * which is why `goal`, `constraint` and `criteria` are separated from `plan`.
 */
export type ContextItemKind =
  | 'goal'
  | 'constraint'
  | 'criteria'
  | 'task_state'
  | 'candidate'
  | 'unresolved_effect'
  | 'plan'
  | 'checkpoint'
  | 'diagnostic'
  | 'failure_episode'
  | 'advice'
  | 'procedure'
  | 'bulk_reference';

export interface ContextSourceBinding {
  /** The Source id, resolvable through the existing Source service. */
  readonly sourceId: string;
  /** Content digest of the bytes this binding names. */
  readonly contentDigest: string;
  readonly artifactId?: string | null;
  /** The version of the underlying record, so a stale binding is detectable. */
  readonly recordVersion?: string | null;
}

export interface ContextItem {
  readonly kind: ContextItemKind;
  readonly priority: ContextPriority;
  /** True when the item cannot be dropped to fit a budget. */
  readonly mandatory: boolean;
  readonly representation: Representation;
  /** Why the item was included, in terms a reviewer can check. */
  readonly inclusionReason: string;
  readonly identity: string;
  readonly revision?: DecimalSequence | null;
  readonly graphEpoch?: string | null;
  readonly bindings: readonly ContextSourceBinding[];
  /** Rendered text, present for `exact` and `excerpt`. */
  readonly text?: string;
  /** Rough token cost, with the precision actually used. */
  readonly proofStatus?: 'compatible_advice' | 'stale_proof';
  readonly estimatedTokens?: number | null;
  /** How the estimate was derived; a guess is labelled, never asserted as exact. */
  readonly tokenPrecision?: 'exact' | 'upper_bound' | 'unknown' | null;
}

/**
 * Why something was left out.
 *
 * Omissions are counted and named. A packet that silently drops accepted
 * constraints is the failure this whole shape exists to make visible.
 */
export interface ContextOmission {
  readonly kind: ContextItemKind;
  readonly reason: 'over_budget' | 'not_relevant' | 'superseded' | 'unavailable' | 'duplicate' | 'not_admitted';
  readonly count: number;
  readonly detail?: string;
}

/* ------------------------------------------------------------------ */
/* Packet manifest                                                     */
/* ------------------------------------------------------------------ */

export const CONTEXT_PACKET_SCHEMA_VERSION = 1;
export const CONTEXT_PACKET_KIND = 'context-packet-v1';

/**
 * The immutable manifest for one built packet.
 *
 * Bumped when the shape changes, so a reader can tell two packet generations
 * apart rather than guessing.
 */
export interface ContextPacketManifest {
  readonly schemaVersion: number;
  readonly packetKind: typeof CONTEXT_PACKET_KIND;
  readonly packetId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly graphEpoch: string;
  readonly taskRevision: DecimalSequence;
  readonly requirementRevision: DecimalSequence;
  readonly items: readonly ContextItem[];
  readonly omissions: readonly ContextOmission[];
  readonly totalEstimatedTokens: number;
  readonly totalTokenPrecision: 'exact' | 'upper_bound' | 'unknown';
  /** The renderer version, so a formatting change is detectable. */
  readonly templateVersion: string;
  /** The selection policy version that produced this packet. */
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly producerSessionId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Request budget                                                      */
/* ------------------------------------------------------------------ */

/**
 * The single request-budget authority.
 *
 * Agent B owns nothing about whether a request fits: B renders and proposes,
 * this decides. The whole-request cost is the sum of every component that will
 * travel, including base64 expansion and output reservation, because budgeting
 * only the input text under-reserves by a third whenever a Source read is
 * involved.
 */
export interface RequestBudgetInput {
  /** Selected instruction and history text, already rendered. */
  readonly instructionsText: string;
  readonly historyText: string;
  /** Tool schemas the provider will receive. */
  readonly toolSchemasText: string;
  /** The rendered packet, or its manifest summary when inlined. */
  readonly packetText: string;
  /** Retrieved Source output, already serialized as it will travel. */
  readonly retrievalText: string;
  /** Actual selected immutable profile ceiling; required for admission. */
  readonly limitTokens: number;
  /** Maximum output the request may produce. */
  readonly reservedOutputTokens: number;
  /** Headroom the policy requires beyond measured input. */
  readonly safetyHeadroomTokens: number;
}

export interface RequestBudgetResult {
  readonly permitted: boolean;
  readonly inputTokensEstimate: number;
  readonly precision: 'exact' | 'upper_bound';
  readonly reservedOutputTokens: number;
  readonly headroomTokens: number;
  readonly totalTokens: number;
  /** The declared ceiling this was checked against. */
  readonly limitTokens: number;
  readonly overageTokens?: number;
  /** Present when the refusal is caused by mandatory context, not by trimming. */
  readonly mandatoryOverflow?: boolean;
}

/* ------------------------------------------------------------------ */
/* Refresh / inspect / compact / search                                */
/* ------------------------------------------------------------------ */

/** Why a context operation could not proceed. */
export type ContextRefusalKind =
  | 'unresolved_effects'
  | 'stale_epoch'
  | 'stale_revision'
  | 'denied_source'
  | 'missing_bytes'
  | 'mandatory_overflow'
  | 'no_admitted_task'
  | 'invalid'
  | 'busy';

export interface ContextRefusal {
  readonly kind: ContextRefusalKind;
  readonly message: string;
  readonly detail?: Record<string, string | number | boolean>;
}

/**
 * `refresh` replaces the single current memory block.
 *
 * It never appends a repeated packet, never starts inference and never creates
 * a successor session.
 */
export interface ContextRefreshInput {
  /** Maximum packet tokens; defaults to the policy value, never above the maximum. */
  readonly maxTokens?: number;
}

export interface ContextRefreshResult {
  readonly kind: 'refreshed' | 'unchanged' | 'refused';
  readonly packetId?: string;
  readonly manifest?: ContextPacketManifest;
  /** Whether the previous block was replaced rather than appended to. */
  readonly replacedPrevious: boolean;
  readonly refusal?: ContextRefusal;
}

export interface ContextInspectResult {
  readonly packet: ContextPacketManifest | null;
  readonly omissions: readonly ContextOmission[];
  readonly budget?: RequestBudgetResult;
  /** The current occurrence, when one has been journaled. */
  readonly currentOccurrenceId?: string | null;
}

/**
 * `compact` deterministically rebuilds bounded working history and the packet.
 *
 * It makes no model request, deletes no durable history, and refuses while an
 * attempt or tool batch is unresolved.
 */
export interface ContextCompactResult {
  readonly kind: 'compacted' | 'refused';
  readonly packetId?: string;
  readonly retainedTurns: number;
  readonly droppedTurns: number;
  readonly summaryModelCalls: 0;
  readonly refusal?: ContextRefusal;
}

export interface MemorySearchInput {
  readonly query: string;
  readonly limit?: number;
  readonly afterItemId?: string | null;
}

export interface MemorySearchHit {
  readonly itemId: string;
  readonly kind: ContextItemKind;
  readonly identity: string;
  readonly snippet: string;
  readonly bindings: readonly ContextSourceBinding[];
  /**
   * `exact` only when the item is current proof for this candidate, criteria,
   * environment and revision. Anything else is advice, and is labelled so it
   * can never be accepted later as if it were proof.
   */
  readonly proofStatus: 'exact_current' | 'compatible_advice' | 'stale_proof';
}

export interface MemorySearchResult {
  readonly hits: readonly MemorySearchHit[];
  readonly nextAfterItemId: string | null;
  readonly truncated: boolean;
  readonly scannedCandidates: number;
  /** The caps actually applied, so a client can explain a short page. */
  readonly limits: { readonly maxHops: number; readonly maxCandidates: number };
}

/* ------------------------------------------------------------------ */
/* Occurrences                                                         */
/* ------------------------------------------------------------------ */

/**
 * One use of one packet by one attempt.
 *
 * Identity is `(packetId, attemptId)`: two attempts using one packet are two
 * occurrences, and re-persisting one occurrence deduplicates on it.
 */
export interface ContextOccurrence {
  readonly occurrenceId: string;
  readonly packetId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  /** The attempt whose journaled input carried this packet. */
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly logicalRequestId: string;
  readonly packetDigest: string;
  readonly createdAt: string;
}

export type OccurrenceLifecycle =
  /** Packet bytes exist. Nothing journaled, nothing sent. */
  | 'staged'
  /** A model request row carries this packet. The provider has not acknowledged. */
  | 'journaled'
  /** Our transport reported it sent. Not a provider receipt. */
  | 'dispatch_observed'
  /** Acknowledgement lost; possibly accepted and possibly charged. */
  | 'outcome_unknown'
  /** The provider reported a terminal response for this attempt. */
  | 'terminal_observed';

export interface OccurrenceTransition {
  readonly occurrenceId: string;
  readonly lifecycle: OccurrenceLifecycle;
  readonly recordedAt: string;
  /** A provider response id, when one was actually reported. Never inferred. */
  readonly providerResponseId?: string | null;
  /** Possible charge, when the transport reported uncertainty. Absent is unknown. */
  readonly possibleCharge?: boolean | null;
}

/* ------------------------------------------------------------------ */
/* Service port                                                        */
/* ------------------------------------------------------------------ */

/** The scope every context operation is fenced by, resolved server-side. */
export interface ContextScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly agentSessionId?: string | null;
  readonly runId?: string | null;
  readonly userSessionId?: string | null;
}

export interface ContextService {
  /** Build the bounded packet for the current task and make it current. */
  refresh(scope: ContextScope, input?: ContextRefreshInput): Promise<ContextRefreshResult>;
  /** Recheck a staged immutable packet before journaling; no selection side effect. */
  validateForAdmission(scope: ContextScope, packetId: string): Promise<void>;
  /** Read the current packet, its omissions and its budget accounting. */
  inspect(scope: ContextScope): Promise<ContextInspectResult>;
  /** Deterministically rebuild bounded working history plus the packet. */
  compact(scope: ContextScope): Promise<ContextCompactResult>;
  /** Bounded task-relevant recall with authorized Source references. */
  search(scope: ContextScope, input: MemorySearchInput): Promise<MemorySearchResult>;
  /**
   * Records one use of one packet by one attempt.
   *
   * Deduplicates on `(packetId, attemptId)`, so a retry of persistence for one
   * occurrence is a no-op while a second attempt is a new occurrence.
   */
  recordOccurrence(scope: ContextScope, occurrence: ContextOccurrence): Promise<ContextOccurrence>;
  /** Advances an occurrence's lifecycle without ever claiming a receipt. */
  transitionOccurrence(scope: ContextScope, transition: OccurrenceTransition): Promise<ContextOccurrence>;
  /**
   * The whole-request budget authority.
   *
   * Agent B calls this with the components it will actually send; it never
   * decides for itself whether a request fits.
   */
  budget(input: RequestBudgetInput): RequestBudgetResult;
}

export const CONTEXT_ROUTES = {
  refresh: '/projects/:projectId/tasks/:taskId/context/refresh',
  inspect: '/projects/:projectId/tasks/:taskId/context',
  compact: '/projects/:projectId/tasks/:taskId/context/compact',
  search: '/projects/:projectId/tasks/:taskId/context/search',
} as const;

/* ------------------------------------------------------------------ */
/* Declared bounds                                                     */
/* ------------------------------------------------------------------ */

/** `retrieval.memory_packet_default_tokens`. */
export const PACKET_DEFAULT_TOKENS = 6_000;

/** `retrieval.memory_packet_max_tokens`. */
export const PACKET_MAX_TOKENS = 8_000;

/** Optional-traversal bounds; mandatory authority is never counted against these. */
export const MAX_OPTIONAL_HOPS = 3;
export const MAX_OPTIONAL_CANDIDATES = 64;
export const MAX_ADVISORY_FAILURES = 4;
export const MAX_PROCEDURES = 2;