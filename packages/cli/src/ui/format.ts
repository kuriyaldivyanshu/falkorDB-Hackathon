import type {
  DevelopmentEchoResult,
  HealthReport,
  ThreadlineErrorPayload,
  ThreadlineEvent,
} from '@threadline/shared';

/**
 * Renderers for backend answers.
 *
 * Each function states only what the backend reported. Nothing here derives a
 * status the backend did not send, and there is deliberately no "success"
 * wording for a command: acceptance and durability are separate facts.
 */

export function formatErrorPayload(payload: ThreadlineErrorPayload): string {
  const detail = payload.details === undefined ? '' : ` ${JSON.stringify(payload.details)}`;
  return `${payload.code}: ${payload.message}${detail}`;
}

export function formatDevelopmentEchoResult(result: DevelopmentEchoResult): string {
  return `accepted echoId=${result.echoId} at=${result.acceptedAt} durability=${result.durability}`;
}

export function formatHealth(health: HealthReport): string {
  const present = health.components.filter((component) => component.present).map((c) => c.name);
  const ready = health.components.filter((component) => component.ready).map((c) => c.name);
  return (
    `state=${health.state} protocol=${health.protocolVersion} version=${health.backendVersion} ` +
    `uptimeMs=${health.uptimeMs} present=[${present.join(' ')}] ready=[${ready.join(' ')}] ` +
    `durable=${health.guarantees.durable} replayable=${health.guarantees.replayable}`
  );
}

export function formatEvent(event: ThreadlineEvent): string {
  return `event seq=${event.sequence} ${event.name} at=${event.occurredAt} ${describeEvent(event)}`;
}

function describeEvent(event: ThreadlineEvent): string {
  switch (event.name) {
    case 'backend.status':
      return `state=${event.payload.state} since=${event.payload.since} detail="${event.payload.detail}"`;
    case 'development.echo.accepted':
      return (
        `commandId=${event.payload.commandId} echoId=${event.payload.echoId} ` +
        `durability=${event.payload.durability}`
      );
    case 'run.activity':
      return `run=${event.payload.runId} ${event.payload.kind} ${event.payload.state} ${event.payload.detail}`;
    case 'run.state':
    case 'run.attempt':
      // Best-effort activity deltas. These are not durable records: the
      // authoritative state is readable from the backend, not from this stream.
      return (
        `run=${event.payload.runId} state=${event.payload.state} ` +
        `session=${event.payload.sessionState} detail="${event.payload.detail}"`
      );
  }
}
