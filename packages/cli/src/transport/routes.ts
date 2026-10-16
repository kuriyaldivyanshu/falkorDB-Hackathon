/**
 * Every HTTP path this client uses.
 *
 * Agent B owns the client; Agent A owns the routes. Keeping the paths in one
 * module means a route change is a one-line edit here instead of a hunt
 * through the interface.
 *
 * These paths were read from the backend's own route table
 * (`packages/backend/src/api/routes.ts`); keep both registries aligned when
 * changing transport paths.
 */
export const BACKEND_ROUTES = {
  health: '/healthz',
  commands: '/commands',
  events: '/events',
  authStatus: '/auth/status',
  authSession: '/auth/session',
  authRevoke: '/auth/session/revoke',
  authority: '/projects/:projectId/authority',
  admission: '/projects/:projectId/admissions/:requestId',
  runPrepare: '/runs/prepare',
  runStart: '/runs/start',
  runCancel: '/runs/cancel',
  runInspect: '/runs/:runId',
  runHeartbeat: '/runs/:runId/heartbeat',

} as const;

export type BackendRouteName = keyof typeof BACKEND_ROUTES;

/** Expands the `:param` placeholders in a route template. */
export function routePath(template: string, params: Readonly<Record<string, string>> = {}): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value.length === 0) {
      throw new Error(`Route "${template}" needs a "${name}" value.`);
    }
    // Path segments only: an id containing a slash or traversal would change
    // which resource is addressed.
    if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
      throw new Error(`Route value "${name}" must be a simple identifier.`);
    }
    return encodeURIComponent(value);
  });
}

export const ACCEPT_EVENT_STREAM = 'text/event-stream';
/** Registered by the backend source-route module rather than its base route table. */
export const SOURCE_BACKEND_ROUTES = {
  sourceInspect:'/projects/:projectId/sources/:sourceId',
  sourceRange:'/projects/:projectId/sources/:sourceId/range',
  historyReplay:'/projects/:projectId/history/replay',
  historyEvents:'/projects/:projectId/history/events',
} as const;
