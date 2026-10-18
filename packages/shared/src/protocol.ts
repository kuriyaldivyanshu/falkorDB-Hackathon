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
