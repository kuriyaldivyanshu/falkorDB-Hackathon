import {
  OBSERVED_EVIDENCE_SOURCE_KINDS,
  ThreadlineError,
  type EpisodeEvidencePrecision,
} from '@threadline/shared';

import type { SqlDatabase } from '../storage/pg.js';

/**
 * Which episodes may be recorded as observed rather than authored.
 *
 * The classification this module enforces is the one the product promises: an
 * authored assertion stays authored evidence, and no caller-supplied outcome or
 * Source kind can promote it. Deterministic observed admission needs a supported,
 * validated evidence path *and* checks this service runs against durable facts.
 *
 * Eligibility is therefore the conjunction of five conditions, none of which a
 * request body can satisfy on its own:
 *
 * 1. every cited source is in project scope, project-visible and available —
 *    the ordinary evidence gate, re-run here so the two cannot drift;
 * 2. its catalogued kind is one this contract recognises as outcome evidence
 *    (`procedure_outcome`, `tool_result`, `permission_outcome`);
 * 3. it is `complete`: a partial, unknown or explicitly gapped record is not an
 *    established outcome, however well-formed its kind;
 * 4. its recording principal is a **human** principal — a producer or model
 *    principal cannot mint observed-grade evidence, because `source.append`
 *    always stamps the acting principal, so this is a fact about who recorded
 *    the evidence rather than a claim in a request;
 * 5. its own admission has committed, so the evidence exists in project memory
 *    and not only in the catalogue.
 *
 * Condition 4 is what makes this honest in a build with no native capture: the
 * only way an episode becomes `observed` is a human recording a complete
 * outcome record. Nothing here infers a root cause from an exit status, and
 * nothing derives the success of a wider task from one action's outcome.
 *
 * What this deliberately does *not* do is grant a stronger outcome than the
 * caller supplied. The eligibility check answers "may this be called observed?",
 * never "is this outcome true?": the outcome under test is the one recorded.
 */

export type EvidenceClass = 'eligible' | 'authored';

export interface EvidenceClassification {
  readonly precision: EpisodeEvidencePrecision;
  readonly class: EvidenceClass;
  readonly reason: string;
}

export interface EvidenceEligibilityDeps {
  readonly db: SqlDatabase;
}

export interface EvidenceEligibilityQuery {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sourceIds: readonly string[];
  /** The acting principal; a principal-private source is never evidence. */
  readonly principalId: string;
}

interface EvidenceEligibilityRow {
  readonly id: string;
  readonly kind: string;
  readonly completeness: string;
  readonly availability: string;
  readonly visibility: string;
  readonly producer_kind: string;
  readonly anchor_state: string | null;
}

const OBSERVED_KINDS: ReadonlySet<string> = new Set(OBSERVED_EVIDENCE_SOURCE_KINDS);

/**
 * Classifies the evidence behind one episode.
 *
 * `requested` is what the caller asked for. An `observed` request that does not
 * qualify is **refused**, not downgraded: silently recording an unsupported
 * observation as authored would leave the caller believing they got the
 * stronger thing. An absent or `authored` request always resolves to authored,
 * which is the human-reviewed path the contract allows.
 */
export async function classifyEpisodeEvidence(
  deps: EvidenceEligibilityDeps,
  query: EvidenceEligibilityQuery,
  requested: EpisodeEvidencePrecision | null,
): Promise<EvidenceClassification> {
  const rows = await deps.db.withTenantTransaction(query.tenantId, (tx) =>
    tx.rows<EvidenceEligibilityRow>(
      `SELECT s.id, s.kind, s.completeness, s.availability, s.visibility,
              p.kind AS producer_kind,
              o.state AS anchor_state
         FROM threadline_memory.sources s
         JOIN threadline_memory.principals p ON p.tenant_id = s.tenant_id AND p.id = s.producer_principal_id
         LEFT JOIN threadline_memory.operations o
                ON o.tenant_id = s.tenant_id AND o.project_id = s.project_id
               AND o.kind = 'source.append' AND o.intent_source_id = s.id
        WHERE s.tenant_id = $1 AND s.project_id = $2 AND s.id = ANY($3::uuid[])`,
      [query.tenantId, query.projectId, [...query.sourceIds]],
    ),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const sourceId of query.sourceIds) {
    if (!byId.has(sourceId)) {
      throw new ThreadlineError(
        'not_found',
        'A cited source is not present in this project scope or cannot be admitted as evidence.',
      );
    }
  }
  if (requested !== 'observed') {
    return {
      precision: 'authored',
      class: 'authored',
      reason: 'The episode was recorded as an authored report; no observation was asserted.',
    };
  }

  for (const sourceId of query.sourceIds) {
    const row = byId.get(sourceId) as EvidenceEligibilityRow;
    if (row.visibility !== 'project') {
      return refuseUnsupported(
        'A cited source is not project-visible, so it cannot establish an observed outcome.',
      );
    }
    if (row.availability !== 'available') {
      return refuseUnsupported('A cited source is not available, so it cannot establish an observed outcome.');
    }
    if (!OBSERVED_KINDS.has(row.kind)) {
      return refuseUnsupported(
        `A cited source is catalogued as "${row.kind}", which is not outcome evidence in this contract.`,
      );
    }
    if (row.completeness !== 'complete') {
      return refuseUnsupported(
        `A cited source is recorded as ${row.completeness}; only a complete record can establish an outcome.`,
      );
    }
    if (row.producer_kind !== 'human') {
      return refuseUnsupported(
        'A cited source was recorded by a non-human principal; a producer assertion stays authored evidence.',
      );
    }
    if (row.anchor_state !== 'committed') {
      return refuseUnsupported(
        'A cited source has not been admitted to project memory yet, so it cannot establish an outcome.',
      );
    }
  }
  return {
    precision: 'observed',
    class: 'eligible',
    reason:
      'Every cited source is complete, project-visible, available, admitted, and was recorded by a human principal.',
  };
}

/** Throws an unsupported error explaining why observed evidence cannot be granted. */
function refuseUnsupported(reason: string): never {
  throw new ThreadlineError(
    'unsupported',
    `This build cannot record this episode as an observed outcome: ${reason}`,
    { evidencePrecision: 'observed' },
  );
}