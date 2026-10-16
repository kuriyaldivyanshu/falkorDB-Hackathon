/**
 * M03 public capture, source and replay contracts.
 *
 * This module is the agreed seam between the two lanes. It declares the shapes
 * and the service ports; Agent A implements them and Agent B consumes them. It
 * deliberately contains no storage or transport logic.
 *
 * Two ideas run through everything here.
 *
 * **Absent is not zero.** A fact that was never observed is `null`/`undefined`,
 * never `0`, `false` or `''`. Collapsing the two is how an unmeasured token
 * count becomes a recorded measurement.
 *
 * **Bytes, not summaries.** What is captured is the original safe bytes the
 * system actually sent or received, plus its digest. A normalized or filtered
 * object is a derived view and must never be presented as an original
 * transcript.
 */

/**
 * Schema version of a capture envelope.
 *
 * Bumping this means the payload shape changed. Readers reject a version they do
 * not understand rather than guessing, so a stale client cannot silently
 * misread a new payload.
 */
export const CAPTURE_SCHEMA_VERSION = 1;

/**
 * The kinds of evidence this milestone captures.
 *
 * `tool.*` already exist from M02. The rest are the M03 additions and all are
 * validated at the boundary: an unrecognised kind is a typed error, not a row.
 */
export const CAPTURE_KINDS = [
  'tool.intent',
  'tool.result',
  'model.input',
  'model.output.complete',
  'model.output.partial',
  'registered_command.observation',
  'diagnostic.observation',
  'artifact.missing',
  'capture.gap',
] as const;

export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export function isCaptureKind(value: unknown): value is CaptureKind {
  return typeof value === 'string' && (CAPTURE_KINDS as readonly string[]).includes(value);
}

/**
 * What produced a capture.
 *
 * `model` is a real provider response, `tool` is a real read-tool invocation,
 * and `registered_command` is an observation of something the environment
 * already did. The distinction matters because a registered command is not a
 * command Threadline chose to run, and must never be presented as if it were.
 */
export const CAPTURE_ORIGINS = ['model', 'tool', 'registered_command'] as const;
export type CaptureOrigin = (typeof CAPTURE_ORIGINS)[number];

/**
 * The correlation fields every capture carries.
 *
 * The server resolves all of these from its own authority. A caller never
 * supplies an owner, a project or a graph epoch, because a caller-supplied one
 * would be an assertion rather than a fact.
 */
export interface CaptureCorrelation {
  readonly tenantId: string;
  readonly projectId: string;
  /** The logical Builder AgentSession that produced this evidence. */
  readonly agentSessionId: string;
  readonly runId: string;
  readonly taskId: string;
  /** One logical provider turn, when the capture came from the model. */
  readonly logicalRequestId?: string | null;
  /** One physical dispatch, when the capture came from a transport send. */
  readonly attemptId?: string | null;
  /** Stable identifier for the specific call this capture describes. */
  readonly callId?: string | null;
  readonly graphEpoch: string;
  /** Task revision in force when the capture was admitted. */
  readonly acceptedRevision?: number | null;
  readonly requirementRevision?: number | null;
}

/**
 * One immutable capture.
 *
 * `payloadDigest` is over the canonical normalized payload as stored in
 * `payload`; `rawContentDigest` is over the original bytes when they were
 * archived. They are different facts. M02 wrote the artifact digest into
 * `payload_digest`, which this contract separates and repairs explicitly rather
 * than pretending history was captured differently.
 */
export interface CaptureEnvelope {
  readonly id: string;
  readonly kind: CaptureKind;
  readonly origin: CaptureOrigin;
  readonly schemaVersion: number;
  /** Stable key that identifies this evidence across redelivery. */
  readonly sourceKey: string;
  /** Per-session position, allocated by the server, never by the caller. */
  readonly captureSeq: number;
  /** Digest of the canonical normalized payload. */
  readonly payloadDigest: string;
  /** Digest of the archived original bytes, when any were archived. */
  readonly rawContentDigest?: string | null;
  readonly rawArtifactId?: string | null;
  readonly observedAt: string;
  readonly capturedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * What happened when a capture was admitted.
 *
 * `replayed` means the identical payload arrived again under the same key and
 * the original identity and position were returned. `conflict` means the key
 * was reused with different content, which is never silently accepted.
 */
export type CaptureOutcome =
  | { readonly kind: 'appended'; readonly envelope: CaptureEnvelope }
  | { readonly kind: 'replayed'; readonly envelope: CaptureEnvelope }
  | { readonly kind: 'conflict'; readonly sourceKey: string };

/**
 * Fields every capture carries.
 */
export interface CaptureAppendBase {
  readonly correlation: CaptureCorrelation;
  readonly origin: CaptureOrigin;
  readonly sourceKey: string;
  readonly observedAt: Date;
  /** Original safe bytes, when this evidence has an archived form. */
  readonly rawBytes?: Buffer | null;
  readonly rawArtifactKind?: 'model_input' | 'model_response' | 'tool_input' | 'tool_output';
  readonly rawMediaType?: string;
}

/**
 * The three model kinds, as a discriminated union.
 *
 * Model evidence is not a free-form payload: a partial chunk and a complete
 * terminal output are different facts with different consequences, and an
 * arbitrary payload object cannot express that. So completeness and the
 * references to the existing M02 rows are typed here rather than lifted out of
 * a payload at runtime.
 */
export type ModelCaptureAppendInput =
  | (CaptureAppendBase & {
      readonly kind: 'model.input';
      readonly completeness: CaptureCompleteness;
      readonly references: EvidenceReferences;
      readonly payload: Readonly<Record<string, unknown>>;
    })
  | (CaptureAppendBase & {
      readonly kind: 'model.output.complete' | 'model.output.partial';
      readonly completeness: CaptureCompleteness;
      readonly references: EvidenceReferences;
      /** Monotonic index within the logical request, for reassembly. */
      readonly chunkIndex?: number | null;
      readonly usage?: ModelUsageObservation | null;
      readonly payload: Readonly<Record<string, unknown>>;
    });

/** Non-model evidence keeps only the fields that apply to it. */
export type NonModelCaptureAppendInput = (CaptureAppendBase & {
  readonly kind: Exclude<CaptureKind, 'model.input' | 'model.output.complete' | 'model.output.partial'>;
  readonly payload: Readonly<Record<string, unknown>>;
}) & Partial<Pick<ModelCaptureAppendInput, 'references'>>;

/**
 * The append input is discriminated on `kind`.
 *
 * Passing a model kind without `completeness` or `references` is a compile
 * error, and a caller that reaches the boundary with the wrong shape anyway is a
 * typed refusal rather than a lifted payload.
 */
export type CaptureAppendInput = ModelCaptureAppendInput | NonModelCaptureAppendInput;

/** A model kind, for runtime validation of an untyped boundary. */
export function isModelCaptureKind(value: unknown): boolean {
  return (
    value === 'model.input' || value === 'model.output.complete' || value === 'model.output.partial'
  );
}

/* ------------------------------------------------------------------ */
/* Model evidence envelopes                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Range and output limits — resolved once, published once             */
/* ------------------------------------------------------------------ */

/** Base64 encodes 3 bytes into 4 characters. */
export const BASE64_CHARS_PER_3_BYTES = 4;

/**
 * `tool_limits.file_read_max_bytes`: the largest Source range the
 * **inspection** API returns, in original bytes. Unchanged from what
 * `workspace_read` already enforces.
 */
export const SOURCE_RANGE_MAX_BYTES = 32_768;

/**
 * `tool_limits.model_tool_output_max_bytes`: the ceiling on the **serialized
 * tool-result envelope** handed to a model.
 *
 * This is a different quantity from `SOURCE_RANGE_MAX_BYTES` and the
 * difference matters: a 32768-byte Source range base64-encodes to 43692
 * characters, which already exceeds this ceiling before any JSON metadata is
 * added. So the model-facing range must be *smaller* than the inspection range,
 * while the inspection API keeps the full 32 KiB of original bytes.
 */
export const MODEL_TOOL_OUTPUT_MAX_BYTES = 32_768;

/** Base64 character length of `bytes` original bytes. */
export function base64LengthFor(bytes: number): number {
  return Math.ceil(bytes / 3) * BASE64_CHARS_PER_3_BYTES;
}

/**
 * The exact serialized size of a Source range as it travels to a model.
 *
 * Budgeting the next request must use this, never the original byte count: the
 * two differ by roughly a third once base64 is applied, so budgeting on the
 * original count would under-reserve every Source read.
 */
export function serializedSourceRangeBytes(
  envelope: {
    readonly sourceId: string;
    readonly contentDigest: string;
    readonly offset: number;
    readonly returnedBytes: number;
    readonly totalBytes: number;
  },
): number {
  return Buffer.byteLength(
    JSON.stringify({
      sourceId: envelope.sourceId,
      contentDigest: envelope.contentDigest,
      byteSize: envelope.totalBytes,
      serializedBytes: MODEL_TOOL_OUTPUT_MAX_BYTES,
      offset: envelope.offset,
      returnedBytes: envelope.returnedBytes,
      truncated: true,
      totalBytes: envelope.totalBytes,
      base64: '',
    }),
    'utf8',
  ) + base64LengthFor(envelope.returnedBytes);
}

/**
 * The largest original-byte range whose serialized envelope still fits
 * `MODEL_TOOL_OUTPUT_MAX_BYTES`.
 *
 * Measured rather than estimated: a worst-case envelope is built with the
 * longest permitted identifiers and the largest offsets, and the bound is found
 * by construction. The result is deliberately conservative, so a real envelope
 * can only ever be smaller.
 */
export function modelFacingSourceRangeMaxBytes(): number {
  // Worst case the schema permits: a full uuid, a full sha-256, and a total
  // size large enough to render every digit.
  const overhead = serializedSourceRangeBytes({
    sourceId: 's'.repeat(128),
    contentDigest: 'f'.repeat(64),
    offset: Number.MAX_SAFE_INTEGER,
    returnedBytes: 0,
    totalBytes: Number.MAX_SAFE_INTEGER,
  });
  // Found by construction rather than closed-form arithmetic: a hand-derived
  // formula for this is where a small rounding error hides, and two bytes over
  // the ceiling is still over it. Step down in whole base64 groups.
  let candidate = Math.floor((MODEL_TOOL_OUTPUT_MAX_BYTES - overhead) / BASE64_CHARS_PER_3_BYTES) * 3;
  while (candidate > 0) {
    if (
      serializedSourceRangeBytes({
        sourceId: 's'.repeat(128),
        contentDigest: 'f'.repeat(64),
        offset: Number.MAX_SAFE_INTEGER,
        returnedBytes: candidate,
        totalBytes: Number.MAX_SAFE_INTEGER,
      }) <= MODEL_TOOL_OUTPUT_MAX_BYTES
    ) {
      return candidate;
    }
    candidate -= 3;
  }
  return 0;
}

/**
 * The model-facing Source range maximum, rounded down to a whole base64 group.
 *
 * Published as a constant so no consumer reproduces the arithmetic.
 */
export const MODEL_FACING_SOURCE_RANGE_MAX_BYTES = modelFacingSourceRangeMaxBytes();

/**
 * How a capture relates to evidence that already exists durably.
 *
 * Model input and model output are **not** stored twice. The exact bytes are
 * already published as artifacts by the M02 journal and referenced by the
 * `model_requests` row; a capture event names those rows and adds only the
 * ordering and provenance facts the journal does not carry.
 */
export interface EvidenceReferences {
  /** The M02 `model_requests` row for a dispatch. */
  readonly modelRequestId?: string | null;
  /** The M02 artifact holding the exact bytes that were sent. */
  readonly inputArtifactId?: string | null;
  /** The M02 artifact holding the complete permitted terminal output. */
  readonly responseArtifactId?: string | null;
  /** The `tool_executions` row for a read-tool call. */
  readonly toolExecutionId?: string | null;
  /** The artifact holding a registered command's observed output. */
  readonly outputArtifactId?: string | null;
}

/**
 * What a capture asserts about completeness.
 *
 * This is the distinction that keeps a streamed partial chunk from being
 * mistaken for a finished turn. `terminal: false` means the turn is still in
 * flight: it may not release a tool, may not satisfy a terminal settlement and
 * may not be reported as success.
 */
export type CaptureCompleteness = 'partial' | 'complete' | 'final';

/**
 * A capture of model input or output.
 *
 * `partial` chunks are evidence that something was observed, never evidence
 * that the turn finished. They exist so a gap is visible rather than silent.
 */
export interface ModelUsageObservation {
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
}

export interface ModelEvidenceEnvelope extends CaptureEnvelope {
  readonly kind: 'model.input' | 'model.output.complete' | 'model.output.partial';
  readonly references: EvidenceReferences;
  readonly completeness: CaptureCompleteness;
  /** Monotonic index within this logical request, for reassembly. */
  readonly chunkIndex?: number | null;
  /**
   * Observed usage, when the provider reported it. Absent is `null`, never
   * zero: an unmeasured count must not read as a measurement.
   */
  readonly usage?: { readonly inputTokens?: number | null; readonly outputTokens?: number | null } | null;
}

/**
 * Whether a capture may release dependent work.
 *
 * A single predicate, so the tool-release path and the settlement path cannot
 * disagree about what counts as finished.
 */
export function mayReleaseDependentWork(envelope: CaptureEnvelope): boolean {
  if (envelope.kind === 'model.output.partial') {
    return false;
  }
  if (envelope.kind === 'model.output.complete') {
    const completeness = (envelope as Partial<ModelEvidenceEnvelope>).completeness;
    return completeness === 'complete' || completeness === 'final';
  }
  if (envelope.kind === 'model.input') {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

/**
 * Artifact kinds. The first four existed in M02; the rest are M03 evidence.
 */
export const ARTIFACT_KINDS = [
  'model_input',
  'model_response',
  'tool_input',
  'tool_output',
  'registered_command_output',
  'diagnostic_output',
  'episode',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type ArtifactVisibility = 'project' | 'user' | 'session';
export type ArtifactStatus = 'available' | 'missing' | 'tombstoned';

/**
 * These three identities are deliberately distinct and must never be conflated.
 *
 * - **content identity** (`contentDigest`) is what the bytes are. Two artifacts
 *   with the same digest hold identical bytes.
 * - **physical locator** (`storageKey`) is where the backend keeps them. It is
 *   backend-chosen, is never returned to a client or a model, and may change.
 * - **scoped identity** (`artifactId` within tenant/project) is who may read
 *   them. Identical bytes under different scopes are different artifacts with
 *   different readers, which is why sharing a digest never implies sharing
 *   access.
 */
export interface ArtifactIdentity {
  readonly artifactId: string;
  readonly contentDigest: string;
  readonly storageKey: string;
  readonly kind: ArtifactKind;
  readonly byteSize: number;
  readonly visibility: ArtifactVisibility;
  readonly ownerUserId?: string | null;
  readonly ownerSessionId?: string | null;
  readonly status: ArtifactStatus;
}

/**
 * A byte range of an artifact.
 *
 * Ranges are byte offsets, never character offsets, and the returned slice is
 * base64 so arbitrary binary content survives the transport intact. Decoding
 * must not assume UTF-8: a range may legitimately split a multi-byte character.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  /** Base64 of exactly `end - start` bytes. */
  readonly base64: string;
}

/**
 * Who is asking. Every read is checked against this, on every read, including
 * after a grant has been revoked.
 */
export interface SourceReader {
  readonly tenantId: string;
  readonly userId: string;
  readonly projectId: string;
  /** Present when the read is attributed to a specific human session. */
  readonly userSessionId?: string | null;
  /** Builder session, resolved by the backend; distinct from the human session. */
  readonly agentSessionId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Source and replay                                                   */
/* ------------------------------------------------------------------ */

/**
 * A durable, ordered position for replay.
 *
 * The four positions are distinct and must not be interchanged: the session
 * capture sequence, the project graph event sequence within an epoch, the SQL
 * projection consumer offset, and this client cursor. A process-local SSE
 * number is none of them.
 */
export interface ReplayCursor {
  readonly graphEpoch: string;
  readonly afterSeq: number;
}

export interface ReplayPage {
  readonly admission?: { readonly pending: number; readonly quarantined: number; readonly oldestPendingAt: string | null };
  readonly frames: readonly ReplayFrame[];
  readonly cursor: ReplayCursor;
  /**
   * True when the page stopped short of the requested bound because of the
   * page limit, so the caller knows to keep reading.
   */
  readonly hasMore: boolean;
  /**
   * Set when ordered evidence is missing between `afterSeq` and the first
   * frame. A caller must be shown this rather than silently skipping it.
   */
  readonly gap?: { readonly fromSeq: number; readonly toSeq: number } | null;
}

export interface ReplayFrame {
  readonly seq: number;
  readonly graphEpoch: string;
  readonly kind: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadDigest: string;
  readonly committedAt: string;
}

/* ------------------------------------------------------------------ */
/* Service ports                                                       */
/* ------------------------------------------------------------------ */

/**
 * Bounds every implementation must honour.
 *
 * The values come from the development profile rather than being invented here,
 * so an exhausted outbox retries and quarantines on the same schedule the
 * profile documents.
 */
export interface CaptureLimits {
  readonly maxPageFrames: number;
  readonly maxPayloadBytes: number;
  readonly maxAttempts: number;
  readonly outboxLeaseMs: number;
  readonly outboxPollMs: number;
  readonly retryDelaysMs: readonly number[];
}

/**
 * Durable, ordered capture with an outbox that commits with it.
 *
 * A returned outcome means the capture row and its outbox entry are both
 * durable. A rejection means neither is, so no dependent dispatch may proceed.
 */
export interface CaptureService {
  append(input: CaptureAppendInput): Promise<CaptureOutcome>;
  /** Ordered page of one session's captures. */
  readOrdered(
    reader: SourceReader,
    agentSessionId: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ readonly envelopes: readonly CaptureEnvelope[]; readonly hasMore: boolean }>;
  /** Records an explicit unobserved interval; never synthesizes content. */
  recordGap(input: {
    readonly correlation: CaptureCorrelation;
    readonly fromSeq: number;
    readonly toSeq?: number | null;
    readonly reason: string;
  }): Promise<{ readonly gapId: string }>;
}

/**
 * The SQL-to-graph delivery worker.
 */
export interface CaptureOutboxService {
  /** Claims a bounded batch under lease and delivers it. */
  drainOnce(ownerId: string): Promise<{ readonly claimed: number; readonly committed: number; readonly quarantined: number }>;
  /** Status of pending evidence, for an operator and for the UI. */
  status(reader: SourceReader): Promise<{
    readonly pending: number;
    readonly leased: number;
    readonly quarantined: number;
    readonly oldestPendingAt?: string | null;
    readonly quarantinedOperations?: readonly QuarantinedOperation[];
  }>;
  /**
   * Resolves work whose lease no longer covers it, e.g. after a crash.
   *
   * Not scoped to a caller: an expired lease belongs to nobody, and the worker
   * that held it is usually the one that died.
   */
  recoverExpired(): Promise<{ readonly recovered: number }>;
  stop(): Promise<void>;
}

export interface QuarantinedOperation {
  readonly operationId: string;
  readonly sourceKey: string;
  readonly attempts: number;
  readonly lastErrorCode: string | null;
}

/**
 * Authorized, bounded inspection of captured bytes.
 *
 * A digest or a metadata row is never proof that bytes are available: every read
 * verifies the bytes it returns.
 */
export interface SourceService {
  metadata(reader: SourceReader, artifactId: string): Promise<SourceMetadata>;
  readRange(
    reader: SourceReader,
    artifactId: string,
    start: number,
    end: number,
  ): Promise<SourceRange>;
  /**
   * Marks bytes unavailable after a disappearance, so reads fail loudly.
   *
   * Takes the reader so the write is fenced by that tenant rather than escaping
   * the row-level tenant boundary.
   */
  markMissing(reader: SourceReader, artifactId: string, reason: string): Promise<void>;
}

/**
 * The authoritative state of a Source **for this reader**.
 *
 * Stated by the service rather than inferred by the caller from an error
 * message. A caller that sniffs `reason` for "denied" would reintroduce exactly
 * the leak this type exists to prevent.
 */
export type SourceState =
  | 'available'
  /** Genuinely absent, or the reader may not know whether it exists. */
  | 'absent'
  /** Recorded and readable, but the bytes are gone or were retired. */
  | 'unavailable'
  /** The reader is in scope and the evidence is genuinely not yet readable. */
  | 'pending';

export interface SourceMetadata {
  readonly identity: ArtifactIdentity;
  readonly available: boolean;
  readonly reason?: string | null;
  /**
   * Present for authorized readers. Callers outside the Source's scope always
   * observe `absent`, so absence and inaccessibility stay indistinguishable.
   */
  readonly state?: SourceState;
}

/**
 * Ordered graph-event replay for the CLI and any other consumer.
 */
export interface ReplayService {
  /** Bounded catch-up from a durable cursor, then live handoff. */
  replay(reader: SourceReader, cursor: ReplayCursor, limit: number): Promise<ReplayPage>;
  /** The contiguous position this consumer may resume from. */
  cursor(reader: SourceReader): Promise<ReplayCursor>;
}