/**
 * Local presentation state for the terminal interface.
 *
 * Everything here is this process's own view of what it has seen. It is not
 * task truth: the backend owns requirements, revisions and completion, and
 * nothing in this module may claim a task succeeded.
 */

export const MAX_ACTIVITY_ENTRIES = 200;

export type ActivityLevel = 'info' | 'warn' | 'error';
export type ActivitySource = 'client' | 'backend';

export interface ActivityEntry {
  /** Monotonic per session. Stable list key. */
  readonly id: number;
  readonly at: string;
  readonly level: ActivityLevel;
  readonly source: ActivitySource;
  readonly text: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ConnectionView {
  readonly status: ConnectionStatus;
  /** Reconnect attempt number, 0 before the first try. */
  readonly attempt: number;
  readonly detail: string;
}

/**
 * Appends one entry and drops the oldest beyond `limit`, so an unending event
 * stream cannot grow the process heap. Dropping is counted by the caller from
 * the length difference rather than tracked separately.
 */
export function appendActivity(
  current: readonly ActivityEntry[],
  entry: ActivityEntry,
  limit: number = MAX_ACTIVITY_ENTRIES,
): ActivityEntry[] {
  const kept = limit < 1 ? [] : current.slice(Math.max(0, current.length - limit + 1));
  return [...kept, entry];
}

/** Collapses a multi-line backend string so one activity row stays one line. */
export function toSingleLine(text: string, maxLength = 160): string {
  const flattened = text.replace(/\s+/gu, ' ').trim();
  return flattened.length <= maxLength ? flattened : `${flattened.slice(0, maxLength - 1)}…`;
}
