/**
 * M01 admission contracts.
 *
 * These shapes are the durable boundary between a human decision and recorded
 * authority. Two identities are deliberately kept apart:
 *
 * - `requestId` is a caller-supplied UUID that is stable across retries and
 *   restarts. It is the idempotency key. It is NOT the M00 transport
 *   `commandId`, which is allocated per HTTP delivery and has no durability.
 * - `commandId` continues to identify one transport delivery only.
 *
 * Acceptance content is supplied by the human (Agent B loads the authored
 * fixture manifest as data). The backend records what was accepted verbatim and
 * digests it; it never invents a criterion or rewrites the goal.
 */

export const ADMISSION_COMMAND = 'task.accept_goal' as const;

/** SQL `uuid` columns receive these, never branded `cmd_...` transport ids. */
export type Uuid = string;

export const ACCEPTED_REQUIREMENT_POLARITY = ['must', 'must_not', 'preference'] as const;
export type AcceptedRequirementPolarity = (typeof ACCEPTED_REQUIREMENT_POLARITY)[number];

export const CRITERION_KINDS = ['command', 'assertion', 'human_review'] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export interface AcceptedRequirement {
  /** Stable human-chosen key, for example `max_age_seconds`. */
  readonly field: string;
  readonly type: 'integer';
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly revision: number;
}

export interface AcceptedCriterion {
  readonly kind: CriterionKind;
  /** Stable identifier within the accepted set, for example `initial-mixed-offsets`. */
  readonly ref: string;
  readonly text: string;
  readonly required: boolean;
  /** Only meaningful for `command` criteria; protected checks arrive at M08. */
  readonly expectedExitCode: number | null;
}

export interface GoalAdmissionInput {
  /** Requested target. Never sufficient authority; membership is rechecked. */
  readonly projectId: Uuid;
  /** Durable idempotency key chosen by the caller and reused on retry. */
  readonly requestId: Uuid;
  readonly fixtureId: string;
  readonly goalText: string;
  readonly requirements: readonly AcceptedRequirement[];
  readonly criteria: readonly AcceptedCriterion[];
}

export type AdmissionOutcomeKind = 'accepted' | 'pending' | 'rejected' | 'unknown';

export interface AcceptedAuthority {
  readonly projectId: Uuid;
  readonly graphEpoch: Uuid;
  readonly goalId: Uuid;
  readonly goalVersionId: Uuid;
  readonly goalRevision: number;
  readonly constraints: readonly AcceptedConstraintRef[];
  readonly criteria: readonly AcceptedCriterionRef[];
  readonly taskId: Uuid;
  readonly taskStateId: Uuid;
  readonly taskRevision: number;
  readonly taskStatus: string;
  readonly requirementRevision: number;
}

export interface AcceptedConstraintRef {
  readonly constraintId: Uuid;
  readonly versionId: Uuid;
  readonly revision: number;
  readonly field: string;
  readonly value: number;
  readonly sourceId: Uuid;
}

export interface AcceptedCriterionRef {
  readonly text: string;
  readonly criterionId: Uuid;
  readonly ref: string;
  readonly required: boolean;
}

export interface AdmissionReceipt {
  readonly kind: 'accepted';
  readonly requestId: Uuid;
  readonly requestDigest: string;
  /** Idempotent replay of an already committed receipt is reported as such. */
  readonly replayed: boolean;
  readonly graphEpoch: Uuid;
  readonly eventSeq: number;
  readonly graphReceiptId: Uuid;
  readonly sourceMessageId: Uuid;
  readonly authority: AcceptedAuthority;
}

export interface AdmissionPending {
  readonly kind: 'pending';
  readonly requestId: Uuid;
  readonly sourceMessageId: Uuid;
  readonly inboxId: Uuid;
  /**
   * True when the graph outcome could not be established. Dependent admission
   * stays blocked until a reconciliation resolves the original receipt.
   */
  readonly outcomeUnknown: boolean;
  readonly reason: string;
}

export interface AdmissionRejected {
  readonly kind: 'rejected';
  readonly requestId: Uuid;
  readonly code: string;
  readonly reason: string;
}

export type GoalAdmissionResult = AdmissionReceipt | AdmissionPending | AdmissionRejected;

/** Response of the authenticated current-authority read. */
export interface AuthorityView {
  readonly projectId: Uuid;
  readonly projectSlug: string;
  readonly graphKey: string;
  readonly graphEpoch: Uuid;
  readonly requirementRevision: number;
  readonly goalId: Uuid;
  readonly goalVersionId: Uuid;
  readonly goalRevision: number;
  readonly goalText: string;
  readonly sourceMessageIds: readonly Uuid[];
  readonly constraints: readonly AcceptedConstraintRef[];
  readonly criteria: readonly AcceptedCriterionRef[];
  readonly taskId: Uuid;
  readonly taskStateId: Uuid;
  readonly taskRevision: number;
  readonly taskStatus: string;
}

export interface PrincipalView {
  readonly userId: Uuid;
  readonly displayName: string;
  readonly tenantId: Uuid;
  readonly sessionId: Uuid;
  readonly expiresAt: string;
  readonly idleExpiresAt: string;
  readonly projects: readonly ProjectMembershipView[];
}

export interface ProjectMembershipView {
  readonly projectId: Uuid;
  readonly slug: string;
  readonly role: string;
  readonly graphEpoch: Uuid;
}

export interface AuthStatusView {
  readonly bootstrapped: boolean;
  readonly authenticated: boolean;
  readonly reason: string;
}

/** Reason codes used when a caller requests a receipt that does not exist yet. */
export const ADMISSION_NOT_FOUND_REASON = 'no committed admission exists for this request id';

/** Narrows an admission result to a committed receipt without a cast. */
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isGoalAdmissionInput(value: unknown): value is GoalAdmissionInput {
  return object(value) && isUuid(value.projectId) && isUuid(value.requestId) &&
    typeof value.fixtureId === 'string' && typeof value.goalText === 'string' &&
    Array.isArray(value.requirements) && value.requirements.length > 0 && value.requirements.length <= 32 &&
    value.requirements.every(r => object(r) && typeof r.field === 'string' && r.type === 'integer' &&
      [r.value,r.minimum,r.maximum,r.revision].every(Number.isSafeInteger)) &&
    Array.isArray(value.criteria) && value.criteria.length > 0 && value.criteria.length <= 64 &&
    value.criteria.every(c => object(c) && CRITERION_KINDS.includes(c.kind as CriterionKind) &&
      typeof c.ref === 'string' && typeof c.text === 'string' && typeof c.required === 'boolean' &&
      (c.expectedExitCode === null || Number.isSafeInteger(c.expectedExitCode)));
}
export function isAdmissionReceipt(value: unknown): value is AdmissionReceipt {
  if (!object(value) || value.kind !== 'accepted' || !isUuid(value.requestId) ||
      typeof value.requestDigest !== 'string' || typeof value.replayed !== 'boolean' ||
      !isUuid(value.graphEpoch) || !Number.isSafeInteger(value.eventSeq) ||
      !isUuid(value.graphReceiptId) || !isUuid(value.sourceMessageId) || !object(value.authority)) return false;
  return isAcceptedAuthority(value.authority);
}

function isAcceptedAuthority(a: unknown): a is AcceptedAuthority {
  if (!object(a)) return false;
  return ['projectId','graphEpoch','goalId','goalVersionId','taskId','taskStateId'].every(k => isUuid(a[k])) &&
    ['goalRevision','taskRevision','requirementRevision'].every(k => Number.isSafeInteger(a[k])) &&
    typeof a.taskStatus === 'string' && Array.isArray(a.constraints) && a.constraints.length > 0 &&
    a.constraints.every(c => object(c) && ['constraintId','versionId','sourceId'].every(k => isUuid(c[k])) &&
      Number.isSafeInteger(c.revision) && Number.isSafeInteger(c.value) && typeof c.field === 'string') &&
    Array.isArray(a.criteria) && a.criteria.length > 0 && a.criteria.every(c => object(c) &&
      isUuid(c.criterionId) && typeof c.ref === 'string' && typeof c.text === 'string' && typeof c.required === 'boolean');
}

/** Narrows an admission result to the pending/outcome-unknown shape. */
export function isAdmissionPending(value: unknown): value is AdmissionPending {
  return object(value) && value.kind === 'pending' && isUuid(value.requestId) &&
    isUuid(value.sourceMessageId) && isUuid(value.inboxId) &&
    typeof value.outcomeUnknown === 'boolean' && typeof value.reason === 'string';
}

export function isGoalAdmissionResult(value: unknown): value is GoalAdmissionResult {
  return isAdmissionReceipt(value) || isAdmissionPending(value) ||
    (object(value) && value.kind === 'rejected' && isUuid(value.requestId) &&
      typeof value.code === 'string' && typeof value.reason === 'string');
}

export function isAuthorityView(value: unknown): value is AuthorityView {
  return isAcceptedAuthority(value) && object(value) && typeof value.projectSlug === 'string' &&
    typeof value.graphKey === 'string' && typeof value.goalText === 'string' &&
    Array.isArray(value.sourceMessageIds) && value.sourceMessageIds.length > 0 && value.sourceMessageIds.every(isUuid);
}

export function isPrincipalView(value: unknown): value is PrincipalView {
  return object(value) && ['userId','tenantId','sessionId'].every(k=>isUuid(value[k])) &&
    typeof value.displayName === 'string' && typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt)) && typeof value.idleExpiresAt === 'string' &&
    Number.isFinite(Date.parse(value.idleExpiresAt)) && Array.isArray(value.projects) &&
    value.projects.every(p=>object(p) && isUuid(p.projectId) && isUuid(p.graphEpoch) &&
      typeof p.slug === 'string' && typeof p.role === 'string');
}

export function isUuid(value: unknown): value is Uuid {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}