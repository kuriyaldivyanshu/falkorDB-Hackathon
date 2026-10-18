import { ThreadlineError } from '@threadline/shared';

import type { AuthenticatedCall } from './auth.js';

/** Deny by default for reader credentials AND reader grants, on every surface.
 * Context writes only service audit metadata; they never authorize source append.
 */
export type Permission = 'read' | 'context.audit' | 'knowledge.write' | 'project.admin' |
  'access.admin' | 'service.status' | 'capabilities';

export function requirePermission(call: AuthenticatedCall, permission: Permission): void {
  const readOnly = call.scope.tokenKind === 'reader' || call.scope.role === 'reader';
  if (readOnly && !['read', 'context.audit', 'capabilities'].includes(permission)) {
    throw new ThreadlineError('scope_denied', 'This credential permits project reads and its own context audits only.');
  }
  if (permission === 'knowledge.write' && !['owner', 'member'].includes(call.scope.role ?? '')) {
    throw new ThreadlineError('scope_denied', 'Knowledge changes require an owner or member grant.');
  }
  if (permission === 'access.admin' && (call.scope.principalKind !== 'human' ||
      call.scope.tokenKind !== 'human_admin' || call.scope.role !== 'owner')) {
    throw new ThreadlineError('scope_denied', 'Reader credential administration requires a human project owner.');
  }
  if (permission === 'project.admin' && (call.scope.principalKind !== 'human' || call.scope.tokenKind !== 'human_admin')) {
    throw new ThreadlineError('scope_denied', 'Project administration requires a human administrator.');
  }
}
