import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ThreadlineError,
  type AuthorizedScope,
  type ClientTokenKind,
  type PrincipalKind,
  type ProjectRole,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { SqlDatabase } from '../storage/pg.js';

/**
 * Bearer authentication and scope resolution.
 *
 * A credential is a random opaque token; only its SHA-256 hash is stored. The
 * lookup runs through the narrow `token_lookup` security-definer function,
 * because a token must resolve its tenant *before* any tenant context can be
 * set. Everything after that lookup is ordinary fenced SQL.
 *
 * Authorization is never derived from the request body: a supplied project id
 * is a requested target that must match the credential's stored scope.
 */

export const CLIENT_TOKEN_PREFIX = 'tl_';

/** Human administrator tokens are local and long-lived. */
export const HUMAN_ADMIN_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const HUMAN_ADMIN_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Producer tokens are narrower and shorter-lived; hooks refresh them via enrollment. */
export const PRODUCER_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
export const PRODUCER_TOKEN_IDLE_MS = 12 * 60 * 60 * 1000;

export function generateClientToken(): string {
  return `${CLIENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashClientToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newClientTokenId(): string {
  return randomUUID();
}

/** Exactly what the lookup function returns; nothing else is read. */
interface TokenLookupRow {
  readonly token_id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly principal_kind: PrincipalKind;
  readonly display_label: string;
  readonly project_id: string | null;
  readonly token_kind: ClientTokenKind;
  readonly scopes: string[] | null;
  readonly enrollment_id: string | null;
  readonly binding_generation: number;
  readonly native_session_id: string | null;
  readonly mcp_instance_id: string | null;
  readonly expires_at: Date;
  readonly idle_expires_at: Date;
  readonly revoked_at: Date | null;
  readonly project_state: string | null;
  readonly project_policy_state: string | null;
  readonly graph_key: string | null;
  readonly graph_epoch: string | null;
  readonly privacy_revision: string | null;
  readonly token_active: boolean;
  readonly principal_active: boolean;
  readonly grant_role: ProjectRole | null;
}

export interface AuthenticatedCall {
  readonly scope: AuthorizedScope;
  readonly tokenId: string;
  readonly displayLabel: string;
  readonly enrollmentId: string | null;
  readonly mcpInstanceId: string | null;
}

export interface AuthenticateTarget {
  /** A requested project. The stored scope decides whether it is permitted. */
  readonly projectId?: string | null;
  /** Tenant-level calls (project association) do not require a grant. */
  readonly allowTenantLevel?: boolean;
}

export interface AuthService {
  authenticate(authorization: string | null | undefined, target?: AuthenticateTarget): Promise<AuthenticatedCall>;
}

export interface AuthServiceDeps {
  readonly db: SqlDatabase;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

export function readBearerToken(authorization: string | null | undefined): string {
  if (authorization === null || authorization === undefined) {
    throw new ThreadlineError('unauthorized', 'A bearer credential is required.');
  }
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());
  if (match === null || (match[1] ?? '').trim().length === 0) {
    throw new ThreadlineError('unauthorized', 'The authorization header is not a bearer credential.');
  }
  return (match[1] ?? '').trim();
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  return {
    async authenticate(
      authorization: string | null | undefined,
      target: AuthenticateTarget = {},
    ): Promise<AuthenticatedCall> {
      const token = readBearerToken(authorization);
      const rows = await deps.db.query<TokenLookupRow>(
        'SELECT * FROM threadline_memory.token_lookup($1)',
        [hashClientToken(token)],
      );
      const row = rows[0];
      if (row === undefined || !row.token_active || !row.principal_active || row.revoked_at !== null) {
        throw new ThreadlineError('unauthorized', 'The credential is not active.');
      }
      const now = clock();
      if (row.expires_at.getTime() <= now.getTime() || row.idle_expires_at.getTime() <= now.getTime()) {
        throw new ThreadlineError('unauthorized', 'The credential has expired.');
      }

      const requested = target.projectId ?? null;
      const tokenProject = row.project_id;
      let projectId: string | null;
      if (row.token_kind === 'producer' || row.token_kind === 'reader') {
        if (tokenProject === null) throw new ThreadlineError('scope_denied', 'This credential requires a stored project binding.');
        // Producer and reader credentials are bound to exactly one project; neither can be
        // pointed at a different one by a request.
        projectId = tokenProject;
        if (requested !== null && requested !== tokenProject) {
          throw new ThreadlineError('scope_denied', 'The credential is bound to a different project.');
        }
      } else {
        // A human credential may request any project it holds a grant on, but a
        // project-bound credential still cannot be pointed elsewhere.
        if (tokenProject !== null && requested !== null && requested !== tokenProject) {
          throw new ThreadlineError('scope_denied', 'The credential is bound to a different project.');
        }
        projectId = requested ?? tokenProject;
      }

      // The lookup resolves the token's own project. A requested project that
      // differs is a tenant-level credential acting on one project: its grant and
      // routing facts are resolved here, under the tenant the token supplied.
      let role: ProjectRole | null = row.grant_role;
      let projectState = row.project_state;
      let projectPolicyState = row.project_policy_state;
      let graphKey = row.graph_key;
      let graphEpoch = row.graph_epoch;
      let privacyRevision = row.privacy_revision;
      if (projectId !== null && projectId !== tokenProject) {
        const facts = await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
          tx.rows<{
            state: string;
            policy_state: string;
            graph_key: string;
            graph_epoch: string;
            privacy_revision: string;
            role: ProjectRole | null;
          }>(
            `SELECT pr.state, pr.policy_state, pr.graph_key, pr.graph_epoch,
                    pr.privacy_revision::text AS privacy_revision, g.role
               FROM threadline_memory.projects pr
               LEFT JOIN threadline_memory.project_grants g
                 ON g.tenant_id = pr.tenant_id AND g.project_id = pr.id
                AND g.principal_id = $3 AND g.state = 'active'
              WHERE pr.tenant_id = $1 AND pr.id = $2`,
            [row.tenant_id, projectId, row.principal_id],
          ),
        );
        const found = facts[0];
        role = found?.role ?? null;
        projectState = found?.state ?? null;
        projectPolicyState = found?.policy_state ?? null;
        graphKey = found?.graph_key ?? null;
        graphEpoch = found?.graph_epoch ?? null;
        privacyRevision = found?.privacy_revision ?? null;
      }

      if (projectId !== null) {
        if (row.token_kind === 'reader' && (row.principal_kind !== 'service' || role !== 'reader' ||
            row.enrollment_id !== null || row.native_session_id !== null)) {
          throw new ThreadlineError('scope_denied', 'The reader credential has an invalid stored access binding.');
        }
        if (role === null) {
          throw new ThreadlineError('scope_denied', 'The credential has no active grant for that project.');
        }
        if (projectState !== 'active') {
          throw new ThreadlineError('service_unavailable', 'The project is not accepting operations.');
        }
        if (projectPolicyState === 'blocked') {
          throw new ThreadlineError('deleting', 'Project memory is blocked while its policy changes.');
        }
      } else if (target.allowTenantLevel !== true) {
        throw new ThreadlineError('invalid_request', 'This operation requires a project scope.');
      }

      // Producer liveness is tracked so an abandoned enrollment expires; the
      // update is fenced by the tenant that the token just resolved.
      if (row.token_kind === 'producer') {
        const idleUntil = new Date(now.getTime() + PRODUCER_TOKEN_IDLE_MS);
        await deps.db.withTenantTransaction(row.tenant_id, (tx) =>
          tx.rows(
            `UPDATE threadline_memory.client_tokens
                SET last_seen_at = $3, idle_expires_at = $4
              WHERE tenant_id = $1 AND id = $2 AND state = 'active'`,
            [row.tenant_id, row.token_id, now, idleUntil],
          ),
        );
      }

      logger.log({
        level: 'debug',
        message: 'Authenticated a client call.',
        fields: { principalKind: row.principal_kind, clientKind: row.token_kind, projectBound: projectId !== null },
      });

      return {
        tokenId: row.token_id,
        displayLabel: row.display_label,
        enrollmentId: row.enrollment_id,
        mcpInstanceId: row.mcp_instance_id,
        scope: {
          tenantId: row.tenant_id,
          principalId: row.principal_id,
          principalKind: row.principal_kind,
          projectId,
          role,
          tokenKind: row.token_kind,
          graphKey: projectId === null ? null : graphKey,
          graphEpoch: projectId === null ? null : graphEpoch,
          privacyRevision: projectId === null ? null : privacyRevision,
          nativeSessionId: row.native_session_id,
        },
      };
    },
  };
}
