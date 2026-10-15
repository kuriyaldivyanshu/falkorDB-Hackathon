import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * Loads the authored fixture manifest as versioned development data.
 *
 * The manifest is data, not code. Nothing here derives an acceptance test from
 * prose, and nothing here decides whether a candidate is correct: this module
 * only reports what the manifest says so a human can accept it explicitly.
 *
 * The file is read from a configured path. Its SHA-256 is recorded alongside
 * the loaded content so a later change to the manifest is detectable rather
 * than silent.
 */

export class FixtureManifestError extends Error {
  readonly manifestPath: string;

  constructor(manifestPath: string, problem: string) {
    super(`${manifestPath}: ${problem}`);
    this.name = 'FixtureManifestError';
    this.manifestPath = manifestPath;
  }
}

export interface FixtureRequirement {
  readonly revision: string;
  readonly maxAgeSeconds: number;
}

export interface AllowedHumanChange {
  readonly field: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly admission: string;
}

export interface LoadedFixtureManifest {
  readonly path: string;
  /** SHA-256 of the exact bytes that were loaded. */
  readonly digest: string;
  readonly schemaVersion: number;
  /** The manifest's own status string, kept so "proposed" is never lost. */
  readonly declaredStatus: string;
  readonly fixtureId: string;
  readonly taskKind: string;
  readonly entrypoint: string;
  readonly referenceTime: string;
  readonly acceptedGoal: string;
  readonly initialRequirement: FixtureRequirement;
  readonly changedRequirement: FixtureRequirement;
  readonly allowedHumanChange: AllowedHumanChange;
  readonly rules: readonly string[];
  /**
   * Declared protected cases.
   *
   * Only the identifying fields are read. `input` and `expected_stdout` are
   * never loaded into this client, so the interface cannot display an expected
   * answer or treat it as a test.
   */
  readonly protectedCases: readonly ProtectedCaseSummary[];
  readonly receiptBindingFields: readonly string[];
}

/** The part of a protected case that admission is allowed to know. */
export interface ProtectedCaseSummary {
  readonly id: string;
  readonly phase: string | null;
  readonly expectedExit: number | null;
}

export interface LoadOptions {
  readonly cwd?: string;
  /** Injected so a check can supply bytes without touching the filesystem. */
  readonly readFileImpl?: typeof readFile;
}

export async function loadFixtureManifest(
  manifestPath: string,
  options: LoadOptions = {},
): Promise<LoadedFixtureManifest> {
  const cwd = options.cwd ?? process.cwd();
  const absolute = isAbsolute(manifestPath) ? manifestPath : resolve(cwd, manifestPath);
  const read = options.readFileImpl ?? readFile;

  let bytes: Buffer;
  try {
    bytes = await read(absolute);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FixtureManifestError(
      absolute,
      `could not be read (${reason}). Pass --fixture-manifest with a path to the manifest.`,
    );
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new FixtureManifestError(absolute, 'is not valid JSON.');
  }

  return { path: absolute, digest, ...readManifestFields(absolute, parsed) };
}

function readManifestFields(
  manifestPath: string,
  parsed: unknown,
): Omit<LoadedFixtureManifest, 'path' | 'digest'> {
  const root = requireObject(manifestPath, parsed, 'manifest');

  const schemaVersion = requireNumber(manifestPath, root['schema_version'], 'schema_version');
  if (schemaVersion !== 1) {
    throw new FixtureManifestError(
      manifestPath,
      `has schema_version ${schemaVersion}; this build understands 1 only.`,
    );
  }

  return {
    schemaVersion,
    declaredStatus: requireString(manifestPath, root['status'], 'status'),
    fixtureId: requireString(manifestPath, root['fixture_id'], 'fixture_id'),
    taskKind: requireString(manifestPath, root['task_kind'], 'task_kind'),
    entrypoint: requireString(manifestPath, root['entrypoint'], 'entrypoint'),
    referenceTime: requireString(manifestPath, root['reference_time'], 'reference_time'),
    acceptedGoal: requireString(manifestPath, root['accepted_goal'], 'accepted_goal'),
    initialRequirement: readRequirement(manifestPath, root['initial_requirement'], 'initial_requirement'),
    changedRequirement: readRequirement(manifestPath, root['changed_requirement'], 'changed_requirement'),
    allowedHumanChange: readAllowedChange(manifestPath, root['allowed_human_change']),
    rules: readStringArray(manifestPath, root['rules'], 'rules'),
    protectedCases: readProtectedCases(manifestPath, root['protected_cases']),
    receiptBindingFields: readReceiptBinding(manifestPath, root['verification_contract']),
  };
}

/**
 * A human-readable preview of exactly what would be accepted.
 *
 * This is the consent surface: the user sees the goal, the initial freshness
 * value, the rules and the fixture identity before anything is submitted.
 */
export function previewFixture(manifest: LoadedFixtureManifest): string[] {
  const lines: string[] = [
    `Fixture       ${manifest.fixtureId} (${manifest.taskKind})`,
    `Manifest      ${manifest.path}`,
    `Digest        sha256:${manifest.digest}`,
    `Status        ${manifest.declaredStatus}`,
    `Entrypoint    ${manifest.entrypoint}`,
    `Reference     ${manifest.referenceTime}`,
    '',
    'Accepted goal:',
    `  ${manifest.acceptedGoal}`,
    '',
    `Accepted requirement revision ${manifest.initialRequirement.revision}:`,
    `  max_age_seconds = ${manifest.initialRequirement.maxAgeSeconds}`,
    '',
    `Acceptable human change to "${manifest.allowedHumanChange.field}":`,
    `  integer ${manifest.allowedHumanChange.minimum}..${manifest.allowedHumanChange.maximum}`,
    `  ${manifest.allowedHumanChange.admission}`,
    '',
    `Accepted rules (${manifest.rules.length}):`,
    ...manifest.rules.map((rule, index) => `  ${index + 1}. ${rule}`),
    '',
    `Protected cases declared: ${manifest.protectedCases.length}`,
    '  These are not published here and are not run at admission.',
    `Receipt will bind: ${manifest.receiptBindingFields.join(', ')}`,
  ];
  return lines;
}

/**
 * The exact acceptance payload submitted when the user confirms.
 *
 * Built from the manifest only. No value is invented, defaulted or inferred.
 */
export function toAcceptancePayload(manifest: LoadedFixtureManifest): {
  readonly fixtureId: string;
  readonly fixtureDigest: string;
  readonly manifestSchemaVersion: number;
  readonly taskKind: string;
  readonly goal: string;
  readonly requirementRevision: string;
  readonly maxAgeSeconds: number;
  readonly rules: readonly string[];
} {
  return {
    fixtureId: manifest.fixtureId,
    fixtureDigest: manifest.digest,
    manifestSchemaVersion: manifest.schemaVersion,
    taskKind: manifest.taskKind,
    goal: manifest.acceptedGoal,
    requirementRevision: manifest.initialRequirement.revision,
    maxAgeSeconds: manifest.initialRequirement.maxAgeSeconds,
    rules: [...manifest.rules],
  };
}

function readRequirement(manifestPath: string, value: unknown, field: string): FixtureRequirement {
  const object = requireObject(manifestPath, value, field);
  const revision = requireString(manifestPath, object['revision'], `${field}.revision`);
  const maxAgeSeconds = requireNumber(manifestPath, object['max_age_seconds'], `${field}.max_age_seconds`);
  return { revision, maxAgeSeconds };
}

function readAllowedChange(manifestPath: string, value: unknown): AllowedHumanChange {
  const object = requireObject(manifestPath, value, 'allowed_human_change');
  return {
    field: requireString(manifestPath, object['field'], 'allowed_human_change.field'),
    minimum: requireNumber(manifestPath, object['minimum'], 'allowed_human_change.minimum'),
    maximum: requireNumber(manifestPath, object['maximum'], 'allowed_human_change.maximum'),
    admission: requireString(manifestPath, object['admission'], 'allowed_human_change.admission'),
  };
}

function readProtectedCases(manifestPath: string, value: unknown): ProtectedCaseSummary[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new FixtureManifestError(manifestPath, '"protected_cases" must be an array when present.');
  }
  return value.map((entry, index) => {
    const label = `protected_cases[${index}]`;
    const object = requireObject(manifestPath, entry, label);
    const phase = object['phase'];
    const expectedExit = object['expected_exit'];
    return {
      id: requireString(manifestPath, object['id'], `${label}.id`),
      phase: typeof phase === 'string' ? phase : null,
      expectedExit: typeof expectedExit === 'number' ? expectedExit : null,
    };
  });
}

function readReceiptBinding(manifestPath: string, value: unknown): string[] {
  const object = requireObject(manifestPath, value, 'verification_contract');
  return readStringArray(manifestPath, object['receipt_binding'], 'verification_contract.receipt_binding');
}

function readStringArray(manifestPath: string, value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new FixtureManifestError(manifestPath, `"${field}" must be an array of strings.`);
  }
  return value.map((entry, index) => requireString(manifestPath, entry, `${field}[${index}]`));
}

function requireObject(manifestPath: string, value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FixtureManifestError(manifestPath, `"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(manifestPath: string, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FixtureManifestError(manifestPath, `"${field}" must be a non-empty string.`);
  }
  return value;
}

function requireNumber(manifestPath: string, value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FixtureManifestError(manifestPath, `"${field}" must be a number.`);
  }
  return value;
}
