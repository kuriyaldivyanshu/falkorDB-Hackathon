/**
 * Wire protocol identity and route table.
 *
 * Protocol v2 is the memory product's own protocol. There is no compatibility
 * subpath for the retired owned-execution protocol; a client either speaks v2
 * or is told the capability is unsupported.
 *
 * One definition per route: the service registers these paths and every client
 * builds them from the same constants, so a route cannot drift between the two
 * sides.
 */

export const PROTOCOL_VERSION = 2;

/** Every service route lives under this prefix except the health probe. */
export const API_PREFIX = '/v2';

export const ROUTES = {
  health: '/health',
  status: `${API_PREFIX}/status`,
  capabilities: `${API_PREFIX}/capabilities`,

  projects: `${API_PREFIX}/projects`,
  enrollments: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/enrollments`,
  enrollment: (projectId: string, enrollmentId: string): string => `${API_PREFIX}/projects/${projectId}/enrollments/${enrollmentId}`,
  enrollmentRevocation: (projectId: string, enrollmentId: string): string =>
    `${API_PREFIX}/projects/${projectId}/enrollments/${enrollmentId}/revocation`,
  readerCredentials: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/reader-credentials`,
  readerCredentialRevocation: (projectId: string, credentialId: string): string =>
    `${API_PREFIX}/projects/${projectId}/reader-credentials/${credentialId}/revocation`,
  projectGrants: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/grants`,
  projectSessions: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/sessions`,
  projectTasks: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/tasks`,
  projectJobs: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/jobs`,
  projectOperations: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/operations`,
  projectQueue: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/queue`,
  projectMemories: (projectId: string): string => `${API_PREFIX}/projects/${projectId}/memories`,

  workspaceBindings: `${API_PREFIX}/workspace-bindings`,
  nativeSessions: `${API_PREFIX}/native-sessions`,
  sessions: `${API_PREFIX}/sessions`,

  sources: `${API_PREFIX}/sources`,
  appendSources: `${API_PREFIX}/sources/append`,
  source: (sourceId: string): string => `${API_PREFIX}/sources/${sourceId}`,
  sourceRange: (sourceId: string): string => `${API_PREFIX}/sources/${sourceId}/range`,
  history: `${API_PREFIX}/history`,

  memories: `${API_PREFIX}/memories`,
  memoryProposals: `${API_PREFIX}/memories/proposals`,
  memoryEpisodes: `${API_PREFIX}/memories/episodes`,
  memory: (memoryId: string): string => `${API_PREFIX}/memories/${memoryId}`,
  memoryAccept: (memoryId: string): string => `${API_PREFIX}/memories/${memoryId}/acceptance`,
  memoryCorrections: (memoryId: string): string => `${API_PREFIX}/memories/${memoryId}/corrections`,

  tasks: `${API_PREFIX}/tasks`,
  task: (taskId: string): string => `${API_PREFIX}/tasks/${taskId}`,
  taskRequirements: (taskId: string): string => `${API_PREFIX}/tasks/${taskId}/requirements`,

  claims: `${API_PREFIX}/claims`,
  claim: (claimId: string): string => `${API_PREFIX}/claims/${claimId}`,
  claimStatus: `${API_PREFIX}/claims/status`,

  handoffs: `${API_PREFIX}/handoffs`,
  handoffAcceptance: (memoryId: string): string => `${API_PREFIX}/handoffs/${memoryId}/acceptance`,
  handoffRevocation: (memoryId: string): string => `${API_PREFIX}/handoffs/${memoryId}/revocation`,

  context: `${API_PREFIX}/context`,
  contextOccurrences: `${API_PREFIX}/context/occurrences`,

  operations: `${API_PREFIX}/operations`,
  operation: (operationId: string): string => `${API_PREFIX}/operations/${operationId}`,
  jobs: `${API_PREFIX}/jobs`,
  job: (jobId: string): string => `${API_PREFIX}/jobs/${jobId}`,
} as const;

/** Header carrying the bearer credential. The token never appears in a URL. */
export const AUTHORIZATION_HEADER = 'authorization';

/** Local-only guard header: the service is loopback and records the origin. */
export const CLIENT_KIND_HEADER = 'x-threadline-client';

/**
 * A uniform result envelope.
 *
 * Every route answers with either data or a typed safe error payload. The error
 * shape is the shared payload, so a client never has to parse a driver message.
 */
export interface ApiErrorEnvelope {
  readonly ok: false;
  readonly error: import('./errors.js').ThreadlineErrorPayload;
}

export interface ApiSuccessEnvelope<TData> {
  readonly ok: true;
  readonly data: TData;
}

/** Declarations only: no registration, handler or capability is enabled. V2
 * stays unchanged here. Future runtime adapters must apply the current release
 * gate to safe v2 reads and refuse unsafe v2 mutation/context requests. */
export const CONTRACT_PROTOCOL_VERSION_V3 = 3;
export const CONTRACT_API_PREFIX_V3 = '/v3';
export const CONTRACT_ROUTES_V3 = {
  captureEvents: `${CONTRACT_API_PREFIX_V3}/capture/events`,
  checkpoints: `${CONTRACT_API_PREFIX_V3}/checkpoints`,
  recall: `${CONTRACT_API_PREFIX_V3}/recall`,
  deliveryAck: (id: string): string => `${CONTRACT_API_PREFIX_V3}/deliveries/${id}/ack`,
  memories: `${CONTRACT_API_PREFIX_V3}/memories`,
  memory: (id: string): string => `${CONTRACT_API_PREFIX_V3}/memories/${id}`,
  memoryCorrections: (id: string): string => `${CONTRACT_API_PREFIX_V3}/memories/${id}/corrections`,
  memoryAcceptance: (id: string): string => `${CONTRACT_API_PREFIX_V3}/memories/${id}/acceptance`,
  memoryMarkers: (id: string): string => `${CONTRACT_API_PREFIX_V3}/memories/${id}/markers`,
  memoryVersions: (id: string): string => `${CONTRACT_API_PREFIX_V3}/memories/${id}/versions`,
  conflictResolution: (id: string): string => `${CONTRACT_API_PREFIX_V3}/conflicts/${id}/resolution`,
  shares: `${CONTRACT_API_PREFIX_V3}/shares`,
  handoffs: `${CONTRACT_API_PREFIX_V3}/handoffs`,
  graphNeighborhood: `${CONTRACT_API_PREFIX_V3}/graph/neighborhood`,
  timeline: `${CONTRACT_API_PREFIX_V3}/timeline`,
  sourceRange: (id: string): string => `${CONTRACT_API_PREFIX_V3}/sources/${id}/range`,
  policy: (projectId: string): string => `${CONTRACT_API_PREFIX_V3}/projects/${projectId}/policy`,
  deletions: `${CONTRACT_API_PREFIX_V3}/privacy/deletions`,
  deletion: (id: string): string => `${CONTRACT_API_PREFIX_V3}/privacy/deletions/${id}`,
  operation: (id: string): string => `${CONTRACT_API_PREFIX_V3}/operations/${id}`,
} as const;

/** Equality is over the full validated canonical request plus authenticated
 * tenant/project/principal and stored enrollment/session/stream binding. Include
 * visibility, source revision, sanitized outcome/content, hints, policy/privacy
 * guards, and all relevant metadata. Exclude only transport credentials. Compare
 * before reusing receipts; changed input refuses idempotency_mismatch. Never
 * deduplicate distinct observations by text, digest, cwd, hints or timestamps.
 * Current authorization/privacy gates apply before every replay. */
export const REQUEST_RETRY_SEMANTICS_V3 = 'scoped_canonical_request_equality' as const;
export const V2_TRANSITION_V3 = {
  safeReads: {
    method: 'GET',
    routes: ['health', 'projects', 'source', 'sourceRange', 'memory', 'task'] satisfies readonly (keyof typeof ROUTES)[],
    transport: 'validated_owner_socket',
    requires: ['current_scope_denial_dependency_permit', 'sanitizer_safe_representation', 'response_caps'],
    unrepresentableOutcome: 'unsupported_upgrade_required',
  },
  otherRoutes: 'unsupported_upgrade_required_before_content_work',
  oldTcpClients: 'transport_upgrade_required',
  mutations: 'unsupported_upgrade_required',
  context: 'unsupported_upgrade_required',
  runtimeImplemented: false,
} as const;
