import { ThreadlineError, MODEL_TOOL_OUTPUT_MAX_BYTES, base64LengthFor, modelFacingSourceRangeMaxBytes, serializedSourceRangeBytes } from '@threadline/shared';
import type { ArtifactIdentity, SourceReader, SourceService } from '@threadline/shared';
import { MAX_ARTIFACT_BYTES } from '../storage/artifacts.js';

/**
 * `memory.retrieve(mode=source)` and authorized Source inspection.
 *
 * M03 adds only the source branch of memory retrieval. Search-based retrieval
 * and context construction belong to a later milestone, so `mode` is validated
 * and anything other than `source` is refused here rather than deferred.
 *
 * Three rules shape this module:
 *
 * 1. **Authority is server-owned.** The caller supplies only `sourceId`,
 *    `offset` and `maxBytes`. Tenant, project, run, session and the reader
 *    identity come from the injected `SourceReader` and are never model-supplied.
 * 2. **A missing or denied Source is not an empty Source.** Every non-available
 *    path throws. Returning a successful zero-length range would let a later
 *    turn treat absent evidence as evidence.
 * 3. **Absence must not be enumerable.** A model, and any caller outside the
 *    Source's scope, receives one indistinguishable outcome for "absent",
 *    "denied" and "unavailable". The precise reason is carried in the thrown
 *    error so the durable capture record can keep it, where an authorized
 *    operator can read it. Nothing physical is ever returned: `storageKey` and
 *    every filesystem locator stay inside the backend.
 */

export const SOURCE_RETRIEVAL_TOOL_NAME = 'memory.retrieve';
export const SUPPORTED_RETRIEVAL_MODES = ['source'] as const;

/**
 * The model-facing ceiling on **original** Source bytes.
 *
 * This is deliberately smaller than `SOURCE_RANGE_MAX_BYTES`, which bounds the
 * inspection API. `model_tool_output_max_bytes` applies to the serialized tool
 * result, and base64 plus JSON metadata expand a range by roughly a third, so a
 * 32 KiB range would already overrun the model's ceiling. Both numbers come from
 * the shared contract so the schema, the backend and the CLI cannot drift.
 */
export const MODEL_SOURCE_RANGE_MAX_BYTES = modelFacingSourceRangeMaxBytes();

/** The inspection ceiling, in original bytes, re-exported from the contract. */
export const SOURCE_RANGE_MAX_BYTES = 32_768;

/** Bounded so a caller cannot probe identifiers of arbitrary length. */
const SOURCE_ID_MAX_CHARS = 128;

export type SourceFailureReason =
  | 'invalid_input'
  | 'unsupported_mode'
  | 'unavailable'
  | 'limit_exceeded'
  | 'corrupt';

export class SourceRetrievalError extends Error {
  constructor(
    /**
     * Model-visible code. `unavailable` deliberately covers absent, denied and
     * pending so foreign Source existence cannot be probed.
     */
    readonly code: 'invalid_input' | 'unsupported_mode' | 'unavailable' | 'limit_exceeded',
    /** Precise reason for the durable record. Never sent to a model. */
    readonly reason: SourceFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'SourceRetrievalError';
  }
}

/** What a model is told about a Source. Physical locators are excluded by construction. */
export interface SourceRetrievalResult {
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly byteSize: number;
  readonly offset: number;
  readonly returnedBytes: number;
  readonly truncated: boolean;
  readonly totalBytes: number;
  /** Base64 of exactly `returnedBytes` bytes; decode before interpreting. */
  readonly base64: string;
  /** Serialized size of this result, which is what a request budget charges. */
  readonly serializedBytes: number;
}

export interface SourceRetrieval {
  invoke(input: unknown): Promise<SourceRetrievalResult>;
}

const integer = (maximum: number, minimum = 0) => ({ type: ['integer', 'null'], minimum, maximum });
const schema = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/**
 * The fourth model-facing capability. Exposed alongside the three workspace
 * tools, never instead of them.
 */
export const SOURCE_RETRIEVAL_FUNCTION = {
  type: 'function',
  name: 'memory_retrieve',
  description:
    'Read a bounded byte range from one captured Source recorded by this project. Returns the content digest, total bytes, the exact returned range and base64 bytes. Absent or unauthorized Sources are unavailable, never empty. Search is not supported.',
  strict: true,
  parameters: schema({
    mode: { type: 'string', enum: [...SUPPORTED_RETRIEVAL_MODES] },
    sourceId: { type: 'string', minLength: 1, maxLength: SOURCE_ID_MAX_CHARS },
    offset: integer(MAX_ARTIFACT_BYTES),
    maxBytes: integer(MODEL_SOURCE_RANGE_MAX_BYTES, 1),
  }),
} as const;

function usableSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SOURCE_ID_MAX_CHARS &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function usableOffset(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SourceRetrievalError('invalid_input', 'invalid_input', 'offset must be a non-negative integer.');
  }
  return value;
}

function usableMaxBytes(value: unknown): number {
  if (value === undefined || value === null) return MODEL_SOURCE_RANGE_MAX_BYTES;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SourceRetrievalError('invalid_input', 'invalid_input', 'maxBytes must be a positive integer.');
  }
  if (value > MODEL_SOURCE_RANGE_MAX_BYTES) {
    throw new SourceRetrievalError(
      'limit_exceeded',
      'limit_exceeded',
      `maxBytes exceeds the ${MODEL_SOURCE_RANGE_MAX_BYTES} byte model-facing Source range maximum.`,
    );
  }
  return value;
}

/**
 * Every returned byte count is verified, because a digest or a metadata row is
 * not proof that bytes are available. Base64 encodes 3 bytes per 4 characters.
 */
function verifyRangeLength(base64: string, expectedBytes: number): void {
  if (expectedBytes === 0) return;
  if (typeof base64 !== 'string' || base64.length % 4 !== 0 || base64.length !== base64LengthFor(expectedBytes)) {
    throw new SourceRetrievalError('unavailable', 'corrupt', 'The stored Source range did not match its declared size.');
  }
}

export function createSourceRetrieval(options: {
  source: SourceService;
  /** Resolved by the server from the authenticated session. */
  reader: SourceReader;
  maxBytes?: number;
}): SourceRetrieval {
  const ceiling = options.maxBytes ?? MODEL_SOURCE_RANGE_MAX_BYTES;
  if (ceiling <= 0 || ceiling > MODEL_SOURCE_RANGE_MAX_BYTES) {
    throw new SourceRetrievalError('limit_exceeded', 'limit_exceeded', 'Configured Source range maximum is not usable.');
  }

  return {
    async invoke(input: unknown): Promise<SourceRetrievalResult> {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new SourceRetrievalError('invalid_input', 'invalid_input', 'Retrieve arguments must be an object.');
      }
      const args = input as Record<string, unknown>;
      if (!Object.keys(args).every((key) => ['mode', 'sourceId', 'offset', 'maxBytes'].includes(key))) {
        throw new SourceRetrievalError('invalid_input', 'invalid_input', 'Retrieve arguments contain an unknown field.');
      }

      const mode = args.mode;
      if (mode !== 'source') {
        throw new SourceRetrievalError(
          'unsupported_mode',
          'unsupported_mode',
          'Only mode "source" is available at this milestone.',
        );
      }
      if (!usableSourceId(args.sourceId)) {
        throw new SourceRetrievalError('invalid_input', 'invalid_input', 'sourceId is required.');
      }
      const sourceId = args.sourceId;
      const offset = usableOffset(args.offset, 0);
      const maxBytes = usableMaxBytes(args.maxBytes);
      if (maxBytes > ceiling) {
        throw new SourceRetrievalError('limit_exceeded', 'limit_exceeded', 'Requested range exceeds the configured maximum.');
      }

      // Unknown, foreign, missing and pending all read the same way to a caller.
      let metadata: Awaited<ReturnType<SourceService['metadata']>>;
      try {
        metadata = await options.source.metadata(options.reader, sourceId);
      } catch {
        throw new SourceRetrievalError('unavailable', 'unavailable', 'The Source is not available.');
      }
      // `pending` is kept distinct for the durable record, because a Source that
      // is genuinely still arriving is a different fact from one that is gone.
      if (metadata.state === 'pending') {
        throw new SourceRetrievalError('unavailable', 'unavailable', 'The Source is not available.');
      }
      if (!metadata.available || metadata.state === 'absent' || metadata.state === 'unavailable' || metadata.identity.status !== 'available') {
        throw new SourceRetrievalError('unavailable', 'unavailable', 'The Source is not available.');
      }

      if (metadata.identity.visibility !== 'project')
        throw new SourceRetrievalError('unavailable','unavailable','The Source is not available.');
      const identity: ArtifactIdentity = metadata.identity;
      const byteSize = identity.byteSize;
      if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
        throw new SourceRetrievalError('unavailable', 'corrupt', 'The Source metadata is not usable.');
      }
      if (offset > byteSize) {
        throw new SourceRetrievalError('limit_exceeded', 'limit_exceeded', 'offset is past the end of the Source.');
      }

      const end = Math.min(offset + maxBytes, byteSize);
      const expectedBytes = end - offset;
      if (expectedBytes <= 0) {
        // An exact read of a zero-length tail is still a refusal, not empty content.
        throw new SourceRetrievalError('unavailable', 'invalid_input', 'The requested range selects no bytes.');
      }

      let range: Awaited<ReturnType<SourceService['readRange']>>;
      try {
        range = await options.source.readRange(options.reader, sourceId, offset, end);
      } catch {
        throw new SourceRetrievalError('unavailable', 'unavailable', 'The Source is not available.');
      }
      verifyRangeLength(range.base64, expectedBytes);

      const result = {
        sourceId,
        contentDigest: identity.contentDigest,
        byteSize,
        offset: range.start,
        returnedBytes: range.end - range.start,
        truncated: range.truncated || end < byteSize,
        totalBytes: range.totalBytes,
        base64: range.base64,
        serializedBytes: serializedSourceRangeBytes({
          sourceId,
          contentDigest: identity.contentDigest,
          offset: range.start,
          returnedBytes: range.end - range.start,
          totalBytes: range.totalBytes,
        }),
      };
      // Include every field actually handed to the model, including this size
      // field itself. The request serializer remains the budget authority.
      for (let i = 0; i < 3; i++) result.serializedBytes = Buffer.byteLength(JSON.stringify(result));
      if (result.serializedBytes > MODEL_TOOL_OUTPUT_MAX_BYTES)
        throw new SourceRetrievalError('limit_exceeded', 'limit_exceeded', 'Serialized Source result exceeds the tool output ceiling.');
      return result;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Operator inspection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Typed inspection states for the CLI. An authorized operator in the Source's
 * own scope sees which state applies; a caller outside that scope is given
 * `missing`, so existence is not discoverable from the outside.
 */
export type SourceInspection =
  | { readonly state: 'available'; readonly sourceId: string; readonly contentDigest: string; readonly byteSize: number; readonly kind: string; readonly visibility: string }
  | { readonly state: 'missing'; readonly sourceId: string; readonly reason: string }
  | { readonly state: 'denied'; readonly sourceId: string; readonly reason: string }
  | { readonly state: 'pending'; readonly sourceId: string; readonly reason: string }
  | { readonly state: 'corrupt'; readonly sourceId: string; readonly reason: string };

const availableFrom = (identity: ArtifactIdentity, sourceId: string): SourceInspection => {
  if (!Number.isSafeInteger(identity.byteSize) || identity.byteSize < 0) {
    return { state: 'corrupt', sourceId, reason: 'the backend reported an unusable artifact size' };
  }
  return {
    state: 'available',
    sourceId,
    contentDigest: identity.contentDigest,
    byteSize: identity.byteSize,
    kind: identity.kind,
    visibility: identity.visibility,
  };
};

export async function inspectSource(options: {
  source: SourceService;
  reader: SourceReader;
  sourceId: string;
}): Promise<SourceInspection> {
  const { sourceId } = options;
  if (!usableSourceId(sourceId)) return { state: 'missing', sourceId: '', reason: 'no usable source identifier' };

  let metadata: Awaited<ReturnType<SourceService['metadata']>>;
  try {
    metadata = await options.source.metadata(options.reader, sourceId);
  } catch (error) {
    if (error instanceof ThreadlineError && error.code !== 'not_found' && error.code !== 'unauthorized') throw error;
    // A thrown refusal carries no scope information, so it reads as absent.
    // Inferring "denied" from an error message would let a caller outside the
    // scope tell a foreign Source from one that does not exist.
    return { state: 'missing', sourceId, reason: 'absent or not readable by this reader' };
  }

  // A states the authoritative position for this reader. A reader outside the
  // Source's scope is always given `absent`, which is what keeps absence and
  // inaccessibility indistinguishable from the outside.
  switch (metadata.state) {
    case 'absent':
      return { state: 'missing', sourceId, reason: metadata.reason ?? 'not present' };
    case 'pending':
      return { state: 'pending', sourceId, reason: metadata.reason ?? 'not yet readable' };
    case 'unavailable':
      return { state: 'missing', sourceId, reason: metadata.reason ?? 'the bytes are no longer readable' };
    case 'available':
      return availableFrom(metadata.identity, sourceId);
    default:
      break;
  }

  // A service that reports no state falls back to availability and artifact status.
  const identity = metadata.identity;
  if (identity.status === 'missing' || identity.status === 'tombstoned' || !metadata.available) {
    return { state: 'missing', sourceId, reason: metadata.reason ?? identity.status };
  }
  return availableFrom(identity, sourceId);
}
