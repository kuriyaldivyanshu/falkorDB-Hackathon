import { randomUUID } from 'node:crypto';

declare const opaqueBrand: unique symbol;

/**
 * A value that is only interchangeable with other values carrying the same
 * brand. Branded identifiers keep a command id from being passed where an
 * event id is expected without the compiler complaining.
 */
export type Opaque<TValue, TBrand extends string> = TValue & {
  readonly [opaqueBrand]: TBrand;
};

export type CommandId = Opaque<string, 'CommandId'>;
export type EventId = Opaque<string, 'EventId'>;
export type EchoId = Opaque<string, 'EchoId'>;

export const COMMAND_ID_PREFIX = 'cmd_';
export const EVENT_ID_PREFIX = 'evt_';
export const ECHO_ID_PREFIX = 'echo_';

/**
 * The single place where an untyped string becomes a branded id. Transport
 * code must still check the shape of any identifier it accepts from the wire.
 */
function asBranded<TBrand extends string>(value: string): Opaque<string, TBrand> {
  return value as Opaque<string, TBrand>;
}

export function newCommandId(): CommandId {
  return asBranded<'CommandId'>(`${COMMAND_ID_PREFIX}${randomUUID()}`);
}

export function newEventId(): EventId {
  return asBranded<'EventId'>(`${EVENT_ID_PREFIX}${randomUUID()}`);
}

export function newEchoId(): EchoId {
  return asBranded<'EchoId'>(`${ECHO_ID_PREFIX}${randomUUID()}`);
}

export function isCommandId(value: unknown): value is CommandId {
  return isIdWithPrefix(value, COMMAND_ID_PREFIX);
}

export function isEventId(value: unknown): value is EventId {
  return isIdWithPrefix(value, EVENT_ID_PREFIX);
}

export function isEchoId(value: unknown): value is EchoId {
  return isIdWithPrefix(value, ECHO_ID_PREFIX);
}

function isIdWithPrefix(value: unknown, prefix: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  if (!value.startsWith(prefix)) {
    return false;
  }
  return isUuid(value.slice(prefix.length));
}

function isUuid(candidate: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidate);
}