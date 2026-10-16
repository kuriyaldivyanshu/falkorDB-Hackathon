/**
 * M05 operation-capability metadata.
 *
 * Capability metadata answers one question: *for this authenticated caller in
 * this project, what can I ask the backend to do right now?* It exists so a
 * client can build a command list, completion and help without discovering
 * support by provoking a 404.
 *
 * Five rules make it trustworthy, and each is a decision rather than a
 * convention:
 *
 * **Capabilities never authorize.** Metadata says an operation exists and what
 * state it needs; every call still re-resolves membership, ownership, revision
 * and Source access server-side. A client that treats `available: true` as
 * permission is wrong, and the backend is built so that being wrong is harmless.
 *
 * **Nothing secret appears.** No key, no secret reference, no token, no path,
 * and no metadata about a project or Source the caller may not see. The
 * response is built from the caller's own scope.
 *
 * **Implemented and available are different.** An operation can exist and still
 * be unavailable *now* because a lifecycle state is missing. Collapsing the two
 * would force a client to infer current state from a refusal.
 *
 * **Unavailability is typed and actionable.** A reason code is published so a
 * client can say what would make the operation usable, rather than "not
 * supported".
 *
 * **Routes are published here, not invented by clients.** A command spelling
 * does not mint a URL; the operation catalogue below is the single source of
 * truth for both.
 */

import { PROTOCOL_VERSION } from './protocol.js';

/**
 * The protocol version these capabilities describe.
 *
 * Re-published rather than re-declared so a client reading a capability response
 * cannot disagree with the backend about which protocol it is speaking.
 */
export const CAPABILITY_PROTOCOL_VERSION = PROTOCOL_VERSION;

/** Bumped when the capability response shape changes incompatibly. */
export const CAPABILITY_SCHEMA_VERSION = 1;

/**
 * Stable operation identifiers.
 *
 * These are what a client binds to. The slash-command spelling a human types is
 * a UI concern owned by Agent B; it never becomes an operation identity here.
 */
export const OPERATION_IDS = [
  'help',
  'status',
  'session',
  'connect',
  'model.list',
  'model.select',
  'input.submit',
  'init',
  'admit.preview',
  'admit.accept',
  'task.inspect',
  'run.prepare',
  'run.start',
  'run.inspect',
  'run.cancel',
  'tactical.inspect',
  'checkpoint.submit',
  'plan.patch',
  'recover',
  'context.refresh',
  'context.inspect',
  'context.compact',
  'memory.search',
  'source.inspect',
  'source.range',
  'history.list',
  'history.replay',
] as const;

export type OperationId = (typeof OPERATION_IDS)[number];

/**
 * Published route bindings.
 *
 * A value of `null` means the operation is catalogued but has no transport
 * binding yet. That is a real, visible state: the capability report will show
 * the operation as unavailable with a `not_implemented` reason rather than
 * pretending it exists.
 */
export const OPERATION_ROUTES: Readonly<Record<OperationId, string | null>> = {
  help: null,
  status: '/healthz',
  session: '/auth/session',
  connect: '/providers/settings',
  'model.list': '/projects/:projectId/models',
  'model.select': '/projects/:projectId/models/select',
  'input.submit': '/projects/:projectId/input',
  init: '/auth/status',
  'admit.preview': '/projects/:projectId/admissions/:requestId',
  'admit.accept': '/commands',
  'task.inspect': '/projects/:projectId/authority',
  'run.prepare': '/runs/prepare',
  'run.start': '/runs/start',
  'run.cancel': '/runs/cancel',
  'run.inspect': '/runs/:runId',
  'tactical.inspect': '/projects/:projectId/tasks/:taskId/checkpoints/current',
  'checkpoint.submit': '/projects/:projectId/tasks/:taskId/checkpoints',
  'plan.patch': '/projects/:projectId/tasks/:taskId/checkpoints',
  recover: '/projects/:projectId/tasks/:taskId/checkpoints/recover',
  'context.refresh': '/projects/:projectId/tasks/:taskId/context/refresh',
  'context.inspect': '/projects/:projectId/tasks/:taskId/context',
  'context.compact': '/projects/:projectId/tasks/:taskId/context/compact',
  'memory.search': '/projects/:projectId/tasks/:taskId/context/search',
  'source.inspect': '/projects/:projectId/sources/:sourceId',
  'source.range': '/projects/:projectId/sources/:sourceId/range',
  'history.list': '/projects/:projectId/history/events',
  'history.replay': '/projects/:projectId/history/replay',
};

/**
 * Whether an operation can be invoked without a project, with a project, or
 * only inside a live run. Used by clients to decide what to ask for, never to
 * decide whether a call is permitted.
 */
export type OperationScopeKind = 'local' | 'project' | 'run';

/**
 * What kind of effect an operation has.
 *
 * `inference_admitting` is the one a client must be careful with: it can cause a
 * paid provider request, so it is never implied by another operation.
 */
export type OperationEffect = 'read_only' | 'mutating' | 'inference_admitting';

/**
 * Lifecycle state an operation needs before it can be available.
 *
 * Published so a client can explain *why* something is unavailable rather than
 * only that it is.
 */
export const REQUIRED_LIFECYCLE = [
  'authenticated',
  'project_member',
  'project_admitted',
  'run_active',
  'profile_configured',
] as const;

export type RequiredLifecycle = (typeof REQUIRED_LIFECYCLE)[number];

/**
 * Typed unavailability reasons.
 *
 * Each carries the lifecycle that would resolve it, so the client can offer the
 * next real step instead of a dead end.
 */
export const UNAVAILABILITY_REASONS = [
  'not_implemented',
  'unauthenticated',
  'not_a_project_member',
  'no_admitted_task',
  'no_configured_profile',
  'no_active_run',
  'active_run_conflict',
  'unresolved_effects',
  'stale_revision',
] as const;

export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

export interface UnavailabilityDetail {
  readonly reason: UnavailabilityReason;
  /** The lifecycle state that would make the operation usable. */
  readonly resolvesWith: RequiredLifecycle | null;
  /** Nonsecret, caller-facing explanation. Never contains internal detail. */
  readonly message: string;
}

/**
 * Limits that apply to an operation.
 *
 * Declared rather than discovered at call time so a client can bound its own
 * inputs. They are the enforced policy, not suggestions.
 */
export interface OperationLimits {
  /** Maximum items the operation will return in one call. */
  readonly maxItems?: number;
  /** Maximum bytes of Source content one read may return. */
  readonly maxBytes?: number;
  /** Maximum entries a client may append in one request. */
  readonly maxEntries?: number;
  /** Maximum characters of free text accepted. */
  readonly maxTextChars?: number;
}

export interface OperationCapability {
  readonly operationId: OperationId;
  /** Whether the operation exists in this build at all. */
  readonly implemented: boolean;
  /** Whether it can be invoked for this caller, in this project, right now. */
  readonly available: boolean;
  readonly scope: OperationScopeKind;
  readonly effect: OperationEffect;
  /** Present when `implemented` is true. */
  readonly method?: 'GET' | 'POST';
  /** Present when `implemented` is true. Never contains a query string. */
  readonly path?: string;
  /** Present when the operation needs lifecycle state to be available. */
  readonly requires?: readonly RequiredLifecycle[];
  /** Present when `available` is false and the operation is implemented. */
  readonly unavailability?: UnavailabilityDetail;
  readonly limits?: OperationLimits;
  /** Which milestone shipped it, so `/help all` can label planned work. */
  readonly milestone?: string;
}

/**
 * The whole capability response, resolved for one authenticated caller.
 *
 * `projectId` is echoed because it is the caller's own selection; it is never
 * used to widen scope.
 */
export interface CapabilityReport {
  readonly schemaVersion: number;
  readonly protocolVersion: number;
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly operations: readonly OperationCapability[];
  /**
   * Observations about the caller that explain several unavailabilities at
   * once, such as "no task is admitted". Never contains credentials.
   */
  readonly observations: {
    readonly authenticated: boolean;
    readonly isProjectMember: boolean;
    readonly hasAdmittedTask: boolean;
    readonly hasConfiguredProfile: boolean;
    readonly hasActiveRun: boolean;
    readonly unresolvedEffects: number;
  };
}

export const CAPABILITY_ROUTE = '/capabilities';

/**
 * Resolves the capability metadata for one operation.
 *
 * Kept here, not in the backend, so the catalogue that produces a report is
 * inspectable in one place and a client can reason about the same catalogue
 * without a round trip for purely local decisions.
 */
export const OPERATION_CATALOGUE: readonly {
  readonly operationId: OperationId;
  readonly scope: OperationScopeKind;
  readonly effect: OperationEffect;
  readonly requires: readonly RequiredLifecycle[];
  readonly method: 'GET' | 'POST';
  readonly limits?: OperationLimits;
  readonly milestone: string;
}[] = [
  { operationId: 'help', scope: 'local', effect: 'read_only', requires: [], method: 'GET', milestone: 'M05' },
  { operationId: 'status', scope: 'local', effect: 'read_only', requires: [], method: 'GET', milestone: 'M02' },
  { operationId: 'session', scope: 'local', effect: 'read_only', requires: ['authenticated'], method: 'GET', milestone: 'M05' },
  { operationId: 'connect', scope: 'local', effect: 'mutating', requires: ['authenticated'], method: 'POST', milestone: 'M04' },
  {
    operationId: 'model.list', scope: 'project', effect: 'read_only',
    requires: ['authenticated'], method: 'GET',
    limits: { maxItems: 100 }, milestone: 'M05',
  },
  {
    operationId: 'model.select', scope: 'project', effect: 'mutating',
    requires: ['authenticated'], method: 'POST', milestone: 'M05',
  },
  {
    operationId: 'input.submit', scope: 'project', effect: 'mutating',
    requires: ['project_admitted'], method: 'POST',
    limits: { maxTextChars: 8000 }, milestone: 'M05',
  },
  { operationId: 'init', scope: 'local', effect: 'read_only', requires: [], method: 'GET', milestone: 'M01' },
  { operationId: 'admit.preview', scope: 'project', effect: 'read_only', requires: ['authenticated'], method: 'GET', milestone: 'M01' },
  { operationId: 'admit.accept', scope: 'project', effect: 'mutating', requires: ['project_member'], method: 'POST', milestone: 'M01' },
  { operationId: 'task.inspect', scope: 'project', effect: 'read_only', requires: ['project_admitted'], method: 'GET', milestone: 'M01' },
  { operationId: 'run.prepare', scope: 'project', effect: 'mutating', requires: ['profile_configured'], method: 'POST', milestone: 'M02' },
  { operationId: 'run.start', scope: 'project', effect: 'inference_admitting', requires: ['profile_configured'], method: 'POST', milestone: 'M02' },
  { operationId: 'run.inspect', scope: 'run', effect: 'read_only', requires: ['project_admitted'], method: 'GET', milestone: 'M02' },
  { operationId: 'run.cancel', scope: 'run', effect: 'mutating', requires: ['project_admitted'], method: 'POST', milestone: 'M02' },
  {
    operationId: 'tactical.inspect', scope: 'project', effect: 'read_only',
    requires: ['project_admitted'], method: 'GET', milestone: 'M04',
  },
  {
    operationId: 'checkpoint.submit', scope: 'project', effect: 'mutating',
    requires: ['project_admitted'], method: 'POST',
    limits: { maxTextChars: 2000, maxEntries: 8 }, milestone: 'M04',
  },
  {
    operationId: 'plan.patch', scope: 'project', effect: 'mutating',
    requires: ['project_admitted'], method: 'POST',
    limits: { maxEntries: 8, maxTextChars: 300 }, milestone: 'M04',
  },
  {
    operationId: 'recover', scope: 'project', effect: 'mutating',
    requires: ['project_admitted'], method: 'POST',
    limits: { maxItems: 1000 }, milestone: 'M04',
  },
  { operationId: 'context.refresh', scope: 'project', effect: 'mutating', requires: ['project_admitted'], method: 'POST', milestone: 'M05' },
  { operationId: 'context.inspect', scope: 'project', effect: 'read_only', requires: ['project_admitted'], method: 'GET', milestone: 'M05' },
  { operationId: 'context.compact', scope: 'project', effect: 'mutating', requires: ['project_admitted'], method: 'POST', milestone: 'M05' },
  {
    operationId: 'memory.search', scope: 'project', effect: 'read_only',
    requires: ['project_admitted'], method: 'POST',
    limits: { maxItems: 30, maxTextChars: 1000 }, milestone: 'M05',
  },
  {
    operationId: 'source.inspect', scope: 'project', effect: 'read_only',
    requires: ['authenticated'], method: 'GET', milestone: 'M03',
  },
  {
    operationId: 'source.range', scope: 'project', effect: 'read_only',
    requires: ['authenticated'], method: 'GET',
    limits: { maxBytes: 32768 }, milestone: 'M03',
  },
  {
    operationId: 'history.list', scope: 'project', effect: 'read_only',
    requires: ['project_admitted'], method: 'GET',
    limits: { maxItems: 100 }, milestone: 'M03',
  },
  {
    operationId: 'history.replay', scope: 'project', effect: 'read_only',
    requires: ['project_admitted'], method: 'GET',
    limits: { maxItems: 100 }, milestone: 'M03',
  },
];
