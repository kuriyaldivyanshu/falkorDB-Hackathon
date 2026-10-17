import { z } from 'zod';

import { ThreadlineError } from './errors.js';

/**
 * Shared validation primitives.
 *
 * One validation definition per contract: every contract in this package is a
 * Zod schema and its TypeScript type is inferred from that schema, so a field
 * cannot exist in the type without also being validated at the boundary.
 *
 * Two representations are deliberately kept apart:
 *
 * - **decimal strings** carry signed 64-bit counters (source/project sequence,
 *   privacy revision, graph head, event sequence). A JavaScript `number` cannot
 *   hold these exactly, so they never cross a boundary as one.
 * - **byte-bounded text** is validated in UTF-8 bytes, not UTF-16 code units,
 *   because the storage contract's limits are byte limits.
 */

/**
 * Largest value a signed 64-bit counter can hold. Every decimal-string counter
 * is stored as SQL `bigint`, so this bound — not a digit count — is the real
 * limit: a 19-digit value can still exceed it and a 20-digit value always does.
 */
export const MAX_SIGNED_BIGINT = 9223372036854775807n;

/** Digit budget for the cheap length pre-filter; the value check is the bound. */
export const MAX_DECIMAL_DIGITS = 19;

/**
 * Whether a string is a value a signed 64-bit column can hold.
 *
 * Total by construction: a refinement runs even when an earlier check has
 * already failed, so this must return `false` for a non-integral string such as
 * `1.5` rather than letting `BigInt` throw out of `safeParse`.
 */
const isWithinSignedBigInt = (value: string): boolean => {
  try {
    return BigInt(value) <= MAX_SIGNED_BIGINT;
  } catch {
    return false;
  }
};

/**
 * Canonical non-negative decimal string. No leading zeros, no sign, no float,
 * and never larger than the signed 64-bit range its SQL column can hold.
 */
export const decimalStringSchema = z
  .string()
  .max(MAX_DECIMAL_DIGITS)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(isWithinSignedBigInt, {
    message: `Value exceeds the signed 64-bit maximum of ${MAX_SIGNED_BIGINT.toString()}.`,
  });

export type DecimalString = z.infer<typeof decimalStringSchema>;

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const uuidSchema = z.uuid();

export const isoInstantSchema = z.string().datetime({ offset: true });

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** A non-empty string bounded by UTF-8 bytes. */
export function byteBoundedText(maxBytes: number): z.ZodType<string> {
  return z
    .string()
    .min(1)
    .refine((value) => utf8ByteLength(value) <= maxBytes, {
      message: `Text exceeds the ${String(maxBytes)} byte limit.`,
    });
}

export function isDecimalString(value: unknown): value is DecimalString {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    value.length <= MAX_DECIMAL_DIGITS &&
    isWithinSignedBigInt(value)
  );
}

export function decimalToBigInt(value: DecimalString): bigint {
  return BigInt(value);
}

/**
 * Compares two canonical decimal strings by numeric value.
 *
 * Lexicographic comparison is wrong (`"9"` sorts after `"10"`), so cursor
 * ordering always converts explicitly.
 */
export function compareDecimalStrings(left: DecimalString, right: DecimalString): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Adds one to a canonical decimal string without a JS number round-trip. */
export function incrementDecimal(value: DecimalString): DecimalString {
  return (BigInt(value) + 1n).toString();
}

export interface ContractParseFailure {
  readonly label: string;
  readonly issueCount: number;
  /** First failing path only; the submitted value is never echoed. */
  readonly path: string;
}

/**
 * Parses a contract or throws a safe `invalid_request`.
 *
 * The raised error reports how many issues were found and the first failing
 * path. It never carries the submitted value, which may be private content.
 */
export function parseContract<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const first = result.error.issues[0];
  throw new ThreadlineError('invalid_request', `The ${label} payload is not valid.`, {
    label,
    issueCount: result.error.issues.length,
    path: first === undefined ? '' : first.path.map((part) => String(part)).join('.'),
  });
}

/** Non-throwing form, for callers that report unavailability instead of failing. */
export function safeParseContract<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): { readonly ok: true; readonly value: z.infer<TSchema> } | { readonly ok: false; readonly path: string } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const first = result.error.issues[0];
  return { ok: false, path: first === undefined ? '' : first.path.map((part) => String(part)).join('.') };
}
