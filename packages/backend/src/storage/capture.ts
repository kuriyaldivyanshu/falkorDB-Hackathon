import { createHash, randomUUID } from 'node:crypto';

import {
  ThreadlineError,
  CAPTURE_SCHEMA_VERSION,
  isCaptureKind,
  isModelCaptureKind,
  type CaptureAppendInput,
  type CaptureCorrelation,
  type CaptureEnvelope,
  type EvidenceReferences,
  type ModelEvidenceEnvelope,
  type ModelUsageObservation,
  type CaptureKind,
  type CaptureOrigin,
  type CaptureOutcome,
  type CaptureService,
} from '@threadline/shared';

import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { ArtifactWriter } from './artifacts.js';
import { canonicalDigest, canonicalize } from './digest.js';
import type { SqlDatabase, TxClient } from './pg.js';

/**
 * Durable, ordered capture.
 *
 * This is the single append boundary for evidence. It exists because M02 wrote
 * capture rows directly from `domain/execution.ts`, which left three problems
 * this module fixes:
 *
 * - **Sequence allocation was not concurrency-safe.** It read
 *   `max(capture_seq) + 1`, so two concurrent turns in one session could pick
 *   the same position. `agent_sessions.capture_seq` already exists for exactly
 *   this and is incremented atomically per row here.
 * - **`payload_digest` held the artifact digest, not the payload digest.** The
 *   two are different facts. `payload_digest` is now the digest of the
 *   canonical normalized payload, and `raw_artifact_id` carries the original
 *   bytes. Rows written by M02 are left exactly as they are; this module
 *   reports the legacy shape rather than pretending history was captured
 *   differently.
 * - **There was no outbox.** A capture committed without any way to admit it to
 *   the graph. The outbox row now commits in the same transaction, so a
 *   committed capture always has a delivery record and a rejected append leaves
 *   neither.
 */

export interface CaptureStoreDeps {
  readonly db: SqlDatabase;
  readonly artifacts: ArtifactWriter;
  readonly clock: () => Date;
  /** Allocates graph operation ids; injected so tests are deterministic. */
  readonly allocateOperationId?: () => string;
  readonly logger?: Logger;
}

export interface CaptureStore extends CaptureService {
  /** Diagnostic for M02 rows that stored an artifact digest as payload_digest. */
  legacyDigestReport(
    tenantId: string,
    projectId: string,
    agentSessionId: string,
  ): Promise<readonly { readonly sourceKey: string; readonly captureSeq: number }[]>;
}

interface CaptureRow {
  id: string;
  source_key: string;
  capture_seq: string;
  kind: CaptureKind;
  payload: unknown;
  payload_digest: string;
  raw_artifact_id: string | null;
  observed_at: Date;
  captured_at: Date;
}

/**
 * Validates one capture envelope before anything is written.
 *
 * Validation happens at the boundary because a malformed payload that reaches
 * the graph becomes a fabricated fact nobody can trace back.
 */
function validateInput(input: CaptureAppendInput): void {
  if (!isCaptureKind(input.kind)) {
    throw new ThreadlineError('invalid_request', 'That capture kind is not recognised.', {
      kind: String(input.kind),
    });
  }
  if (typeof input.sourceKey !== 'string' || input.sourceKey.length === 0 || input.sourceKey.length > 512) {
    throw new ThreadlineError('invalid_request', 'A capture needs a stable source key.');
  }
  if (Number(input.rawBytes?.byteLength ?? 0) > MAX_CAPTURE_BYTES) {
    throw new ThreadlineError('invalid_request', 'The captured bytes exceed the capture limit.', {
      limit: MAX_CAPTURE_BYTES,
    });
  }
  if (!Number.isFinite(input.observedAt.getTime())) {
    throw new ThreadlineError('invalid_request', 'A capture needs a real observation time.');
  }
  validateModelFields(input);
}

/** Bounded well above any single turn, well below anything harmful. */
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

/**
 * Runtime validation of the discriminated append contract.
 *
 * The types already refuse a model capture without `completeness` or
 * `references`, but a caller arriving from an untyped boundary -- an HTTP route,
 * a decoded payload -- can still do it. This refuses rather than lifting those
 * facts out of the payload object, because a lifted field is indistinguishable
 * from a fact nobody actually asserted.
 */
function validateModelFields(input: CaptureAppendInput): void {
  if (!isModelCaptureKind(input.kind)) {
    return;
  }
  const model = input as { completeness?: unknown; references?: unknown };
  if (model.completeness !== 'partial' && model.completeness !== 'complete' && model.completeness !== 'final') {
    throw new ThreadlineError('invalid_request', 'Model evidence requires a typed completeness.', {
      kind: input.kind,
      received: typeof model.completeness,
    });
  }
  if (
    typeof model.references !== 'object' ||
    model.references === null ||
    Array.isArray(model.references)
  ) {
    throw new ThreadlineError('invalid_request', 'Model evidence requires typed references to the journal.', {
      kind: input.kind,
    });
  }
  // A partial chunk may not claim completion. That single rule is what stops a
  // streamed fragment from ever satisfying a terminal check.
  if (input.kind === 'model.output.partial' && model.completeness !== 'partial') {
    throw new ThreadlineError('invalid_request', 'A partial chunk cannot claim complete output.', {
      kind: input.kind,
      completeness: model.completeness,
    });
  }
}

export function createCaptureStore(deps: CaptureStoreDeps): CaptureStore {
  const logger = deps.logger ?? silentLogger;
  const clock = deps.clock;
  const allocateOperationId = deps.allocateOperationId ?? (() => randomUUID());

  /**
   * Allocates the next capture position for a session.
   *
   * The row update is the allocation: PostgreSQL takes the row lock, so two
   * concurrent callers are serialized and each receives a distinct position. A
   * redelivery that resolves as a replay never reaches here, so a retry cannot
   * advance the sequence.
   */
  const allocateCaptureSeq = async (tx: TxClient, correlation: CaptureCorrelation): Promise<number> => {
    const rows = await tx.rows<{ capture_seq: string }>(
      `UPDATE threadline.agent_sessions
          SET capture_seq = GREATEST(capture_seq,
             COALESCE((SELECT max(c.capture_seq) FROM threadline.capture_events c
               WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.agent_session_id=$3),0)) + 1
        WHERE tenant_id = $1 AND project_id = $2 AND id = $3
        RETURNING capture_seq`,
      [correlation.tenantId, correlation.projectId, correlation.agentSessionId],
    );
    const allocated = rows[0]?.capture_seq;
    if (allocated === undefined) {
      throw new ThreadlineError('not_found', 'No agent session exists for that capture.');
    }
    const seq = Number(allocated);
    if (!Number.isSafeInteger(seq) || seq <= 0) {
      throw new ThreadlineError('internal_error', 'The allocated capture position is not a positive integer.');
    }
    return seq;
  };

  return {
    async append(input: CaptureAppendInput): Promise<CaptureOutcome> {
      validateInput(input);
      const { correlation } = input;

      // Typed model facts are folded into the stored payload under reserved
      // keys so a read-back returns the same envelope type, rather than leaving
      // completeness to be inferred from the payload at read time.
      const storedPayload: Record<string, unknown> = { ...input.payload };
      if (isModelCaptureKind(input.kind)) {
        const model = input as { completeness?: string; references?: unknown; chunkIndex?: number | null; usage?: unknown };
        storedPayload['completeness'] = model.completeness;
        storedPayload['references'] = model.references;
        if (model.chunkIndex !== undefined && model.chunkIndex !== null) {
          storedPayload['chunkIndex'] = model.chunkIndex;
        }
        if (model.usage !== undefined) {
          storedPayload['usage'] = model.usage;
        }
      }
      // The normalized payload is canonicalized before anything is hashed, so
      // property order cannot turn a retry into a conflict.
            storedPayload['captureVersion'] = CAPTURE_SCHEMA_VERSION;
      storedPayload['correlation'] = correlation;
      storedPayload['origin'] = input.origin;
      if (input.rawBytes) storedPayload['rawContentDigest'] = createHash('sha256').update(input.rawBytes).digest('hex');
      if ('references' in input && input.references) storedPayload['references'] = input.references;
      const payloadDigest = canonicalDigest(storedPayload as never);
      const normalized = canonicalize(storedPayload as never);
      if (Buffer.byteLength(normalized) > MAX_CAPTURE_BYTES) throw new ThreadlineError('invalid_request', 'Capture payload exceeds its limit.');

      // Original bytes are archived first: a capture row that references bytes
      // which were never published would point at nothing.
      const artifact =
        input.rawBytes === undefined || input.rawBytes === null
          ? null
          : await deps.artifacts.publish({
              tenantId: correlation.tenantId,
              projectId: correlation.projectId,
              kind: input.rawArtifactKind ?? 'episode',
              bytes: input.rawBytes,
              id: randomUUID(),
            });

      const outcome = await deps.db.withTenantTransaction(correlation.tenantId, async (tx): Promise<CaptureOutcome> => {
        // Lock the session before checking the dedup key. Concurrent identical
        // appends serialize here and reuse the original position.
        const sessions = await tx.rows<{ capture_seq: string }>(
          `SELECT capture_seq FROM threadline.agent_sessions
            WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND run_id=$4 AND task_graph_id=$5
            FOR UPDATE`,
          [correlation.tenantId, correlation.projectId, correlation.agentSessionId, correlation.runId, correlation.taskId]);
        if (!sessions[0]) throw new ThreadlineError('not_found', 'The capture session binding is unavailable.');
        const previous = await tx.rows<CaptureRow>(
          `SELECT * FROM threadline.capture_events
            WHERE tenant_id=$1 AND project_id=$2 AND agent_session_id=$3 AND source_key=$4`,
          [correlation.tenantId, correlation.projectId, correlation.agentSessionId, input.sourceKey]);
        if (previous[0]) {
          return previous[0].payload_digest.trim() === payloadDigest
            ? { kind: 'replayed', envelope: toEnvelope(previous[0]) }
            : { kind: 'conflict', sourceKey: input.sourceKey };
        }
        const references = 'references' in input ? input.references : undefined;
        const referencedArtifact = input.kind === 'model.input' ? references?.inputArtifactId
          : input.kind === 'model.output.complete' ? references?.responseArtifactId
          : input.kind === 'model.output.partial' ? null : references?.outputArtifactId ?? references?.inputArtifactId;
        const artifactId = artifact?.id ?? referencedArtifact ?? null;
        if (artifactId) {
          const rows = await tx.rows<{ id: string }>(
            `SELECT id FROM threadline.artifacts WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,
            [correlation.tenantId, correlation.projectId, artifactId]);
          if (!rows[0]) throw new ThreadlineError('not_found', 'The evidence artifact binding is unavailable.');
        }
        const captureSeq = await allocateCaptureSeq(tx, correlation);
        const id = randomUUID();
        const rows = await tx.rows<CaptureRow>(
          `INSERT INTO threadline.capture_events
             (tenant_id, project_id, id, agent_session_id, source_key, capture_seq, kind,
              payload, payload_digest, raw_artifact_id, observed_at, captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [correlation.tenantId, correlation.projectId, id, correlation.agentSessionId,
            input.sourceKey, captureSeq, input.kind, normalized, payloadDigest, artifactId, input.observedAt, clock()]);
        await tx.rows(
          `INSERT INTO threadline.capture_outbox
             (tenant_id, project_id, id, capture_event_id, operation_id, request_digest,
              status, attempts, next_attempt_at, created_at, graph_epoch)
           VALUES ($1,$2,$3,$4,$5,$6,'pending',0,$7,$7,$8)`,
          [correlation.tenantId, correlation.projectId, randomUUID(), id, allocateOperationId(), payloadDigest, clock(), correlation.graphEpoch]);
        return { kind: 'appended', envelope: toEnvelope(rows[0]!) };
      });

      logger.log({
        level: 'info',
        message: 'Capture appended with its outbox entry.',
        fields: {
          correlationId: correlation.graphEpoch,
          sourceKey: input.sourceKey,
          kind: input.kind,
          hasRawBytes: artifact !== null,
        },
      });

      return outcome;
    },

    async readOrdered(reader, agentSessionId, afterSeq, limit) {
      // Access is checked on every read, not once at session start: a grant
      // revoked mid-run must stop the next read.
      await requireActiveMember(deps.db, reader.tenantId, reader.projectId, reader.userId);
      const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_CAPTURE_PAGE);
      const rows = await deps.db.withTenantTransaction(reader.tenantId, (tx) =>
        tx.rows<CaptureRow>(
          `SELECT id, source_key, capture_seq, kind, payload, payload_digest,
                  raw_artifact_id, observed_at, captured_at
             FROM threadline.capture_events
            WHERE tenant_id = $1 AND project_id = $2 AND agent_session_id = $3
              AND capture_seq > $4
            ORDER BY capture_seq ASC
            LIMIT $5`,
          [reader.tenantId, reader.projectId, agentSessionId, Math.max(0, Math.trunc(afterSeq)), bounded + 1],
        ),
      );
      const page = rows.slice(0, bounded);
      return {
        envelopes: page.map(toEnvelope),
        hasMore: rows.length > bounded,
      };
    },

    async recordGap(input) {
      const id = randomUUID();
      const { correlation } = input;
      await deps.db.withTenantTransaction(correlation.tenantId, (tx) =>
        tx.rows(
          `INSERT INTO threadline.capture_gaps
             (tenant_id, project_id, id, agent_session_id, from_seq, to_seq, reason, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')`,
          [
            correlation.tenantId,
            correlation.projectId,
            id,
            correlation.agentSessionId,
            input.fromSeq,
            input.toSeq ?? null,
            input.reason,
          ],
        ),
      );
      return { gapId: id };
    },

    async legacyDigestReport(tenantId, projectId, agentSessionId) {
      const rows = await deps.db.withTenantTransaction(tenantId, tx => tx.rows<{source_key:string;capture_seq:string}>(
        `SELECT c.source_key,c.capture_seq FROM threadline.capture_events c
          JOIN threadline.artifacts a ON a.tenant_id=c.tenant_id AND a.project_id=c.project_id AND a.id=c.raw_artifact_id
          WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.agent_session_id=$3
            AND c.payload->>'captureVersion' IS NULL AND c.payload_digest=a.content_digest
          ORDER BY c.capture_seq LIMIT 500`,[tenantId,projectId,agentSessionId]));
      return rows.map(row=>({sourceKey:row.source_key,captureSeq:Number(row.capture_seq)}));
    },
  };
}

/** The shared brief's bound on one replay/capture page. */
export const MAX_CAPTURE_PAGE = 500;

/**
 * Confirms the caller still has access at read time.
 *
 * A membership row that has been revoked stops the read even though the same
 * caller may have read moments earlier.
 */
export async function requireActiveMember(
  db: SqlDatabase,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const rows = await db.withTenantTransaction(tenantId, (tx) =>
    tx.rows<{ status: string }>(
      `SELECT pm.status FROM threadline.project_memberships pm
        JOIN threadline.tenant_memberships tm ON tm.tenant_id=pm.tenant_id AND tm.user_id=pm.user_id AND tm.status='active'
        JOIN threadline.users u ON u.id=pm.user_id AND u.status='active'
        WHERE pm.tenant_id = $1 AND pm.project_id = $2 AND pm.user_id = $3`,
      [tenantId, projectId, userId],
    ),
  );
  const status = rows[0]?.status;
  if (status !== 'active') {
    throw new ThreadlineError('unauthorized', 'The reader is not an active member of this project.', {
      reason: 'membership_inactive',
    });
  }
}

/**
 * Rebuilds the stored row into the typed envelope its kind implies.
 *
 * A model capture comes back as a `ModelEvidenceEnvelope` carrying its typed
 * `completeness` and `references`, so a consumer never re-derives them from the
 * payload. A non-model capture stays a plain `CaptureEnvelope`.
 */
function toEnvelope(row: CaptureRow): CaptureEnvelope {
  const payload =
    typeof row.payload === 'string'
      ? (JSON.parse(row.payload) as Record<string, unknown>)
      : (row.payload as Record<string, unknown>);

  if (payload['captureVersion'] !== undefined && payload['captureVersion'] !== CAPTURE_SCHEMA_VERSION)
    throw new ThreadlineError('schema_incompatible','Unsupported capture envelope version.');
  const base = {
    id: row.id,
    kind: row.kind,
    origin: (payload['origin'] as CaptureOrigin | undefined) ?? inferOrigin(row.kind),
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    sourceKey: row.source_key,
    captureSeq: Number(row.capture_seq),
    payloadDigest: row.payload_digest.trim(),
    rawContentDigest: null,
    rawArtifactId: row.raw_artifact_id,
    observedAt: row.observed_at.toISOString(),
    capturedAt: row.captured_at.toISOString(),
    payload,
  };

  if (isModelCaptureKind(row.kind)) {
    const completeness = payload['completeness'];
    const references = payload['references'];
    // Only a stored capture that actually validated carries these, so the cast
    // is guarded rather than assumed.
    const typed =
      (completeness === 'partial' || completeness === 'complete' || completeness === 'final') &&
      typeof references === 'object' && references !== null && !Array.isArray(references)
        ? (completeness as 'partial' | 'complete' | 'final')
        : 'partial';
    return {
      ...base,
      completeness: typed,
      references: (references ?? {}) as EvidenceReferences,
      chunkIndex:
        typeof payload['chunkIndex'] === 'number' ? payload['chunkIndex'] : null,
      usage: (payload['usage'] as ModelUsageObservation | undefined) ?? null,
    } as ModelEvidenceEnvelope;
  }
  return base as CaptureEnvelope;
}

function inferOrigin(kind: CaptureKind): CaptureOrigin {
  if (kind === 'tool.intent' || kind === 'tool.result') {
    return 'tool';
  }
  if (kind === 'registered_command.observation' || kind === 'diagnostic.observation') {
    return 'registered_command';
  }
  return 'model';
}