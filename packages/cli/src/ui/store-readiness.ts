import type { HealthReport } from '@threadline/shared';

/**
 * Store readiness, derived only from what the backend reported.
 *
 * The component names come from the backend's health report, so this module
 * does not assume which stores exist: at M00 every store reports
 * `present: false`, and it must stay visibly unavailable rather than being
 * treated as an optional detail.
 */

export interface StoreLine {
  readonly name: string;
  readonly present: boolean;
  readonly ready: boolean;
  readonly detail: string;
}

export interface StoreReadiness {
  readonly lines: readonly StoreLine[];
  /** True only when the backend says every component it reports is ready. */
  readonly allReady: boolean;
  readonly unavailable: readonly string[];
}

/** Components that are not part of the process's declared surface are ignored. */
export function readStoreReadiness(health: HealthReport): StoreReadiness {
  const lines: StoreLine[] = health.components.map((component) => ({
    name: component.name,
    present: component.present,
    ready: component.ready,
    detail: component.detail,
  }));
  const stores = lines.filter(line => line.name === 'postgres' || line.name === 'falkordb');
  const unavailable = stores.filter((line) => !line.ready).map((line) => line.name);
  return { lines, allReady: stores.length === 2 && unavailable.length === 0, unavailable };
}

/**
 * One line per component.
 *
 * A component that is absent is labelled absent, which is different from
 * failing: absence means "not built yet", failure means "configured and
 * broken". Collapsing the two would hide a real outage.
 */
export function formatStoreReadiness(health: HealthReport): string[] {
  const readiness = readStoreReadiness(health);
  return readiness.lines.map((line) => {
    const state = line.ready ? 'ready' : line.present ? 'UNAVAILABLE' : 'absent';
    return `  ${line.name.padEnd(16)} ${state.padEnd(12)} ${line.detail}`;
  });
}

export function describeStoreState(health: HealthReport): string {
  const readiness = readStoreReadiness(health);
  if (readiness.allReady) {
    return 'PostgreSQL and FalkorDB are ready';
  }
  return `not ready: ${readiness.unavailable.length > 0 ? readiness.unavailable.join(', ') : 'store status missing'}`;
}
