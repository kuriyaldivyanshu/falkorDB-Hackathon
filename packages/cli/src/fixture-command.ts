import { loadFixtureManifest, previewFixture, toAcceptancePayload, type LoadedFixtureManifest } from './fixture/manifest.js';
import { EXIT_FAILURE, EXIT_OK, type LineSink } from './one-shot.js';

/**
 * Prints the authored fixture manifest exactly as a human would accept it.
 *
 * This touches no backend and accepts nothing. It exists so the goal, the
 * initial freshness value, the rules and the manifest identity are readable
 * before anyone is asked to accept them.
 */
export async function runFixturePreview(manifestPath: string, out: LineSink): Promise<number> {
  let manifest: LoadedFixtureManifest;
  try {
    manifest = await loadFixtureManifest(manifestPath);
  } catch (error) {
    out(`fixture manifest not loaded: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILURE;
  }

  for (const line of previewFixture(manifest)) {
    out(line);
  }

  const payload = toAcceptancePayload(manifest);
  out('');
  out('Nothing has been accepted or submitted. This command only shows the manifest.');
  out(
    `Accepting later would bind requirement revision ${payload.requirementRevision} ` +
      `at max_age_seconds=${payload.maxAgeSeconds}.`,
  );
  return EXIT_OK;
}
