import { randomUUID } from 'node:crypto';

import { ThreadlineError } from '@threadline/shared';

import type { RunPolicy } from '../runtime/contracts.js';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest, sha256Hex, type CanonicalValue } from './digest.js';
import type { SqlDatabase, TxClient } from './pg.js';

/**
 * Real execution identities: worker host, provider account/profile, registered
 * candidate workspace, Run and logical AgentSession.
 *
 * Every row here has real foreign keys. No table is written without its
 * parents, and nothing fabricates an id to satisfy a constraint: a missing
 * account or profile is reported, not invented.
 *
 * Sessions are **logical**: one in-process Builder inside the actual backend.
 * There is no child process per agent, so `launch_attempts.process_id` stays
 * null and nothing pretends to observe a PID it does not own.
 */

export interface HostRegistration {
  readonly hostId: string;
  readonly bootId: string;
  readonly allowedRoots: readonly string[];
  readonly capabilities: readonly string[];
}

export interface ProviderAccountView {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly label: string;
  readonly authRoute: string;
  /** A reference, never the key itself. */
  readonly secretRef: string | null;
  readonly probeStatus: string;
}

export interface ProviderProfileView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly providerAccountId: string;
  readonly name: string;
  readonly modelId: string;
  readonly configDigest: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface WorkspaceRegistration {
  readonly id: string;
  readonly hostId: string;
  readonly canonicalPath: string;
  readonly repositoryFingerprint: string;
  readonly kind: 'builder' | 'verifier' | 'fixture';
  readonly status: 'registered' | 'active' | 'quarantined' | 'retired';
}

export interface ExecutionRegistryDeps {
  readonly db: SqlDatabase;
  readonly clock: () => Date;
  readonly logger?: Logger;
}

export interface ExecutionRegistry {
  registerHost(params: {
    tenantId: string;
    userId: string;
    name: string;
    allowedRoots: readonly string[];
    capabilities: readonly string[];
  }): Promise<HostRegistration>;
  registerProviderAccount(params: {
    tenantId: string;
    userId: string;
    provider: string;
    runtime: string;
    authRoute: string;
    label: string;
    secretRef: string | null;
    probeStatus: string;
  }): Promise<ProviderAccountView>;
  registerProviderProfile(params: {
    tenantId: string;
    projectId: string;
    ownerUserId: string;
    providerAccountId: string;
    name: string;
    modelId: string;
    adapterVersion: string;
    settings: Readonly<Record<string, unknown>>;
  }): Promise<ProviderProfileView>;
  registerWorkspace(params: {
    tenantId: string;
    projectId: string;
    hostId: string;
    canonicalPath: string;
    repositoryFingerprint: string;
    kind: 'builder' | 'verifier' | 'fixture';
    /**
     * Optional human-facing name.
     *
     * Not persisted: `workspace_registrations` has no label column, and the core
     * schema is frozen for this milestone because the bootstrap is version- and
     * checksum-gated — adding a column would make every existing verification
     * store report `schema_incompatible`. The canonical path is the workspace's
     * identity; a label is display-only and is dropped rather than half-stored.
     */
    label?: string;
  }): Promise<WorkspaceRegistration>;
  createRun(params: {
    tenantId: string;
    projectId: string;
    initiatedBy: string;
    profileId: string;
    policy: RunPolicy;
  }): Promise<{ runId: string }>;
  createAgentSession(params: {
    tenantId: string;
    projectId: string;
    runId: string;
    taskGraphId: string;
    profileId: string;
    workspaceId: string;
    authorizationDigest: string;
    authorizationManifest: Readonly<Record<string, unknown>>;
  }): Promise<{ sessionId: string }>;
}

export function createExecutionRegistry(deps: ExecutionRegistryDeps): ExecutionRegistry {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock;

  return {
    async registerHost(params) {
      const hostId = randomUUID();
      const bootId = randomUUID();
      const now = clock();
      // A host credential digest, never a usable secret: the backend is local
      // and authenticates people, not hosts, over the wire at this milestone.
      const credentialHash = sha256Hex(`host:${hostId}:${now.toISOString()}`);
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      await deps.db.withTenantTransaction(params.tenantId, (tx) =>
        tx.rows(
          `INSERT INTO threadline.worker_hosts
             (tenant_id, id, user_id, name, credential_hash, credential_expires_at,
              boot_id, allowed_roots, capabilities, last_seen_at, revoked_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $10)`,
          [
            params.tenantId,
            hostId,
            params.userId,
            params.name,
            credentialHash,
            expiresAt,
            bootId,
            JSON.stringify(params.allowedRoots),
            JSON.stringify(params.capabilities),
            now,
          ],
        ),
      );
      return {
        hostId,
        bootId,
        allowedRoots: [...params.allowedRoots],
        capabilities: [...params.capabilities],
      };
    },

    async registerProviderAccount(params) {
      const id = randomUUID();
      const now = clock();
      await deps.db.withTenantTransaction(params.tenantId, (tx) =>
        tx.rows(
          `INSERT INTO threadline.provider_accounts
             (tenant_id, id, user_id, provider, runtime, auth_route, label,
              secret_ref, native_profile_ref, last_probe_at, probe_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, $9, $10)`,
          [
            params.tenantId,
            id,
            params.userId,
            params.provider,
            params.runtime,
            params.authRoute,
            params.label,
            params.secretRef,
            params.probeStatus,
            now,
          ],
        ),
      );
      return {
        id,
        userId: params.userId,
        provider: params.provider,
        label: params.label,
        authRoute: params.authRoute,
        secretRef: params.secretRef,
        probeStatus: params.probeStatus,
      };
    },

    async registerProviderProfile(params) {
      const id = randomUUID();
      const configDigest = canonicalDigest({
        modelId: params.modelId,
        adapterVersion: params.adapterVersion,
        settings: params.settings as CanonicalValue,
      });
      await deps.db.withTenantTransaction(params.tenantId, async (tx) => {
        await assertActiveProjectMember(tx, params.tenantId, params.projectId, params.ownerUserId);
        await tx.rows(
          `INSERT INTO threadline.provider_profiles
             (tenant_id, project_id, id, owner_user_id, provider_account_id, name,
              model_id, adapter_version, effort, settings, config_digest, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11)`,
          [
            params.tenantId,
            params.projectId,
            id,
            params.ownerUserId,
            params.providerAccountId,
            params.name,
            params.modelId,
            params.adapterVersion,
            JSON.stringify(params.settings),
            configDigest,
            clock(),
          ],
        );
      });
      return {
        id,
        ownerUserId: params.ownerUserId,
        providerAccountId: params.providerAccountId,
        name: params.name,
        modelId: params.modelId,
        configDigest,
        settings: params.settings,
      };
    },

    async registerWorkspace(params) {
      const id = randomUUID();
      await deps.db.withTenantTransaction(params.tenantId, async (tx) => {
        await assertHostActive(tx, params.tenantId, params.hostId);
        await tx.rows(
          `INSERT INTO threadline.workspace_registrations
             (tenant_id, project_id, id, host_id, canonical_path, repository_fingerprint,
              kind, status, base_commit, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'registered', NULL, $8)`,
          [
            params.tenantId,
            params.projectId,
            id,
            params.hostId,
            params.canonicalPath,
            params.repositoryFingerprint,
            params.kind,
            clock(),
          ],
        );
      });
      return {
        id,
        hostId: params.hostId,
        canonicalPath: params.canonicalPath,
        repositoryFingerprint: params.repositoryFingerprint,
        kind: params.kind,
        status: 'registered',
      };
    },

    async createRun(params) {
      const runId = randomUUID();
      const policyDigest = canonicalDigest(params.policy as unknown as CanonicalValue);
      const now = clock();
      try {
        await deps.db.withTenantTransaction(params.tenantId, (tx) =>
          tx.rows(
            `INSERT INTO threadline.runs
               (tenant_id, project_id, id, initiated_by, initial_profile_id, policy,
                policy_digest, observed_status, projected_epoch, projected_seq,
                created_at, finished_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'admitted', NULL, NULL, $8, NULL)`,
            [
              params.tenantId,
              params.projectId,
              runId,
              params.initiatedBy,
              params.profileId,
              JSON.stringify(params.policy),
              policyDigest,
              now,
            ],
          ),
        );
      } catch (error) {
        // The FK failure is the proof that ownership was not established.
        logger.log({
          level: 'warn',
          message: 'Run insert rejected; foreign keys must be satisfied by real identities.',
          fields: { errorName: error instanceof Error ? error.name : typeof error },
        });
        throw error;
      }
      return { runId };
    },

    async createAgentSession(params) {
      const sessionId = randomUUID();
      const now = clock();
      await deps.db.withTenantTransaction(params.tenantId, (tx) =>
        tx.rows(
          `INSERT INTO threadline.agent_sessions
             (tenant_id, project_id, id, run_id, task_graph_id, parent_session_id,
              profile_id, workspace_id, role, authorization_kind, authorization_manifest,
              authorization_digest, runtime_status, capture_seq, started_at, ended_at, created_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'builder', 'task_claim',
                   $8, $9, 'live', 0, $10, NULL, $10)`,
          [
            params.tenantId,
            params.projectId,
            sessionId,
            params.runId,
            params.taskGraphId,
            params.profileId,
            params.workspaceId,
            JSON.stringify(params.authorizationManifest),
            params.authorizationDigest,
            now,
          ],
        ),
      );
      return { sessionId };
    },
  };
}

async function assertActiveProjectMember(
  tx: TxClient,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const rows = await tx.rows<{ user_id: string }>(
    `SELECT user_id FROM threadline.project_memberships
      WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3 AND status = 'active'`,
    [tenantId, projectId, userId],
  );
  if (rows.length === 0) {
    throw new ThreadlineError('unauthorized', 'The registering human is not an active project member.');
  }
}

async function assertHostActive(
  tx: TxClient,
  tenantId: string,
  hostId: string,
): Promise<void> {
  const rows = await tx.rows<{ id: string }>(
    `SELECT id FROM threadline.worker_hosts
      WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
    [tenantId, hostId],
  );
  if (rows.length === 0) {
    throw new ThreadlineError('authority_conflict', 'The worker host is unknown or revoked.');
  }
}