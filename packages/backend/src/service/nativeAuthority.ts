import { ThreadlineError } from '@threadline/shared';

import type { TxClient } from '../storage/pg.js';
import type { AuthenticatedCall } from './auth.js';

/** Shared predicate in authentication and the FINAL context release statement.
 * t/a/g/p name credential/principal/grant/project in the enclosing query.
 * No native hint, filesystem path or caller-supplied role participates.
 */
export const PRODUCER_AUTHORITY_SQL = `(t.kind<>'producer' OR (
  a.kind='service' AND g.role='reader' AND t.project_id=p.id
  AND t.scopes='{}'::text[] AND t.mcp_instance_id IS NULL
  AND t.idle_expires_at=t.expires_at
  AND EXISTS (
    SELECT 1 FROM threadline_memory.native_enrollments e
    JOIN threadline_memory.workspace_bindings b ON b.tenant_id=e.tenant_id AND b.project_id=e.project_id AND b.id=e.binding_id
    LEFT JOIN threadline_memory.native_sessions s ON s.tenant_id=e.tenant_id AND s.project_id=e.project_id AND s.id=e.native_session_id
    WHERE e.tenant_id=t.tenant_id AND e.project_id=t.project_id AND e.id=t.enrollment_id
      AND e.principal_id=t.principal_id AND e.credential_id=t.id
      AND e.binding_generation=1 AND e.binding_generation=t.binding_generation
      AND e.state='active' AND e.revoked_at IS NULL AND e.expires_at>clock_timestamp()
      AND e.expires_at=t.expires_at AND b.state='active'
      AND e.native_session_id IS NOT DISTINCT FROM t.native_session_id
      AND (e.native_session_id IS NULL OR (
        s.state='active' AND s.principal_id=e.principal_id AND s.enrollment_id=e.id
        AND s.binding_id=e.binding_id AND s.binding_generation=e.binding_generation
        AND s.identity_precision='provisional' AND s.capture_coverage='unknown'))
  )))`;

/** Fenced second read after pre-tenant token lookup. Also used by core native
 * entry points so a previously authenticated call cannot register after revoke.
 */
export async function requireProducerAuthority(tx: TxClient, call: AuthenticatedCall): Promise<void> {
  const rows = await tx.rows(`SELECT t.id FROM threadline_memory.client_tokens t
    JOIN threadline_memory.principals a ON a.tenant_id=t.tenant_id AND a.id=t.principal_id
    JOIN threadline_memory.projects p ON p.tenant_id=t.tenant_id AND p.id=t.project_id
    JOIN threadline_memory.project_grants g ON g.tenant_id=p.tenant_id AND g.project_id=p.id AND g.principal_id=t.principal_id
    WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=$3 AND t.principal_id=$4
      AND t.kind='producer' AND t.state='active' AND t.revoked_at IS NULL AND a.state='active'
      AND t.expires_at>clock_timestamp() AND t.idle_expires_at>clock_timestamp()
      AND p.state='active' AND p.policy_state<>'blocked' AND g.state='active'
      AND t.enrollment_id=$5 AND t.binding_generation=$6
      AND t.native_session_id IS NOT DISTINCT FROM $7::uuid AND ${PRODUCER_AUTHORITY_SQL}`,
  [call.scope.tenantId, call.scope.projectId, call.tokenId, call.scope.principalId,
    call.enrollmentId, call.bindingGeneration, call.scope.nativeSessionId]);
  if (rows.length !== 1) throw new ThreadlineError('scope_denied', 'The producer enrollment or session is no longer authorized.');
}

export async function requireNativeSession(tx: TxClient, call: AuthenticatedCall, id: string | null): Promise<void> {
  if (id === null) {
    if (call.scope.nativeSessionId !== null) throw new ThreadlineError('scope_denied', 'A bound credential must name its session.');
    return;
  }
  if (call.scope.nativeSessionId !== null && call.scope.nativeSessionId !== id) {
    throw new ThreadlineError('scope_denied', 'The requested session differs from the credential binding.');
  }
  const rows = await tx.rows(`SELECT s.id FROM threadline_memory.native_sessions s
    JOIN threadline_memory.native_enrollments e ON e.tenant_id=s.tenant_id AND e.project_id=s.project_id AND e.id=s.enrollment_id
    JOIN threadline_memory.client_tokens t ON t.tenant_id=e.tenant_id AND t.id=e.credential_id
    JOIN threadline_memory.principals a ON a.tenant_id=t.tenant_id AND a.id=t.principal_id
    JOIN threadline_memory.project_grants g ON g.tenant_id=e.tenant_id AND g.project_id=e.project_id AND g.principal_id=e.principal_id
    JOIN threadline_memory.projects p ON p.tenant_id=e.tenant_id AND p.id=e.project_id
    WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3 AND s.principal_id=$4
      AND t.kind='producer' AND t.state='active' AND t.revoked_at IS NULL AND a.state='active' AND g.state='active'
      AND t.expires_at>clock_timestamp() AND t.idle_expires_at>clock_timestamp()
      AND p.state='active' AND p.policy_state<>'blocked' AND t.native_session_id=s.id
      AND ${PRODUCER_AUTHORITY_SQL}`,
  [call.scope.tenantId, call.scope.projectId, id, call.scope.principalId]);
  if (rows.length !== 1) throw new ThreadlineError('scope_denied', 'No active native session belongs to this principal and binding.');
}
