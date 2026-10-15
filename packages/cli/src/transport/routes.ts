/**
 * Every HTTP path this client uses.
 *
 * Agent B owns the client; Agent A owns the routes. Keeping the paths in one
 * module means a route change is a one-line edit here instead of a hunt
 * through the interface, and it keeps a guessed path from leaking into the UI.
 *
 * These paths were read from the backend's own route table
 * (`packages/backend/src/api/routes.ts`); if that table changes, this is the
 * only file in this package that needs to follow.
 */
export const BACKEND_ROUTES = {
  health: '/healthz',
  commands: '/commands',
  events: '/events',
  authSession: '/auth/session',
  authStatus: '/auth/status',
  authRevoke: '/auth/session/revoke',
  authority: '/projects/:projectId/authority',
  admission: '/projects/:projectId/admissions/:requestId',
} as const;

export const ACCEPT_EVENT_STREAM = 'text/event-stream';
