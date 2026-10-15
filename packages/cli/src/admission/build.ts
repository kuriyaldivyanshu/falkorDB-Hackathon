import type { AcceptedCriterion, GoalAdmissionInput } from '@threadline/shared';

import type { LoadedFixtureManifest, ProtectedCaseSummary } from '../fixture/manifest.js';

/**
 * Builds the admission payload from the authored manifest.
 *
 * Every field is copied from structured manifest data. No rule is inferred from
 * prose, no expected output is derived, and no criterion is invented: the
 * accepted criteria are exactly the manifest's declared protected cases, and
 * the text is a faithful label assembled from their own fields.
 *
 * The held-out case is deliberately excluded. It belongs to a later validation
 * step, not to the criteria a task starts with.
 */
export function buildGoalAdmissionInput(
  manifest: LoadedFixtureManifest,
  target: { readonly projectId: string; readonly requestId: string },
): GoalAdmissionInput {
  return {
    projectId: target.projectId,
    requestId: target.requestId,
    fixtureId: manifest.fixtureId,
    goalText: [manifest.acceptedGoal, '', 'Accepted rules:', ...manifest.rules, '', `Manifest SHA-256: ${manifest.digest}`].join('\n'),
    requirements: [buildFreshnessRequirement(manifest)],
    criteria: manifest.protectedCases.filter(c => c.phase === 'initial' || c.phase === 'both').map(buildProtectedCaseCriterion),
  };
}

/**
 * The single accepted requirement at first admission: the freshness bound.
 *
 * `revision` comes from the manifest's initial revision, so the accepted value
 * and its version are stated together rather than inferred.
 */
function buildFreshnessRequirement(manifest: LoadedFixtureManifest): GoalAdmissionInput['requirements'][number] {
  const revision = Number.parseInt(manifest.initialRequirement.revision, 10);
  if (!Number.isInteger(revision)) {
    throw new Error(
      `Fixture ${manifest.fixtureId} declares a non-numeric requirement revision ` +
        `"${manifest.initialRequirement.revision}".`,
    );
  }
  return {
    field: manifest.allowedHumanChange.field,
    type: 'integer',
    value: manifest.initialRequirement.maxAgeSeconds,
    minimum: manifest.allowedHumanChange.minimum,
    maximum: manifest.allowedHumanChange.maximum,
    revision,
  };
}

/**
 * One criterion per declared protected case.
 *
 * `text` states only what the manifest already declares about the case: its
 * identifier, its phase and its expected exit status. Writing a richer
 * description here would be inventing an acceptance test from prose.
 */
function buildProtectedCaseCriterion(protectedCase: ProtectedCaseSummary): AcceptedCriterion {
  const { id, phase, expectedExit } = protectedCase;
  return {
    kind: 'assertion',
    ref: id,
    text:
      phase === null
        ? `protected case "${id}"`
        : `protected case "${id}", phase ${phase}` +
          (expectedExit === null ? '' : `, expected exit ${expectedExit}`),
    required: true,
    expectedExitCode: expectedExit,
  };
}
