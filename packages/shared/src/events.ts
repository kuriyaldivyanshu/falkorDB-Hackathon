import type { CommandId, EchoId, EventId } from './ids.js';
import { PROTOCOL_VERSION, type DevelopmentDurability } from './protocol.js';

/**
 * Backend lifecycle states. `created` exists before the process binds a port,
 * so health can report honestly instead of claiming readiness.
 */
export const BACKEND_STATES = ['created', 'starting', 'ready', 'stopping', 'stopped'] as const;

export type BackendState = (typeof BACKEND_STATES)[number];

export interface BackendStatusPayload {
  readonly state: BackendState;
  /** ISO timestamp of the moment the backend entered this state. */
  readonly since: string;
  readonly detail: string;
}

export interface DevelopmentEchoAcceptedPayload {
  readonly commandId: CommandId;
  readonly echoId: EchoId;
  readonly text: string;
  readonly acceptedAt: string;
  readonly durability: DevelopmentDurability;
}

export interface RunEventPayloadLocal {
  readonly runId: string;
  readonly sessionId: string;
  readonly state: string;
  readonly sessionState: string;
  readonly detail: string;
}

export interface RunActivityPayload {
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly state: string;
  readonly detail: string;
}

export interface EventMap {
  readonly 'run.activity': RunActivityPayload;
  readonly 'backend.status': BackendStatusPayload;
  readonly 'development.echo.accepted': DevelopmentEchoAcceptedPayload;
  readonly 'run.state': RunEventPayloadLocal;
  readonly 'run.attempt': RunEventPayloadLocal;
}

export type EventName = keyof EventMap;

export type EventPayload<E extends EventName> = EventMap[E];

/**
 * A process-local event. `sequence` is a monotonic counter for one backend
 * instance and is NOT a durable cursor: there is no replay, no persistence and
 * no cross-restart continuity at this milestone.
 */
export type ThreadlineEventOf<E extends EventName> = {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly eventId: EventId;
  readonly name: E;
  readonly occurredAt: string;
  readonly payload: EventMap[E];
};

/**
 * Every event, as a discriminated union keyed on `name`. Consumers narrow with
 * `if (event.name === 'backend.status')` and get the matching payload type.
 */
export type ThreadlineEvent = {
  [E in EventName]: ThreadlineEventOf<E>;
}[EventName];

export function isEventName(value: unknown): value is EventName {
  return (
    value === 'backend.status' ||
    value === 'development.echo.accepted' ||
    value === 'run.activity' ||
    value === 'run.state' ||
    value === 'run.attempt'
  );
}

/**
 * Minimal structural check used by the terminal client when reading a stream.
 * It does not guarantee semantic correctness of the payload.
 */
export function isThreadlineEvent(value: unknown): value is ThreadlineEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    protocolVersion?: unknown;
    sequence?: unknown;
    eventId?: unknown;
    name?: unknown;
    occurredAt?: unknown;
    payload?: unknown;
  };
  return (
    candidate.protocolVersion === PROTOCOL_VERSION &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.eventId === 'string' &&
    typeof candidate.name === 'string' &&
    isEventName(candidate.name) &&
    typeof candidate.occurredAt === 'string' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}