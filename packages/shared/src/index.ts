/**
 * Public surface of `@threadline/shared`.
 *
 * This package holds wire contracts only: identifiers, command/result/event
 * envelopes, health shape and typed errors. It must not import database
 * clients, provider SDKs, filesystem modules or hold credentials.
 */

export {
  COMMAND_ID_PREFIX,
  ECHO_ID_PREFIX,
  EVENT_ID_PREFIX,
  isCommandId,
  isEchoId,
  isEventId,
  newCommandId,
  newEchoId,
  newEventId,
  type CommandId,
  type EchoId,
  type EventId,
  type Opaque,
} from './ids.js';

export {
  BackendStateError,
  ConfigurationError,
  EventCapacityError,
  PublisherClosedError,
  THREADLINE_ERROR_CODES,
  ThreadlineError,
  errorPayload,
  isThreadlineErrorPayload,
  type ConfigurationIssue,
  type ThreadlineErrorCode,
  type ThreadlineErrorDetail,
  type ThreadlineErrorPayload,
} from './errors.js';

export {
  DEVELOPMENT_DURABILITY,
  PROTOCOL_VERSION,
  isCommandName,
  type CommandInput,
  type CommandMap,
  type CommandName,
  type CommandOutcome,
  type CommandRequest,
  type CommandResponse,
  type CommandResult,
  type CommandFailure,
  type CommandSuccess,
  type DevelopmentDurability,
  type DevelopmentEchoInput,
  type DevelopmentEchoResult,
} from './protocol.js';

export {
  BACKEND_STATES,
  isEventName,
  isThreadlineEvent,
  type BackendStatusPayload,
  type DevelopmentEchoAcceptedPayload,
  type EventMap,
  type EventName,
  type EventPayload,
  type ThreadlineEvent,
  type ThreadlineEventOf,
  type BackendState,
} from './events.js';

export {
  COMPONENT_NAMES,
  isHealthReport,
  type BackendGuarantees,
  type ComponentName,
  type ComponentStatus,
  type HealthReport,
} from './health.js';