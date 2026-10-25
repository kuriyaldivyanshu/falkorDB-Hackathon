import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

import {
  parseContract,
  projectAddInputSchema,
  projectGrantViewSchema,
  projectJoinResultSchema,
  projectViewSchema,
  workspaceBindingViewSchema,
  ThreadlineError,
  type ProjectJoinResult,  type ProjectGrantView,
  type ProjectView,
  type WorkspaceBindingView,
  type WorkspaceRootKind,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { canonicalDigest, sha256Hex } from '../storage/digest.js';
import type { SqlDatabase, TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';
import { encodePageCursor, decodePageCursor } from './cursors.js';
import { requirePermission } from './permissions.js';

/**
 * Project association.
 *
 * A project is the unit of memory and authorization; a workspace root is where
 * its evidence may be captured from. Association is always an explicit,
 * approved act — a path by itself never authorizes anything, and the same
 * canonical root can be active for at most one project in a tenant.
 */

export interface ProjectService {
  add(call: AuthenticatedCall, input: unknown): Promise<ProjectJoinResult>;
  list(call: AuthenticatedCall, page?: {cursor?:string;limit?:number;projectId?:string}): Promise<ProjectView[]>;
  listPage(call: AuthenticatedCall,page?:{cursor?:string;limit?:number;projectId?:string}): Promise<{entries:ProjectView[];nextCursor:string|null}>;
  listGrants(call: AuthenticatedCall, projectId: string, page?: {cursor?:string;limit?:number}): Promise<ProjectGrantView[]>;
  grantsPage(call: AuthenticatedCall,projectId:string,page?:{cursor?:string;limit?:number}): Promise<{entries:ProjectGrantView[];nextCursor:string|null}>;
}

export interface ProjectServiceDeps {
  readonly db: SqlDatabase;
  readonly clock?: () => Date;
  readonly logger?: Logger;
}

interface ProjectRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly label: string;
  readonly graph_key: string;
  readonly graph_epoch: string;
  readonly policy_state: 'ready' | 'changing' | 'blocked';
  readonly privacy_revision: string;
  readonly role: string;
}

export function createProjectService(deps: ProjectServiceDeps): ProjectService {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock ?? (() => new Date());

  const projectView = async (
    call: AuthenticatedCall,
    projectId: string,
  ): Promise<{ view: ProjectView; row: ProjectRow }> => {
    const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
      tx.rows<ProjectRow>(
        `SELECT p.id, p.tenant_id, p.label, p.graph_key, p.graph_epoch, p.policy_state,
                p.privacy_revision::text AS privacy_revision, g.role
           FROM threadline_memory.projects p
           JOIN threadline_memory.project_grants g
             ON g.tenant_id = p.tenant_id AND g.project_id = p.id
          WHERE p.tenant_id = $1 AND p.id = $2
            AND p.state = 'active' AND g.principal_id = $3 AND g.state = 'active'`,
        [call.scope.tenantId, projectId, call.scope.principalId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ThreadlineError('scope_denied', 'No active grant exists for that project.');
    }
    const view = parseContract(
      projectViewSchema,
      {
        projectId: row.id,
        tenantId: row.tenant_id,
        label: row.label,
        role: row.role,
        graphEpoch: row.graph_epoch,
        policyState: row.policy_state,
        privacyRevision: row.privacy_revision,
      },
      'project view',
    );
    return { view, row };
  };

  return {
    async add(call: AuthenticatedCall, input: unknown): Promise<ProjectJoinResult> {
      requirePermission(call, 'project.admin');
      const parsed = parseContract(projectAddInputSchema, input, 'project association');

      let canonicalRoot: string;
      try {
        canonicalRoot = realpathSync(resolve(parsed.root));
        if (!statSync(canonicalRoot).isDirectory()) {
          throw new Error('not a directory');
        }
      } catch {
        throw new ThreadlineError('invalid_request', 'The workspace root does not resolve to a directory.', {
          field: 'root',
        });
      }
      const rootKind = detectRootKind(canonicalRoot);
      const rootFingerprint = sha256Hex(canonicalDigest({ canonicalRoot, rootKind }));

      const result = await deps.db.withTenantTransaction(call.scope.tenantId, async (tx) => {
        const existing = await tx.rows<{
          id: string;
          project_id: string;
        }>(
          `SELECT id, project_id FROM threadline_memory.workspace_bindings
            WHERE tenant_id = $1 AND canonical_root = $2 AND state = 'active'`,
          [call.scope.tenantId, canonicalRoot],
        );
        const binding = existing[0];
        if (binding !== undefined) {
          if (parsed.joinProjectId !== undefined && parsed.joinProjectId !== binding.project_id) {
            throw new ThreadlineError(
              'authority_conflict',
              'The workspace root is already associated with a different project.',
              { projectId: binding.project_id },
            );
          }
          return { projectId: binding.project_id, bindingId: binding.id, created: false };
        }

        let projectId = parsed.joinProjectId;
        if (projectId !== undefined) {
          const rows = await tx.rows<{ id: string }>(
            `SELECT p.id FROM threadline_memory.projects p
               JOIN threadline_memory.project_grants g
                 ON g.tenant_id = p.tenant_id AND g.project_id = p.id
              WHERE p.tenant_id = $1 AND p.id = $2 AND p.state = 'active'
                AND g.principal_id = $3 AND g.state = 'active' AND g.role IN ('owner','member')`,
            [call.scope.tenantId, projectId, call.scope.principalId],
          );
          if (rows[0] === undefined) {
            throw new ThreadlineError('scope_denied', 'Joining a project requires an owner or member grant.');
          }
        } else {
          projectId = randomUUID();
          const graphKey = `tl_${randomUUID().replace(/-/g, '')}`;
          await tx.rows(
            `INSERT INTO threadline_memory.projects
               (tenant_id, id, label, graph_key, graph_epoch, schema_version, privacy_revision,
                policy_state, retention_policy_version, next_source_seq, state, created_at)
             VALUES ($1, $2, $3, $4, $5, 1, 0, 'ready', 1, 0, 'active', $6)`,
            [
              call.scope.tenantId,
              projectId,
              parsed.label ?? basename(canonicalRoot),
              graphKey,
              randomUUID(),
              clock(),
            ],
          );
          await tx.rows(
            `INSERT INTO threadline_memory.project_grants
               (tenant_id, project_id, id, principal_id, role, state, grant_revision, issued_at)
             VALUES ($1, $2, $3, $4, 'owner', 'active', 0, $5)`,
            [call.scope.tenantId, projectId, randomUUID(), call.scope.principalId, clock()],
          );
        }

        const bindingId = randomUUID();
        const inserted = await tx.rows<{ id: string }>(
          `INSERT INTO threadline_memory.workspace_bindings
             (tenant_id, project_id, id, approving_principal_id, root_kind, canonical_root,
              root_fingerprint, permitted_roots, state, binding_policy_revision, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ARRAY[$6]::text[], 'active', 1, $8)
           ON CONFLICT (tenant_id, canonical_root) WHERE state = 'active' DO NOTHING
           RETURNING id`,
          [
            call.scope.tenantId,
            projectId,
            bindingId,
            call.scope.principalId,
            rootKind,
            canonicalRoot,
            rootFingerprint,
            clock(),
          ],
        );
        if (inserted[0] === undefined) {
          // A concurrent association won the same root; reuse its row.
          const winner = await tx.rows<{ id: string; project_id: string }>(
            `SELECT id, project_id FROM threadline_memory.workspace_bindings
              WHERE tenant_id = $1 AND canonical_root = $2 AND state = 'active'`,
            [call.scope.tenantId, canonicalRoot],
          );
          const row = winner[0];
          if (row === undefined) {
            throw new ThreadlineError('authority_conflict', 'The workspace association could not be resolved.');
          }
          return { projectId: row.project_id, bindingId: row.id, created: false };
        }
        return { projectId, bindingId, created: true };
      });

      const { view } = await projectView(call, result.projectId);
      const binding = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
        readBinding(tx, call.scope.tenantId, result.bindingId),
      );
      logger.log({
        level: 'info',
        message: result.created ? 'Associated a workspace root.' : 'Reused a workspace association.',
        fields: { projectId: result.projectId, rootKind },
      });
      return parseContract(
        projectJoinResultSchema,
        { project: view, binding, created: result.created },
        'project join result',
      );
    },

    async list(call, page) { return (await this.listPage(call,page)).entries; },
    async listPage(call, page = {}) {
      const limit = Math.min(page.limit ?? 16,16);
      const filter = `projects:${page.projectId ?? ''}`;
      const after = decodePageCursor(call,filter,page.cursor,'');
      requirePermission(call, 'read');
      const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
        tx.rows<ProjectRow>(
          `SELECT p.id, p.tenant_id, p.label, p.graph_key, p.graph_epoch, p.policy_state,
                  p.privacy_revision::text AS privacy_revision, g.role
             FROM threadline_memory.project_grants g
             JOIN threadline_memory.projects p
               ON p.tenant_id = g.tenant_id AND p.id = g.project_id
            WHERE g.tenant_id = $1 AND g.principal_id = $2
              AND g.state = 'active' AND p.state = 'active'
              AND ($3::uuid IS NULL OR p.id=$3) AND p.id::text > $4
            ORDER BY p.id ASC LIMIT $5`,
          [call.scope.tenantId, call.scope.principalId, page.projectId ?? call.scope.projectId, after,limit+1],
        ),
      );
      const entries = rows.slice(0,limit).map((row) =>
        parseContract(
          projectViewSchema,
          {
            projectId: row.id,
            tenantId: row.tenant_id,
            label: row.label,
            role: row.role,
            graphEpoch: row.graph_epoch,
            policyState: row.policy_state,
            privacyRevision: row.privacy_revision,
          },
          'project view',
        ),
      );
      return {entries,nextCursor:rows.length>limit ? encodePageCursor(call,filter,entries.at(-1)!.projectId) : null};
    },

    async listGrants(call,projectId,page) { return (await this.grantsPage(call,projectId,page)).entries; },
    async grantsPage(call,projectId,page={}) {
      const limit=Math.min(page.limit??100,100);
      const filter=`grants:${projectId}`;
      const after=decodePageCursor(call,filter,page.cursor,'');
      requirePermission(call, 'project.admin');
      // Authorization first: the caller must hold an active grant themselves.
      await projectView(call, projectId);
      const rows = await deps.db.withTenantTransaction(call.scope.tenantId, (tx) =>
        tx.rows<{
          project_id: string;
          principal_id: string;
          role: string;
          state: 'active' | 'revoked';
          grant_revision: string;
        }>(
          `SELECT project_id, principal_id, role, state, grant_revision::text AS grant_revision
             FROM threadline_memory.project_grants
            WHERE tenant_id = $1 AND project_id = $2 AND principal_id::text > $3
            ORDER BY principal_id ASC LIMIT $4`,
          [call.scope.tenantId, projectId,after,limit+1],
        ),
      );
      const entries = rows.slice(0,limit).map((row) =>
        parseContract(
          projectGrantViewSchema,
          {
            projectId: row.project_id,
            principalId: row.principal_id,
            role: row.role,
            state: row.state,
            grantRevision: row.grant_revision,
          },
          'project grant view',
        ),
      );
      return {entries,nextCursor:rows.length>limit ? encodePageCursor(call,filter,entries.at(-1)!.principalId) : null};
    },
  };
}

async function readBinding(
  tx: TxClient,
  tenantId: string,
  bindingId: string,
): Promise<WorkspaceBindingView> {
  const rows = await tx.rows<{
    id: string;
    project_id: string;
    root_kind: string;
    canonical_root: string;
    root_fingerprint: string;
    state: 'active' | 'revoked';
    approving_principal_id: string;
    created_at: Date;
  }>(
    `SELECT id, project_id, root_kind, canonical_root, root_fingerprint, state,
            approving_principal_id, created_at
       FROM threadline_memory.workspace_bindings
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, bindingId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new ThreadlineError('internal_error', 'The workspace binding disappeared after association.');
  }
  return parseContract(
    workspaceBindingViewSchema,
    {
      bindingId: row.id,
      projectId: row.project_id,
      rootKind: row.root_kind,
      canonicalRoot: row.canonical_root,
      rootFingerprint: row.root_fingerprint,
      state: row.state,
      approvingPrincipalId: row.approving_principal_id,
      createdAtMs: row.created_at.getTime(),
    },
    'workspace binding view',
  );
}

function detectRootKind(canonicalRoot: string): WorkspaceRootKind {
  try {
    const gitEntry = statSync(`${canonicalRoot}/.git`);
    return gitEntry.isDirectory() ? 'repository' : 'worktree';
  } catch {
    return 'directory';
  }
}
