import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ThreadlineError, type ProjectMembershipView } from '@threadline/shared';

import type { LocalIdentityConfig } from '../config.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { sha256Hex } from './digest.js';
import type { SqlDatabase } from './pg.js';

/**
 * Local owner identity and application sessions.
 *
 * The local model is deliberately small: one OS-owner-protected bootstrap
 * creates one user, one tenant, one project and one application session. There
 * is no registration, no password and no remote identity provider.
 *
 * The raw bearer token exists in exactly two places — the owner-only file this
 * module writes, and the caller's memory. Only its SHA-256 hex digest is stored
 * in SQL, and the token is never logged, never returned in an HTTP response and
 * never placed in a URL.
 */

export const SESSION_TOKEN_BYTES = 32;

export interface LocalBootstrap {
  readonly tenantId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly graphKey: string;
  readonly graphEpoch: string;
  readonly sessionId: string;
  readonly sessionTokenPath: string;
}

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly displayName: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date;
}

export interface IdentityDeps {
  readonly db: SqlDatabase;
  readonly local: LocalIdentityConfig;
  readonly dataDirectory: string;
  readonly clock: () => Date;
  readonly logger?: Logger;
}

/** Backend-only graph key. Never derived from, or accepted by, a request body. */
export function deriveGraphKey(projectId: string): string {
  return `threadline:project:${projectId}`;
}

export const SESSION_TOKEN_FILENAME = 'session.json';

interface SessionTokenFile {
  readonly session_id: string;
  readonly token: string;
  readonly created_at: string;
}

/**
 * Creates the local owner, tenant, project and first session, then writes the
 * owner-only credential file. Idempotent: a second call returns the existing
 * identities without minting a new token.
 */
export async function bootstrapLocalOwner(deps: IdentityDeps): Promise<LocalBootstrap> {
  const logger = deps.logger ?? silentLogger;
  assertOsOwner(deps.dataDirectory);

  const existing = await readBootstrapFromSql(deps.db, deps.local, deps.dataDirectory);
  if (existing !== null) {
    const path = existing.sessionTokenPath;
    let stats;
    try { stats = lstatSync(path); } catch {
      throw new ThreadlineError('service_unavailable','The owner credential is missing. Restore the original private session file; automatic identity replacement is disabled.');
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.uid !== process.getuid!() || (stats.mode & 0o077) !== 0)
      throw new ThreadlineError('service_unavailable','The owner credential must be an owner-only regular file (0600).');
    let file: unknown;
    try { file = JSON.parse(readFileSync(path,'utf8')); } catch { throw new ThreadlineError('service_unavailable','The owner credential is invalid.'); }
    if (typeof file !== 'object' || file === null || !('token' in file) || typeof file.token !== 'string')
      throw new ThreadlineError('service_unavailable','The owner credential has no token.');
    const token = file.token;
    const sessions = await deps.db.withTenantTransaction(existing.tenantId, tx => tx.rows<{id:string}>(
      'SELECT id FROM threadline.user_sessions WHERE user_id=$1 AND token_hash=$2',[existing.userId,sha256Hex(token)]));
    if (!sessions[0]) throw new ThreadlineError('service_unavailable','The owner credential does not match this database.');
    return {...existing,sessionId:sessions[0].id};
  }

  const now = deps.clock();
  const tenantId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const membershipId = randomUUID();
  const projectMembershipId = randomUUID();
  const sessionId = randomUUID();
  const graphKey = deriveGraphKey(projectId);
  const graphEpoch = randomUUID();
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const tokenHash = sha256Hex(token);

  const absoluteExpiry = new Date(now.getTime() + deps.local.absoluteExpiryMs);
  const idleExpiry = new Date(now.getTime() + deps.local.idleExpiryMs);

  // The fence must be established inside the same transaction: FORCE row-level
  // security applies to the owner too, so an unfenced insert into a scoped
  // table is rejected.
  await deps.db.withTenantTransaction(tenantId, async (client) => {
    await client.rows(
      `INSERT INTO threadline.users (id, display_name, status, created_at)
       VALUES ($1, $2, 'active', $3)`,
      [userId, deps.local.userDisplayName, now],
    );
    await client.rows(
      `INSERT INTO threadline.tenants (id, slug, name, status, created_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [tenantId, deps.local.tenantSlug, deps.local.tenantName, now],
    );
    await client.rows(
      `INSERT INTO threadline.tenant_memberships (tenant_id, id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4)`,
      [tenantId, membershipId, userId, now],
    );
    await client.rows(
      `INSERT INTO threadline.projects (tenant_id, id, slug, graph_key, graph_epoch, status, schema_version, created_at)
       VALUES ($1, $2, $3, $4, $5, 'ready', 1, $6)`,
      [tenantId, projectId, deps.local.projectSlug, graphKey, graphEpoch, now],
    );
    await client.rows(
      `INSERT INTO threadline.project_memberships (tenant_id, project_id, id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, $4, 'owner', 'active', $5)`,
      [tenantId, projectId, projectMembershipId, userId, now],
    );
    await client.rows(
      `INSERT INTO threadline.user_sessions
         (tenant_id, id, user_id, token_hash, auth_method, created_at, last_seen_at,
          expires_at, idle_expires_at, revoked_at, client_label)
       VALUES ($1, $2, $3, $4, 'local_bootstrap', $5, $5, $6, $7, NULL, $8)`,
      [tenantId, sessionId, userId, tokenHash, now, absoluteExpiry, idleExpiry, 'local-terminal'],
    );
  });

  const sessionTokenPath = writeSessionTokenFile(deps.dataDirectory, {
    session_id: sessionId,
    token,
    created_at: now.toISOString(),
  });

  logger.log({
    level: 'info',
    message: 'Local owner bootstrap completed.',
    fields: { tenantId, userId, projectId, sessionFilePath: sessionTokenPath },
  });

  return {
    tenantId,
    userId,
    projectId,
    projectSlug: deps.local.projectSlug,
    graphKey,
    graphEpoch,
    sessionId,
    sessionTokenPath,
  };
}

/**
 * Resolves the local identities when they already exist.
 *
 * `projects` is tenant-scoped with FORCE row-level security, so the tenant is
 * resolved first and the project lookup runs fenced. An unfenced read would see
 * nothing and bootstrap would try to create the identities a second time.
 */
async function readBootstrapFromSql(
  db: SqlDatabase,
  local: LocalIdentityConfig,
  dataDirectory: string,
): Promise<LocalBootstrap | null> {
  const tenantRows = await db.query<{ id: string }>(
    'SELECT id FROM threadline.tenants WHERE slug = $1 LIMIT 1',
    [local.tenantSlug],
  );
  const tenant = tenantRows[0];
  if (tenant === undefined) {
    return null;
  }
  const rows = await db.withTenantTransaction(tenant.id, (client) =>
    client.rows<{
      tenant_id: string;
      user_id: string;
      project_id: string;
      slug: string;
      graph_key: string;
      graph_epoch: string;
      session_id: string | null;
    }>(
      `SELECT p.tenant_id, u.id AS user_id, p.id AS project_id, p.slug,
              p.graph_key, p.graph_epoch, s.id AS session_id
         FROM threadline.projects p
         JOIN threadline.project_memberships pm
           ON pm.project_id = p.id AND pm.tenant_id = p.tenant_id
         JOIN threadline.users u ON u.id = pm.user_id
         LEFT JOIN threadline.user_sessions s
                ON s.tenant_id = p.tenant_id AND s.user_id = pm.user_id
        WHERE p.slug = $1 AND pm.role = 'owner' AND pm.status = 'active' AND u.status = 'active'
        LIMIT 1`,
      [local.projectSlug],
    ),
  );
  const row = rows[0];
  if (row === undefined || row.session_id === null) {
    throw new ThreadlineError('service_unavailable','The existing tenant has no usable local owner/project/session bootstrap. Automatic duplicate enrollment is disabled.');
  }
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    projectId: row.project_id,
    projectSlug: row.slug,
    graphKey: row.graph_key,
    graphEpoch: row.graph_epoch,
    sessionId: row.session_id,
    sessionTokenPath: join(dataDirectory, SESSION_TOKEN_FILENAME),
  };
}

/**
 * Resolves a bearer token to a live principal.
 *
 * Idle expiry slides on use but can never extend the absolute lifetime: the
 * stored `expires_at` is never rewritten. Revocation and both expiries are
 * checked here, in the service, never inferred from loopback reachability.
 */
export async function authenticateSession(
  db: SqlDatabase,
  token: string,
  now: Date,
  idleExpiryMs = 30 * 60 * 1000,
): Promise<AuthenticatedPrincipal> {
  const tokenHash = sha256Hex(token);
  // Resolved through the narrow SECURITY DEFINER function because the tenant
  // is not yet known at this point; every later read runs fenced.
  const rows = await db.query<{
    session_id: string;
    user_id: string;
    display_name: string;
    tenant_id: string;
    tenant_slug: string;
    expires_at: Date;
    idle_expires_at: Date;
  }>('SELECT * FROM threadline.session_by_token_hash($1)', [tokenHash]);
  const row = rows[0];
  if (row === undefined) {
    throw new ThreadlineError('unauthorized', 'The session token is not recognised.');
  }
  if (row.expires_at.getTime() <= now.getTime()) {
    throw new ThreadlineError('unauthorized', 'The session has reached its absolute expiry.', {
      reason: 'absolute_expired',
    });
  }
  if (row.idle_expires_at.getTime() <= now.getTime()) {
    throw new ThreadlineError('unauthorized', 'The session has been idle too long.', {
      reason: 'idle_expired',
    });
  }

  const updated = await db.withTenantTransaction(row.tenant_id, client => client.rows<{idle_expires_at:Date}>(
    `UPDATE threadline.user_sessions SET last_seen_at=$1,idle_expires_at=LEAST(expires_at,$3)
     WHERE id=$2 AND revoked_at IS NULL AND expires_at>$1 AND idle_expires_at>$1 RETURNING idle_expires_at`,
    [now,row.session_id,new Date(now.getTime()+idleExpiryMs)]));
  if (!updated[0]) throw new ThreadlineError('unauthorized','The session expired or was revoked.');

  return {
    userId: row.user_id,
    displayName: row.display_name,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    idleExpiresAt: updated[0].idle_expires_at,
  };
}


export async function revokeSession(
  db: SqlDatabase,
  tenantId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  const updated = await db.withTenantTransaction(tenantId, (client) =>
    client.rows<{ id: string }>(
      `UPDATE threadline.user_sessions SET revoked_at = $1
        WHERE id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [now, sessionId],
    ),
  );
  return updated.length > 0;
}

/**
 * Confirms the caller is an active member of the project.
 *
 * A caller-supplied `projectId` is a requested target. Membership, tenant and
 * project status are what actually authorise the operation, so this lookup is
 * never skipped for a "local" request.
 */
export async function requireProjectMembership(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<{
  tenantId: string;
  projectId: string;
  graphKey: string;
  graphEpoch: string;
  slug: string;
  role: string;
}> {
  const found = await db.withTenantTransaction(tenantId, (client) =>
    client.rows<{
      project_id: string;
      graph_key: string;
      graph_epoch: string;
      slug: string;
      role: string;
    }>(
      `SELECT p.id AS project_id, p.graph_key, p.graph_epoch, p.slug, pm.role
         FROM threadline.projects p
         JOIN threadline.project_memberships pm
           ON pm.project_id = p.id AND pm.tenant_id = p.tenant_id
        WHERE p.id = $1 AND pm.user_id = $2 AND pm.status = 'active' AND p.status = 'ready'
        LIMIT 1`,
      [projectId, userId],
    ),
  );
  const row = found[0];
  if (row === undefined) {
    throw new ThreadlineError('unauthorized', 'The caller is not an active member of that project.', {
      reason: 'not_a_member',
    });
  }
  return {
    tenantId,
    projectId: row.project_id,
    graphKey: row.graph_key,
    graphEpoch: row.graph_epoch,
    slug: row.slug,
    role: row.role,
  };
}

/**
 * Loads a project scope for a tenant without a user membership check.
 *
 * Used only by startup reconciliation, which runs as the service rather than as
 * a human principal. It still reads the graph key and epoch from SQL: the
 * backend never invents or accepts either from a request.
 */
export async function loadProjectScopeByTenant(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
): Promise<{
  tenantId: string;
  projectId: string;
  graphKey: string;
  graphEpoch: string;
  slug: string;
  role: string;
}> {
  const found = await db.withTenantTransaction(tenantId, (client) =>
    client.rows<{
      project_id: string;
      graph_key: string;
      graph_epoch: string;
      slug: string;
    }>(
      `SELECT id AS project_id, graph_key, graph_epoch, slug
         FROM threadline.projects
        WHERE tenant_id = $1 AND id = $2 AND status = 'ready'
        LIMIT 1`,
      [tenantId, projectId],
    ),
  );
  const row = found[0];
  if (row === undefined) {
    throw new ThreadlineError('not_found', 'No ready project exists for that tenant.');
  }
  return {
    tenantId,
    projectId: row.project_id,
    graphKey: row.graph_key,
    graphEpoch: row.graph_epoch,
    slug: row.slug,
    role: 'service',
  };
}

/** Active project memberships, used to tell the terminal client where it may act. */
export async function listProjectsForUser(
  db: SqlDatabase,
  principal: AuthenticatedPrincipal,
): Promise<ProjectMembershipView[]> {
  const rows = await db.withTenantTransaction(principal.tenantId, (client) =>
    client.rows<{
      project_id: string;
      slug: string;
      role: string;
      graph_epoch: string;
    }>(
      `SELECT p.id AS project_id, p.slug, pm.role, p.graph_epoch
         FROM threadline.project_memberships pm
         JOIN threadline.projects p
           ON p.id = pm.project_id AND p.tenant_id = pm.tenant_id
        WHERE pm.tenant_id = $1 AND pm.user_id = $2
          AND pm.status = 'active' AND p.status = 'ready'
        ORDER BY p.slug`,
      [principal.tenantId, principal.userId],
    ),
  );
  return rows.map((row) => ({
    projectId: row.project_id,
    slug: row.slug,
    role: row.role,
    graphEpoch: row.graph_epoch,
  }));
}

export function newSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

/** Constant-time compare used when a raw token is checked against a stored hash. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(sha256Hex(a), 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertOsOwner(dataDirectory: string): void {
  if (typeof process.getuid !== 'function') {
    throw new ThreadlineError(
      'service_unavailable',
      'Local owner bootstrap requires a POSIX owner check.',
    );
  }
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(dataDirectory);
  if (stats.isSymbolicLink()) {
    throw new ThreadlineError(
      'service_unavailable',
      'The local data directory is a symbolic link; refusing to write a credential there.',
    );
  }
  if (!stats.isDirectory() || (stats.mode & 0o077) !== 0) {
    throw new ThreadlineError('service_unavailable','The local data directory must be a private directory (mode 0700).');
  }
  if (stats.uid !== process.getuid()) {
    throw new ThreadlineError(
      'service_unavailable',
      'The local data directory is not owned by the running user.',
    );
  }
}

function writeSessionTokenFile(dataDirectory: string, payload: SessionTokenFile): string {
  const path = join(dataDirectory, SESSION_TOKEN_FILENAME);
  try {
    // 'wx' fails if the path already exists, which also refuses to follow a
    // pre-planted symlink.
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new ThreadlineError(
        'service_unavailable',
        'An owner credential file already exists; refusing to overwrite it.',
        { path },
      );
    }
    throw new ThreadlineError(
      'service_unavailable',
      'Could not write the owner-only session credential file.',
      { path },
    );
  }
  return path;
}