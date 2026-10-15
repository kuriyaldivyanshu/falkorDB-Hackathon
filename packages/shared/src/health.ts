import { PROTOCOL_VERSION } from './protocol.js';
import { BACKEND_STATES, type BackendState } from './events.js';

/**
 * Component names reported by health. Names are fixed here so a client can
 * distinguish "not implemented yet" from "configured but failing".
 */
export const COMPONENT_NAMES = [
  'api',
  'eventPublisher',
  'postgres',
  'falkordb',
  'provider',
  'checker',
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

export interface ComponentStatus {
  readonly name: ComponentName;
  /** Whether this process actually contains the component. */
  readonly present: boolean;
  /** Whether the component is usable right now. Never inferred from presence. */
  readonly ready: boolean;
  readonly detail: string;
}

/**
 * Explicit statements about what the running process does and does not promise.
 * At M00 every durable capability is false.
 */
export interface BackendGuarantees {
  readonly durable: boolean;
  readonly replayable: boolean;
  readonly multiSession: boolean;
  readonly note: string;
}

export interface HealthReport {
  readonly protocolVersion: number;
  readonly backendVersion: string;
  readonly state: BackendState;
  readonly uptimeMs: number;
  readonly components: readonly ComponentStatus[];
  readonly guarantees: BackendGuarantees;
}

function isComponentStatus(value: unknown): value is ComponentStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const component = value as {
    name?: unknown;
    present?: unknown;
    ready?: unknown;
    detail?: unknown;
  };
  return (
    COMPONENT_NAMES.some((name) => name === component.name) &&
    typeof component.present === 'boolean' &&
    typeof component.ready === 'boolean' &&
    typeof component.detail === 'string'
  );
}

export function isHealthReport(value: unknown): value is HealthReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    protocolVersion?: unknown;
    backendVersion?: unknown;
    state?: unknown;
    uptimeMs?: unknown;
    components?: unknown;
    guarantees?: unknown;
  };
  return (
    candidate.protocolVersion === PROTOCOL_VERSION &&
    typeof candidate.backendVersion === 'string' &&
    BACKEND_STATES.some((state) => state === candidate.state) &&
    typeof candidate.uptimeMs === 'number' &&
    Array.isArray(candidate.components) &&
    candidate.components.every(isComponentStatus) &&
    typeof candidate.guarantees === 'object' &&
    candidate.guarantees !== null
  );
}
