import { ThreadlineError } from '@threadline/shared';

import type { AuthenticatedCall } from './auth.js';

/** Deny by default for reader credentials AND reader grants, on every surface.
 * Context writes only service audit metadata; they never authorize source append.
 */
export type Permission = 'read' | 'context.audit' | 'knowledge.write' | 'project.admin' |
  'access.admin' | 'service.status' | 'capabilities' | 'native.inspect' | 'native.register' | 'native.sessions';

export function requirePermission(call: AuthenticatedCall, permission: Permission): void {
  if (call.scope.tokenKind === 'producer') {
    const allowed = ['native.inspect', 'native.register'];
    if (call.scope.nativeSessionId !== null) allowed.push('read', 'context.audit', 'capabilities', 'native.sessions');
    if (!allowed.includes(permission)) {
      throw new ThreadlineError('scope_denied', 'This producer permits self-inspection and registration, then scoped reads and its own context audits after pinning.');
    }
    return;
  }
  if (['native.inspect', 'native.sessions'].includes(permission)) {
    permission = 'access.admin';
  }
  if (permission === 'native.register') throw new ThreadlineError('scope_denied', 'Session registration requires an enrolled producer.');
  const readOnly = call.scope.tokenKind === 'reader' || call.scope.role === 'reader';
  if (readOnly && !['read', 'context.audit', 'capabilities'].includes(permission)) {
    throw new ThreadlineError('scope_denied', 'This credential permits project reads and its own context audits only.');
  }
  if (permission === 'knowledge.write' && !['owner', 'member'].includes(call.scope.role ?? '')) {
    throw new ThreadlineError('scope_denied', 'Knowledge changes require an owner or member grant.');
  }
  if (permission === 'access.admin' && (call.scope.principalKind !== 'human' ||
      call.scope.tokenKind !== 'human_admin' || call.scope.role !== 'owner')) {
    throw new ThreadlineError('scope_denied', 'Access administration requires a human project owner.');
  }
  if (permission === 'project.admin' && (call.scope.principalKind !== 'human' || call.scope.tokenKind !== 'human_admin')) {
    throw new ThreadlineError('scope_denied', 'Project administration requires a human administrator.');
  }
}
