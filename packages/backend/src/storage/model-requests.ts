import { createHash, randomUUID } from 'node:crypto';

import { ThreadlineError } from '@threadline/shared';

import type { AttemptState, PreparedAttempt, ProviderLifecycle, SettledAttempt, TerminalRecord, UsageObservation } from '../runtime/contracts.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import type { ArtifactWriter } from './artifacts.js';
import { toSafeInteger } from './inbox.js';
import { decideTurnBudget, estimateRequestTokens, readModelCapacity, requireCapacity } from './budget.js';
import { withProjectAdmissionLock, type SqlDatabase } from './pg.js';

/**
 * The durable model-turn journal.
 *
 * The contract this file exists to keep:
 *
 * - `prepared` is written **before** any request is sent, together with a real
 *   budget reservation. Nothing is dispatched without it.
 * - `dispatched` is written only when this process actually invoked the
 *   transport. It is not evidence the provider received or accepted anything.
 * - `completed` requires a readable response artifact and a finished timestamp.
 * - `unknown` retains the reservation and blocks further attempts. An unknown
 *   attempt is never automatically replayed under a new id.
 * - usage is `reported`, `reserved` or `known-zero`. It is never zero-filled.
 *   The SQL `usage_ledger.precision` column only admits
 *   `reported|estimated|unknown`, so the mapping is explicit: `reported` stays
 *   reported, `known-zero` becomes a reported zero (it is observed), and
 *   `reserved` becomes `unknown` with no numbers, with the conservative amount
 *   retained through `reservation_graph_id`.
 */

export interface ModelRequestRow {
  readonly id: string;
  readonly logicalRequestId: string;
  readonly attemptNo: number;
  readonly status: AttemptState;
  readonly providerRequestId: string | null;
  readonly inputArtifactId: string;
  readonly inputDigest: string;
  readonly responseArtifactId: string | null;
  readonly usage: UsageObservation;
  readonly possibleCharge: boolean;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

/**
 * Identity every journal write needs.
 *
 * Kept separate from `JournalScope` so a transport lifecycle observation can be
 * recorded without inventing budget or profile facts it never verified.
 */
export interface JournalIdentityScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly profileId: string;
  readonly taskId: string;
  readonly graphEpoch: string;
  readonly requirementRevision: number;
  readonly correlationId: string;
}

export interface JournalScope extends JournalIdentityScope {
  /** Immutable digest of the admitted provider profile configuration. */
  readonly profileConfigDigest: string;
  /** The admitted profile's settings, which declare its effective capacity. */
  readonly profileSettings: Readonly<Record<string, unknown>>;
  /** True only for a profile explicitly labelled as a test fixture. */
  readonly profileIsFixture: boolean;
  /** The run's whole-input token budget. */
  readonly maxTotalTokens: number;
}

/**
 * One durable attempt, read back for inspection and audit.
 *
 * `inputDigest` and `profileDigest` are carried separately and deliberately:
 * an audit that cannot tell them apart cannot tell which profile produced a
 * turn.
 */
export interface ModelRequestAudit {
  readonly id: string;
  readonly logicalRequestId: string;
  readonly attemptNo: number;
  readonly attemptId: string;
  readonly providerRequestId: string | null;
  readonly state: string;
  readonly inputArtifactId: string;
  readonly inputDigest: string;
  readonly profileDigest: string;
  readonly responseArtifactId: string | null;
  readonly usageSourceKey: string | null;
  readonly failureCode: string | null;
  readonly graphEpoch: string;
  readonly requirementRevision: number;
  readonly createdAt: Date;
  readonly dispatchedAt: Date | null;
  readonly possibleCharge: boolean | null;
  readonly finishedAt: Date | null;
}

export interface PreparedAttemptRecord {
  readonly attemptRowId: string;
  readonly attemptNo: number;
  readonly reservationId: string;
  readonly reservedTokens: number;
  readonly estimatedInputTokens: number;
  readonly requestDigest: string;
  readonly profileConfigDigest: string;
  readonly inputArtifactId: string;
  readonly artifactContentDigest: string;
}

export interface ModelJournalDeps {
  readonly db: SqlDatabase;
  readonly artifacts: ArtifactWriter;
  readonly clock: () => Date;
  readonly logger?: Logger;
}

export class ModelRequestJournal {
  readonly #db: SqlDatabase;
  readonly #artifacts: ArtifactWriter;
  readonly #clock: () => Date;
  readonly #logger: Logger;

  constructor(deps: ModelJournalDeps) {
    this.#db = deps.db;
    this.#artifacts = deps.artifacts;
    this.#clock = deps.clock;
    this.#logger = deps.logger ?? silentLogger;
  }

  /**
   * Persists the prepared attempt and its reservation.
   *
   * The bytes stored here are the exact serialized request the transport will
   * transmit, taken from `prepared.requestBody`. They are hashed and compared
   * against `prepared.requestDigest` **before** anything is written, so a
   * mismatch aborts with nothing durable and therefore nothing dispatched.
   *
   * Returns only after both the input artifact and the `prepared` row are
   * durable. A caller whose call throws has dispatched nothing.
   */
  async prepare(
    scope: JournalScope,
    prepared: PreparedAttempt,
    authorize?: () => Promise<void>,
  ): Promise<PreparedAttemptRecord> {
    const attemptRowId = prepared.attemptId;
    let attemptNo = 1;

    // The transmitted bytes, not a summary of them.
    const exactInputBytes = Buffer.from(prepared.requestBody, 'utf8');
    const actualDigest = createHash('sha256').update(exactInputBytes).digest('hex');
    if (actualDigest !== prepared.requestDigest) {
      throw new ThreadlineError(
        'authority_conflict',
        'The prepared request digest does not match the request bytes; nothing was dispatched.',
        { reason: 'request_digest_mismatch', attemptId: attemptRowId },
      );
    }
    if (exactInputBytes.byteLength !== prepared.requestBytes) {
      throw new ThreadlineError(
        'authority_conflict',
        'The prepared request byte length does not match the request bytes; nothing was dispatched.',
        { reason: 'request_byte_length_mismatch', attemptId: attemptRowId },
      );
    }

    // Budget the whole input against the admitted profile, never a fixed guess.
    const capacity = requireCapacity(readModelCapacity(scope.profileSettings));
    const decision = decideTurnBudget({
      requestBody: prepared.requestBody,
      capacity,
      runMaxTotalTokens: scope.maxTotalTokens,
      reservedTokens: await this.reservedTokens(scope.tenantId, scope.projectId, scope.sessionId),
      observedTokens: await this.observedTokens(scope.tenantId, scope.projectId, scope.sessionId),
    });

    const inputArtifact = await this.#artifacts.publish({
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      kind: 'model_input',
      bytes: exactInputBytes,
      id: randomUUID(),
    });
    // The stored bytes must hash to the digest the transport will send.
    if (inputArtifact.contentDigest !== prepared.requestDigest) {
      throw new ThreadlineError(
        'authority_conflict',
        'The published input artifact does not hash to the transmitted request digest.',
        { reason: 'artifact_digest_mismatch', attemptId: attemptRowId },
      );
    }

    const reservationId = randomUUID();
    const reservedTokens = decision.reservedTokens;
    const now = this.#clock();

    // Durable admission of the effect, serialized against human command
    // admission on the shared per-project key.
    await withProjectAdmissionLock(this.#db, scope.tenantId, scope.projectId, async (tx) => {
      await authorize?.();
      const prior = await tx.rows<{ last: number }>(
        `SELECT COALESCE(MAX(attempt_no),0) AS last FROM threadline.model_requests
          WHERE tenant_id=$1 AND project_id=$2 AND agent_session_id=$3 AND logical_request_id=$4`,
        [scope.tenantId, scope.projectId, scope.sessionId, prepared.logicalRequestId]);
      attemptNo = Number(prior[0]?.last ?? 0) + 1;
      return tx.rows(
        `INSERT INTO threadline.model_requests
           (tenant_id, project_id, id, agent_session_id, logical_request_id, attempt_no,
            profile_id, context_packet_id, input_artifact_id, input_digest, profile_digest,
            graph_epoch, requirement_revision, reservation_graph_id, provider_request_id,
            status, response_artifact_id, usage_source_key, failure_code,
            created_at, dispatched_at, finished_at, reserved_tokens, possible_charge)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11, $12, $13, NULL,
                 'prepared', NULL, NULL, NULL, $14, NULL, NULL, $15, false)`,
        [
          // $1..$7  identity
          scope.tenantId,
          scope.projectId,
          attemptRowId,
          scope.sessionId,
          prepared.logicalRequestId,
          attemptNo,
          scope.profileId,
          // $8      input artifact that holds the transmitted bytes verbatim
          inputArtifact.id,
          // $9  input_digest: the sha256 of those exact bytes. Verified equal
          //     to both `prepared.requestDigest` and the artifact's own digest
          //     above, so the three agree by construction rather than by trust.
          prepared.requestDigest,
          // $10 profile_digest: the immutable admitted profile configuration.
          //     A different fact from $9; substituting one for the other would
          //     make an audit unable to tell which profile produced the turn.
          scope.profileConfigDigest,
          // $11..$13 authority in force when the attempt was admitted
          scope.graphEpoch,
          scope.requirementRevision,
          // $14 reservation, $15 created_at
          reservationId,
          now,
          reservedTokens,
        ],
      );
    });

    this.#logger.log({
      level: 'info',
      message: 'Model attempt prepared and budget reserved.',
      fields: {
        correlationId: scope.correlationId,
        logicalRequestId: prepared.logicalRequestId,
        attemptNo,
        reservedTokens,
        estimatedInputTokens: decision.estimate.tokens,
        contextWindowHeadroom: decision.contextWindowHeadroom,
      },
    });

    return {
      attemptRowId,
      attemptNo,
      reservationId,
      reservedTokens,
      estimatedInputTokens: decision.estimate.tokens,
      requestDigest: prepared.requestDigest,
      profileConfigDigest: scope.profileConfigDigest,
      inputArtifactId: inputArtifact.id,
      artifactContentDigest: inputArtifact.contentDigest,
    };
  }

  /**
   * Read-only view of the durable attempt record for one logical session.
   *
   * This exists so an operator can inspect what actually happened without
   * trusting an in-memory summary: every field here is read back from the
   * journal, including the digests that make a turn auditable.
   */
  async list(tenantId: string, projectId: string, sessionId: string): Promise<ModelRequestAudit[]> {
    return this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{
        id: string;
        logical_request_id: string;
        attempt_no: number;
        attempt_id: string;
        provider_request_id: string | null;
        status: string;
        input_artifact_id: string;
        input_digest: string;
        profile_digest: string;
        response_artifact_id: string | null;
        usage_source_key: string | null;
        failure_code: string | null;
        graph_epoch: string;
        requirement_revision: string;
        created_at: Date;
        dispatched_at: Date | null;
        possible_charge: boolean | null;
        finished_at: Date | null;
      }>(
        `SELECT r.id,
                r.logical_request_id,
                r.attempt_no,
                r.id AS attempt_id,
                r.provider_request_id,
                r.status,
                r.input_artifact_id,
                trim(r.input_digest) AS input_digest,
                trim(r.profile_digest) AS profile_digest,
                r.response_artifact_id,
                r.usage_source_key,
                r.failure_code,
                r.graph_epoch,
                r.requirement_revision,
                r.created_at,
                r.dispatched_at, r.possible_charge,
                r.finished_at
           FROM threadline.model_requests r
          WHERE r.tenant_id = $1 AND r.project_id = $2 AND r.agent_session_id = $3
          ORDER BY r.created_at ASC, r.attempt_no ASC`,
        [tenantId, projectId, sessionId],
      ),
    ).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        logicalRequestId: row.logical_request_id,
        attemptNo: row.attempt_no,
        attemptId: row.attempt_id,
        providerRequestId: row.provider_request_id,
        state: row.status,
        inputArtifactId: row.input_artifact_id,
        inputDigest: row.input_digest,
        profileDigest: row.profile_digest,
        responseArtifactId: row.response_artifact_id,
        usageSourceKey: row.usage_source_key,
        failureCode: row.failure_code,
        graphEpoch: row.graph_epoch,
        requirementRevision: Number(row.requirement_revision),
        createdAt: row.created_at,
        dispatchedAt: row.dispatched_at,
        possibleCharge: row.possible_charge,
        finishedAt: row.finished_at,
      })),
    );
  }

  /** Records a transport observation. Never a claim of provider acceptance. */
  async observe(scope: JournalIdentityScope, attemptRowId: string, event: ProviderLifecycle): Promise<void> {
    const status = statusForLifecycle(event);
    if (status === null) {
      return;
    }
    const providerRequestId =
      event.phase === 'response_observed' ? event.observed.providerRequestId : null;
    const now = this.#clock();

    await this.#db.withTenantTransaction(scope.tenantId, async (tx) => {
      if (status === 'dispatched') {
        await tx.rows(
          `UPDATE threadline.model_requests
              SET status = 'dispatched', possible_charge = true, dispatched_at = COALESCE(dispatched_at, $1)
            WHERE tenant_id = $2 AND project_id = $3 AND id = $4 AND status = 'prepared'`,
          [now, scope.tenantId, scope.projectId, attemptRowId],
        );
        return;
      }
      await tx.rows(
        `UPDATE threadline.model_requests
            SET status = $1, possible_charge = true,
                provider_request_id = COALESCE($2, provider_request_id),
                dispatched_at = COALESCE(dispatched_at, $3)
          WHERE tenant_id = $4 AND project_id = $5 AND id = $6 AND status IN ('prepared','dispatched')`,
        [status, providerRequestId, now, scope.tenantId, scope.projectId, attemptRowId],
      );
    });
  }

  /**
   * Stores the terminal visible output and the complete validated tool batch,
   * then settles observed usage.
   *
   * A terminal record without readable response bytes is never recorded as
   * `completed`; the response artifact must exist and verify first.
   */
  async settle(
    scope: JournalIdentityScope,
    attemptRowId: string,
    attemptNo: number,
    reservationId: string,
    settled: SettledAttempt,
    terminal: TerminalRecord,
  ): Promise<{ state: AttemptState; reservationRetained: boolean }> {
    const now = this.#clock();
    let responseArtifactId: string | null = null;

    if (terminal.complete) {
      const bytes = Buffer.from(
        JSON.stringify({
          visibleOutput: terminal.visibleOutput,
          toolCalls: terminal.toolCalls,
          responseId: terminal.responseId,
        }),
        'utf8',
      );
      const artifact = await this.#artifacts.publish({
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        kind: 'model_response',
        bytes,
        id: randomUUID(),
      });
      // Prove the bytes are readable and correct before claiming completion.
      await this.#artifacts.read(scope.tenantId, scope.projectId, artifact.id);
      responseArtifactId = artifact.id;
    }

    const state = terminalState(settled, terminal);
    const usage = terminal.usage;
    const usageSourceKey = `${attemptRowId}:usage`;
    const reservationRetained = usage.precision === 'reserved';

    await this.#db.withTenantTransaction(scope.tenantId, async (tx) => {
      // The ledger row is written first: `model_requests.usage_source_key` is a
      // foreign key into it, so the reverse order fails at statement end.
      if (usage.precision === 'reported') {
        await tx.rows(
          `INSERT INTO threadline.usage_ledger
             (tenant_id, project_id, id, agent_session_id, source_key, input_tokens,
              output_tokens, cost_microunits, currency, precision, reservation_graph_id, observed_at)
           VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, NULL, NULL, 'reported', $7, $8)
           ON CONFLICT (tenant_id, project_id, agent_session_id, source_key) DO NOTHING`,
          [
            scope.tenantId,
            scope.projectId,
            scope.sessionId,
            usageSourceKey,
            usage.inputTokens,
            usage.outputTokens,
            reservationId,
            now,
          ],
        );
      } else if (usage.precision === 'known-zero') {
        // The provider refused before accepting, so zero usage is observed, not
        // assumed. Recorded as a reported zero.
        await tx.rows(
          `INSERT INTO threadline.usage_ledger
             (tenant_id, project_id, id, agent_session_id, source_key, input_tokens,
              output_tokens, cost_microunits, currency, precision, reservation_graph_id, observed_at)
           VALUES ($1, $2, gen_random_uuid(), $3, $4, 0, 0, NULL, NULL, 'reported', $5, $6)
           ON CONFLICT (tenant_id, project_id, agent_session_id, source_key) DO NOTHING`,
          [scope.tenantId, scope.projectId, scope.sessionId, usageSourceKey, reservationId, now],
        );
      } else {
        // Retained reservation. The schema's vocabulary has no "reserved", so
        // this is recorded as `unknown` with no numbers: the reservation graph
        // id still carries the conservative amount.
        await tx.rows(
          `INSERT INTO threadline.usage_ledger
             (tenant_id, project_id, id, agent_session_id, source_key, input_tokens,
              output_tokens, cost_microunits, currency, precision, reservation_graph_id, observed_at)
           VALUES ($1, $2, gen_random_uuid(), $3, $4, NULL, NULL, NULL, NULL, 'unknown', $5, $6)
           ON CONFLICT (tenant_id, project_id, agent_session_id, source_key) DO NOTHING`,
          [scope.tenantId, scope.projectId, scope.sessionId, usageSourceKey, reservationId, now],
        );
      }

      await tx.rows(
        `UPDATE threadline.model_requests
            SET status = $1, response_artifact_id = $2, usage_source_key = $3,
                failure_code = $4, finished_at = $5,
                provider_request_id = COALESCE($6, provider_request_id), possible_charge = $10
          WHERE tenant_id = $7 AND project_id = $8 AND id = $9`,
        [
          state,
          responseArtifactId,
          usageSourceKey,
          settled.status === 'completed' ? null : settled.reason,
          now,
          settled.providerRequestId,
          scope.tenantId,
          scope.projectId,
          attemptRowId,
          settled.possibleCharge,
        ],
      );
    });

    void attemptNo;
    return { state, reservationRetained };
  }

  /** Reads one attempt for inspection. */
  async find(
    tenantId: string,
    projectId: string,
    attemptRowId: string,
  ): Promise<ModelRequestRow | null> {
    const rows = await this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{
        id: string;
        logical_request_id: string;
        attempt_no: string;
        status: AttemptState;
        provider_request_id: string | null;
        input_artifact_id: string;
        input_digest: string;
        response_artifact_id: string | null;
        created_at: Date;
        finished_at: Date | null;
        possible_charge: boolean | null;
        precision: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
      }>(
        `SELECT r.id, r.logical_request_id, r.attempt_no, r.status, r.provider_request_id,
                r.input_artifact_id, r.input_digest, r.response_artifact_id, r.created_at, r.finished_at,
                r.possible_charge, u.precision, u.input_tokens, u.output_tokens
           FROM threadline.model_requests r
           LEFT JOIN threadline.usage_ledger u ON u.tenant_id = r.tenant_id AND u.project_id = r.project_id
            AND u.agent_session_id = r.agent_session_id AND u.source_key = r.usage_source_key
          WHERE r.tenant_id = $1 AND r.project_id = $2 AND r.id = $3`,
        [tenantId, projectId, attemptRowId],
      ),
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const attemptNo = toSafeInteger(row.attempt_no);
    if (attemptNo === null) {
      throw new ThreadlineError('internal_error', 'An attempt number could not be read.');
    }
    return {
      id: row.id,
      logicalRequestId: row.logical_request_id,
      attemptNo,
      status: row.status,
      providerRequestId: row.provider_request_id,
      inputArtifactId: row.input_artifact_id,
      inputDigest: row.input_digest.trim(),
      responseArtifactId: row.response_artifact_id,
      usage: row.precision === 'reported' && row.input_tokens !== null && row.output_tokens !== null
        ? { precision: 'reported', inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens) }
        : { precision: 'reserved', reason: 'usage_not_observed' },
      possibleCharge: row.possible_charge ?? row.status !== 'prepared',
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    };
  }

  /** Counts attempts for a session, used by the budget check. */
  async countAttempts(tenantId: string, projectId: string, sessionId: string): Promise<number> {
    const rows = await this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{ count: string }>(
        `SELECT count(*) AS count FROM threadline.model_requests
          WHERE tenant_id = $1 AND project_id = $2 AND agent_session_id = $3`,
        [tenantId, projectId, sessionId],
      ),
    );
    return toSafeInteger(rows[0]?.count ?? '0') ?? 0;
  }

  /** Attempts whose outcome was never established. Blocks a new turn. */
  async countUnresolved(tenantId: string, projectId: string, sessionId: string): Promise<number> {
    const rows = await this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{ count: string }>(
        `SELECT count(*) AS count FROM threadline.model_requests
          WHERE tenant_id = $1 AND project_id = $2 AND agent_session_id = $3
            AND (status IN ('unknown','dispatched','streaming','prepared') OR
              EXISTS (SELECT 1 FROM threadline.usage_ledger u WHERE u.tenant_id = threadline.model_requests.tenant_id
               AND u.project_id = threadline.model_requests.project_id AND u.agent_session_id = threadline.model_requests.agent_session_id
               AND u.source_key = threadline.model_requests.usage_source_key AND u.precision = 'unknown'))`,
        [tenantId, projectId, sessionId],
      ),
    );
    return toSafeInteger(rows[0]?.count ?? '0') ?? 0;
  }

  /** Tokens still reserved because an attempt's outcome is unknown. */
  async reservedTokens(tenantId: string, projectId: string, sessionId: string): Promise<number> {
    const rows = await this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{ input_artifact_id: string; reserved_tokens: string | null }>(
        `SELECT r.input_artifact_id, r.reserved_tokens FROM threadline.model_requests r
         LEFT JOIN threadline.usage_ledger u ON u.tenant_id = r.tenant_id
          AND u.project_id = r.project_id AND u.agent_session_id = r.agent_session_id
          AND u.source_key = r.usage_source_key
         WHERE r.tenant_id = $1 AND r.project_id = $2 AND r.agent_session_id = $3
          AND (r.status IN ('prepared','dispatched','streaming','unknown') OR u.precision = 'unknown')`,
        [tenantId, projectId, sessionId],
      ),
    );
    let held = 0;
    for (const row of rows) {
      if (row.reserved_tokens !== null) { held += Number(row.reserved_tokens); continue; }
      const bytes = await this.#artifacts.read(tenantId, projectId, row.input_artifact_id);
      const body = bytes.toString('utf8');
      const payload = JSON.parse(body);
      const output: unknown = payload.max_output_tokens ?? payload.max_tokens;
      if (typeof output !== 'number' || !Number.isSafeInteger(output) || output < 1)
        throw new ThreadlineError('authority_conflict', 'A durable reservation cannot be reconstructed.');
      held += estimateRequestTokens(body).tokens + output;
    }
    return held;
  }

  /** Observed tokens only. Never mixes in reservations. */
  async observedTokens(tenantId: string, projectId: string, sessionId: string): Promise<number> {
    const rows = await this.#db.withTenantTransaction(tenantId, (tx) =>
      tx.rows<{ total: string | null }>(
        `SELECT sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS total
           FROM threadline.usage_ledger
          WHERE tenant_id = $1 AND project_id = $2 AND agent_session_id = $3
            AND precision = 'reported'`,
        [tenantId, projectId, sessionId],
      ),
    );
    return toSafeInteger(rows[0]?.total ?? '0') ?? 0;
  }
}

function statusForLifecycle(event: ProviderLifecycle): AttemptState | null {
  if (event.phase === 'dispatched') {
    return 'dispatched';
  }
  if (event.phase === 'stream_observed') {
    return 'streaming';
  }
  return null;
}

function terminalState(settled: SettledAttempt, terminal: TerminalRecord): AttemptState {
  if (settled.status === 'completed' && terminal.complete) {
    return 'completed';
  }
  if (settled.status === 'cancelled') {
    return 'cancelled';
  }
  if (settled.status === 'failed') {
    return 'failed';
  }
  // A completed-looking transport without a complete record is not completion.
  return 'unknown';
}
