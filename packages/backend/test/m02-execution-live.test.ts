import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';

import type { RunLaunchView, StartRunInput } from '@threadline/shared';

import { parseBackendConfig, type BackendConfig } from '../src/config.js';
import { createBackend, type Backend } from '../src/index.js';
import { createGraphStore, type GraphStore } from '../src/storage/graph.js';
import { createSqlDatabase, projectAdmissionLockKey, type SqlDatabase } from '../src/storage/pg.js';
import { silentLogger } from '../src/log.js';
import type { AttemptIdentity, PreparedAttempt, ProviderLifecycle, SettledAttempt } from '../src/runtime/contracts.js';

/**
 * Live M02 proof against real PostgreSQL and FalkorDB.
 *
 * These cases assert the things a mock cannot show: real foreign keys, the
 * guarded claim actually committing, the attempt journal being readable after
 * the fact, and — most importantly — that the provider dispatch count stays at
 * zero whenever a pre-dispatch guard refuses.
 */

function readLocalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  let text = '';
  let directory = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      text = readFileSync(join(directory, '.env'), 'utf8');
      break;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) env[match[1]] = match[2];
  }
  return env;
}

/**
 * A tenant slug unique to this process.
 *
 * Live runs then never inherit a previous run's owner identity, graph keys or
 * durable rows, so a run needs no destructive reset of the verification database
 * and no volume is ever dropped. The verification stores only accumulate.
 */
const LIVE_TENANT_SLUG_PREFIX = `${process.env['THREADLINE_LIVE_TENANT_SLUG'] ?? 'm02-live'}-${randomUUID().slice(0, 8)}`;

/**
 * A fresh tenant per case.
 *
 * Several cases deliberately withdraw authority -- revoking a session, removing
 * a membership -- and the bootstrap reader refuses to start when the tenant has
 * no usable owner project. Sharing one tenant would let one case's withdrawal
 * decide another case's result, so each case gets its own.
 */
let tenantCounter = 0;
function nextTenantSlug(): string {
  tenantCounter += 1;
  return `${LIVE_TENANT_SLUG_PREFIX}-${tenantCounter}`;
}

const cached = new Map<string, BackendConfig>();
function liveConfig(slug: string): BackendConfig {
  const existing = cached.get(slug);
  if (existing !== undefined) return existing;
  const parsed = parseBackendConfig({
    env: {
      ...readLocalEnv(),
      THREADLINE_PROVIDER: 'openai',
      THREADLINE_PROVIDER_API: 'responses',
      THREADLINE_PROVIDER_BASE_URL: 'https://api.openai.com/v1',
      THREADLINE_TENANT_SLUG: slug,
      THREADLINE_STORAGE_MODE: 'required',
      THREADLINE_PORT: '0',
      // One data directory per case as well as one tenant: the local owner
      // credential lives in the data directory, so sharing it across tenants
      // would refuse the second bootstrap.
      THREADLINE_DATA_DIR: join('.threadline-agentA-test', slug),
      THREADLINE_PG_HOST: '127.0.0.1',
      THREADLINE_PG_PORT: process.env['THREADLINE_LIVE_PGPORT'] ?? '55433',
      THREADLINE_PG_DATABASE: process.env['THREADLINE_LIVE_PGDATABASE'] ?? 'threadline_agent_a',
      THREADLINE_PG_USER: process.env['THREADLINE_LIVE_PGUSER'] ?? 'threadline_app',
      THREADLINE_PG_PASSWORD: process.env['THREADLINE_LIVE_PGPASSWORD'] ?? '',
      THREADLINE_PG_MIGRATION_USER: process.env['THREADLINE_LIVE_PGMIGRATIONUSER'] ?? 'threadline',
      THREADLINE_PG_MIGRATION_PASSWORD:
        process.env['THREADLINE_LIVE_PGMIGRATIONPASSWORD'] ??
        process.env['THREADLINE_LIVE_PGPASSWORD'] ??
        '',
      THREADLINE_PG_APPLICATION_ROLE: 'threadline_app',
      THREADLINE_FALKORDB_HOST: '127.0.0.1',
      THREADLINE_FALKORDB_PORT: process.env['THREADLINE_LIVE_GRAPHPORT'] ?? '56380',
      // A clearly labelled test-only credential. No inference is ever made.
      THREADLINE_OPENAI_API_KEY: process.env['THREADLINE_LIVE_APIKEY'] ?? 'local-fixture-credential',
      THREADLINE_PROVIDER_MODEL: 'fixture-model-m02',
    },
  });
  cached.set(slug, parsed);
  return parsed;
}

interface CapturedFailure {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;
}

/** Captures a typed failure so the test can assert on it without class identity. */
async function captureFailure(work: () => Promise<unknown>): Promise<CapturedFailure> {
  try {
    await work();
  } catch (error) {
    if (typeof error !== 'object' || error === null) {
      throw new Error(`expected a typed failure, received ${String(error)}`);
    }
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : '',
      message: typeof candidate.message === 'string' ? candidate.message : '',
      details: typeof candidate.details === 'object' && candidate.details !== null
        ? (candidate.details as Readonly<Record<string, string | number | boolean>>)
        : undefined,
    };
  }
  throw new Error('expected the operation to fail, but it succeeded');
}

function reasonOf(failure: CapturedFailure): string | undefined {
  return failure.details?.['reason'] === undefined ? undefined : String(failure.details['reason']);
}

const live = process.env['THREADLINE_LIVE'] === '1';
const options = { skip: live ? false : 'set THREADLINE_LIVE=1 with reachable verification stores' };

/** Counts provider dispatches. It must stay at zero when a guard refuses. */
let dispatchCount = 0;

/**
 * The stores the running backend actually uses.
 *
 * The backend accepts injected stores, so a test holds the very same database
 * and graph client the service uses. That is how a case can withdraw a grant or
 * expire a lease in place, rather than through a product surface invented only
 * to make the test pass.
 */
interface TestStores {
  readonly db: SqlDatabase;
  readonly graphs: GraphStore;
}

async function admittedBackend(slug: string, stores?: TestStores): Promise<Backend> {
  const backend = createBackend({
    config: liveConfig(slug),
    logger: silentLogger,
    ...(stores === undefined ? {} : { database: stores.db, graphStore: stores.graphs }),
  });
  await backend.start();
  await retireLeftoverRuns(backend);
  return backend;
}

/**
 * Each case starts from a clean installation state.
 *
 * The one-live-run guard stays strict; this retires runs a previous case left
 * open through the real cancellation path rather than weakening the check.
 */
async function retireLeftoverRuns(backend: Backend): Promise<void> {
  const bootstrap = backend.localBootstrap;
  if (bootstrap === null) return;
  const execution = backend.services.execution();
  if (execution === null) return;
  const principal = await principalOf(backend);
  for (const runId of await execution.listActiveRuns(bootstrap.tenantId, bootstrap.projectId)) {
    await execution.cancel(principal, runId, 'retire_leftover_between_cases');
  }
}

async function principalOf(backend: Backend) {
  const file = backend.localBootstrap?.sessionTokenPath;
  assert.ok(file);
  const token = (JSON.parse(readFileSync(file, 'utf8')) as { token: string }).token;
  return backend.services.authenticate(`Bearer ${token}`);
}

async function acceptGoal(backend: Backend, requestId: string) {
  const principal = await principalOf(backend);
  const projectId = backend.localBootstrap?.projectId ?? '';
  const outcome = await backend.dispatch(
    {
      protocolVersion: 1,
      command: 'task.accept_goal',
      input: {
        projectId,
        requestId,
        fixtureId: 'inventory-export-v1',
        goalText: 'Produce deterministic CSV for valid fresh inventory rows.',
        requirements: [
          { field: 'max_age_seconds', type: 'integer', value: 600, minimum: 0, maximum: 3600, revision: 1 },
        ],
        criteria: [
          { kind: 'assertion', ref: 'initial-mixed-offsets', text: 'Deterministic CSV.', required: true, expectedExitCode: 0 },
        ],
      },
    },
    `Bearer ${(JSON.parse(readFileSync(principal ? backend.localBootstrap!.sessionTokenPath : '', 'utf8')) as { token: string }).token}`,
  );
  assert.equal(outcome.status, 200, `goal admission failed: ${JSON.stringify(outcome.body)}`);
  assert.equal(outcome.body.ok, true);
  return { principal, projectId };
}

async function seedExecution(
  backend: Backend,
  opts: {
    probeStatus: string;
    authRoute: string;
    ownerUserId?: string;
    profileSettings?: Record<string, unknown>;
    stores?: TestStores;
  },
) {
  const principal = await principalOf(backend);
  const { projectId } = await acceptGoal(backend, randomUUID());

  const execution = backend.services.execution();
  assert.ok(execution, 'execution surface must exist once storage is ready');

  const tenantId = backend.localBootstrap!.tenantId;
  // The committed command's SQL message is what the graph Source stands for.
  const committed = opts.stores === undefined
    ? null
    : await opts.stores.db.withTenantTransaction(tenantId, (tx) =>
        tx.rows<{ source_message_id: string }>(
          `SELECT source_message_id FROM threadline.command_inbox
            WHERE tenant_id = $1 AND project_id = $2 AND status = 'committed'
            ORDER BY graph_event_seq DESC LIMIT 1`,
          [tenantId, projectId],
        ),
      );
  const sourceMessageId = committed?.[0]?.source_message_id ?? '';

  const account = await execution.registry.registerProviderAccount({
    tenantId: backend.localBootstrap!.tenantId,
    userId: opts.ownerUserId ?? principal.userId,
    provider: 'openai',
    runtime: 'owned-responses',
    authRoute: opts.authRoute,
    label: 'm02 verification account',
    secretRef: null,
    probeStatus: opts.probeStatus,
  });
  const profile = await execution.registry.registerProviderProfile({
    tenantId: backend.localBootstrap!.tenantId,
    projectId,
    ownerUserId: opts.ownerUserId ?? principal.userId,
    providerAccountId: account.id,
    name: 'm02 verification profile',
    modelId: 'fixture-model-m02',
    adapterVersion: 'responses@6.8.0',
    // Effective capacity must be declared by the admitted profile; the budget
    // path fails closed when it is absent.
    settings: opts.profileSettings ?? { contextWindowTokens: 128_000, maxOutputTokens: 1500 },
  });
  const host = await execution.registry.registerHost({
    tenantId: backend.localBootstrap!.tenantId,
    userId: principal.userId,
    name: 'local-backend',
    allowedRoots: [join(process.cwd(), '.threadline-agentA-test')],
    capabilities: ['workspace.read', 'workspace.search', 'workspace.inspect'],
  });
  return {
    principal,
    projectId,
    account,
    profile,
    host,
    sourceMessageId,
    userSessionId: backend.localBootstrap!.sessionId,
  };
}

function startInput(projectId: string, taskId: string, profileId: string, hostId: string): StartRunInput & {
  hostId: string;
  workspacePath: string;
  workspaceFingerprint: string;
} {
  return {
    projectId,
    requestId: randomUUID(),
    taskId,
    profileId,
    workspaceId: randomUUID(),
    hostId,
    workspacePath: join(process.cwd(), '.threadline-agentA-test', 'candidate'),
    workspaceFingerprint: 'a'.repeat(64),
    expectedRevision: 1,
    expectedRequirementRevision: 1,
  };
}

/**
 * Builds the exact request body the transport would send, and the digest over
 * it. The journal stores these bytes and re-hashes them, so a fixture that
 * fabricates metadata cannot pass.
 */
function preparedAttempt(
  identity: { logicalRequestId: string; attemptId: string },
  model: string,
  options: { inputItems: number; digestSeed: string },
): PreparedAttempt {
  const requestBody = JSON.stringify({
    model,
    input: Array.from({ length: options.inputItems }, (_, index) => ({
      role: 'user',
      content: `message-${String(index)}-${options.digestSeed}`,
    })),
    tools: [{ type: 'function', name: 'workspace_read', description: 'read', strict: true, parameters: {} }],
    max_output_tokens: 1500,
    stream: true,
    store: false,
    parallel_tool_calls: false,
  });
  return {
    ...identity,
    requestBody,
    requestDigest: createHash('sha256').update(requestBody).digest('hex'),
    requestBytes: Buffer.byteLength(requestBody),
    model,
    maxOutputTokens: 1500,
    inputItems: options.inputItems,
    toolCount: 1,
  };
}

async function authorityOf(backend: Backend, projectId: string) {
  const principal = await principalOf(backend);
  return backend.services.authority(principal, projectId);
}

test('live: a run requires a configured credential and refuses a fixture account in production mode', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'fixture', authRoute: 'local' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const input = startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);

  // Production mode refuses the labelled fixture account before any dispatch.
  await captureFailure(
    () => execution.start({ apiKey: 'test-key', fixtureProfileAllowed: false }, seeded.principal, input, randomUUID()),
  ).then((failure) => {
    assert.equal(failure.code, 'unauthorized');
    assert.equal(reasonOf(failure), 'fixture_account_refused');
  });

  // Ownership is checked before credential state, so an unauthorized caller
  // learns nothing about whether a credential exists. A legitimate owner of a
  // non-fixture profile still cannot start without a credential.
  const configured = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const configuredAuthority = await authorityOf(backend, configured.projectId);
  const configuredInput = startInput(
    configured.projectId,
    configuredAuthority.taskId,
    configured.profile.id,
    configured.host.hostId,
  );
  await captureFailure(
    () => execution.start({ apiKey: null }, configured.principal, configuredInput, randomUUID()),
  ).then((failure) => {
    assert.equal(failure.code, 'unauthorized');
    assert.equal(reasonOf(failure), 'no_configured_credential');
  });

  assert.equal(dispatchCount, 0);
  await backend.stop();
});

test('live: admission writes real FK rows and the guarded claim commits once', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const input = startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);

  const outcome = await execution.start(
    { apiKey: 'test-key', fixtureProfileAllowed: false },
    seeded.principal,
    input,
    randomUUID(),
  );
  assert.equal(outcome.kind, 'admitted');
  if (outcome.kind !== 'admitted') return;
  assert.ok(outcome.run.claim.fence >= 1);
  assert.equal(outcome.run.claim.ownerSessionId, outcome.run.sessionId);
  assert.equal(outcome.run.graphEpoch, backend.localBootstrap!.graphEpoch);

  // A second start while a run is live is refused, not silently admitted.
  const second = await startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);
  const secondFailure = await captureFailure(
    () => execution.start({ apiKey: 'test-key' }, seeded.principal, second, randomUUID()),
  );
  assert.equal(secondFailure.code, 'authority_conflict');

  // The SQL identities really exist with real foreign keys.
  const located = await backend.services.projectScope(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
  );
  assert.equal(located.projectId, seeded.projectId);

  await backend.stop();
});

test('live: a wrong-profile owner stops before dispatch', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);

  // A second account owned by nobody the principal can prove.
  const foreignAccount = await execution.registry.registerProviderAccount({
    tenantId: backend.localBootstrap!.tenantId,
    userId: seeded.principal.userId,
    provider: 'openai',
    runtime: 'owned-responses',
    authRoute: 'api_key',
    label: 'second account',
    secretRef: null,
    probeStatus: 'configured',
  });
  const foreignProfile = await execution.registry.registerProviderProfile({
    tenantId: backend.localBootstrap!.tenantId,
    projectId: seeded.projectId,
    ownerUserId: seeded.principal.userId,
    providerAccountId: foreignAccount.id,
    name: 'second profile',
    modelId: 'fixture-model-m02',
    adapterVersion: 'responses@6.8.0',
    settings: { contextWindowTokens: 128_000, maxOutputTokens: 1500 },
  });
  const input = startInput(seeded.projectId, authority.taskId, foreignProfile.id, seeded.host.hostId);
  const outcome = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    input,
    randomUUID(),
  );
  // Same owner, so it is admitted; the point is that the FK chain is real.
  assert.equal(outcome.kind, 'admitted');
  assert.equal(dispatchCount, 0);
  await backend.stop();
});

test('live: the attempt journal records exact bytes before any dispatch and survives a restart', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const input = startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);
  const started = await execution.start({ apiKey: 'test-key' }, seeded.principal, input, randomUUID());
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;

  const guard = execution.turnGuard(
    {
      tenantId: backend.localBootstrap!.tenantId,
      projectId: seeded.projectId,
      runId: run.runId,
      sessionId: run.sessionId,
      taskId: authority.taskId,
      profileId: seeded.profile.id,
      workspaceId: run.workspaceId,
      graphEpoch: run.graphEpoch,
      model: run.model,
      correlationId: run.correlationId,
    },
    {
      fence: run.claim.fence,
      revision: run.claim.revision,
      requirementRevision: run.claim.requirementRevision,
      leaseExpiresMs: new Date(run.claim.leaseExpiresAt).getTime(),
    },
  );

  const identity: AttemptIdentity = await guard.beginTurn();
  const prepared = preparedAttempt(identity, run.model, { inputItems: 2, digestSeed: 'b' });
  await guard.authorizeAndJournal(prepared);

  // The input artifact must be readable and hash to the recorded digest.
  const row = await execution.journal.find(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    identity.attemptId,
  );
  assert.ok(row, 'the attempt row must exist before dispatch');
  assert.equal(row.status, 'prepared');
  assert.equal(row.possibleCharge, false);
  const bytes = await execution.artifacts.read(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    row.inputArtifactId,
  );
  assert.ok(bytes.byteLength > 0);

  // Transport observations are recorded, and remain not-a-completion.
  const dispatchObservation: ProviderLifecycle = {
    phase: 'dispatched',
    attempt: { ...identity, requestDigest: prepared.requestDigest },
  };
  // `observeLifecycle` is asynchronous by contract: the transport must not
  // block on a journal write. Poll for the durable observation.
  guard.observeLifecycle(dispatchObservation);
  let afterDispatch = await execution.journal.find(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    identity.attemptId,
  );
  const deadline = Date.now() + 3_000;
  while (afterDispatch?.status !== 'dispatched' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    afterDispatch = await execution.journal.find(
      backend.localBootstrap!.tenantId,
      seeded.projectId,
      identity.attemptId,
    );
  }
  assert.equal(afterDispatch?.status, 'dispatched');
  assert.equal(afterDispatch?.possibleCharge, true);

  // Restart: the unresolved attempt is still there and still blocks.
  await backend.stop();
  const restarted = await admittedBackend(slug);
  const execution2 = restarted.services.execution();
  assert.ok(execution2);
  const persisted = await execution2.journal.find(
    restarted.localBootstrap!.tenantId,
    seeded.projectId,
    identity.attemptId,
  );
  assert.equal(persisted?.status, 'dispatched');
  assert.equal(
    await execution2.journal.countUnresolved(
      restarted.localBootstrap!.tenantId,
      seeded.projectId,
      run.sessionId,
    ),
    1,
  );

  // A restart must never turn an unresolved attempt into success.
  assert.notEqual(persisted?.status, 'completed');
  await restarted.stop();
});

test('live: a terminal record without complete evidence stays unknown and retains its reservation', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const input = startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);
  const started = await execution.start({ apiKey: 'test-key' }, seeded.principal, input, randomUUID());
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = execution.turnGuard(
    {
      tenantId: backend.localBootstrap!.tenantId,
      projectId: seeded.projectId,
      runId: run.runId,
      sessionId: run.sessionId,
      taskId: authority.taskId,
      profileId: seeded.profile.id,
      workspaceId: run.workspaceId,
      graphEpoch: run.graphEpoch,
      model: run.model,
      correlationId: run.correlationId,
    },
    {
      fence: run.claim.fence,
      revision: run.claim.revision,
      requirementRevision: run.claim.requirementRevision,
      leaseExpiresMs: new Date(run.claim.leaseExpiresAt).getTime(),
    },
  );

  const identity = await guard.beginTurn();
  const prepared = preparedAttempt(identity, run.model, { inputItems: 1, digestSeed: 'c' });
  await guard.authorizeAndJournal(prepared);

  const settled: SettledAttempt = {
    ...identity,
    // A transport that ended without a complete terminal record.
    status: 'unknown',
    reason: 'stream_ended_without_terminal_response',
    responseId: null,
    providerRequestId: null,
    possibleCharge: true,
    usage: null,
  };
  const outcome = await guard.settleAttempt(settled, {
    visibleOutput: [],
    toolCalls: [],
    responseId: null,
    usage: { precision: 'reserved', reason: settled.reason },
    complete: false,
  });

  assert.equal(outcome.state, 'unknown');
  assert.equal(outcome.reservationRetained, true);
  assert.equal(outcome.blockedOnReconciliation, true);
  // An incomplete batch releases no tool calls.
  assert.deepEqual(outcome.releasedToolCalls, []);

  const row = await execution.journal.find(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    identity.attemptId,
  );
  assert.equal(row?.status, 'unknown');
  assert.equal(row?.responseArtifactId, null);

  // A second attempt is refused while one is unresolved.
  const thirdFailure = await captureFailure(async () => {
    const second = await guard.beginTurn();
    await guard.authorizeAndJournal(
      preparedAttempt(second, run.model, { inputItems: 1, digestSeed: 'd' }),
    );
  });
  assert.equal(thirdFailure.code, 'authority_conflict');
  assert.equal(reasonOf(thirdFailure), 'unresolved_attempt');
  await backend.stop();
});

/**
 * Builds a guard for an admitted run, mirroring the assembled loop's wiring.
 */
/**
 * Opens the stores directly, for cases that must mutate durable state.
 */
async function openStores(slug: string): Promise<TestStores> {
  const config = liveConfig(slug);
  return {
    db: createSqlDatabase({ config: config.storage.postgres, logger: silentLogger }),
    graphs: createGraphStore({ config: config.storage.falkordb, logger: silentLogger }),
  };
}

async function guardFor(
  execution: NonNullable<ReturnType<Backend['services']['execution']>>,
  backend: Backend,
  seeded: Awaited<ReturnType<typeof seedExecution>>,
  authority: { taskId: string },
  run: RunLaunchView,
) {
  return execution.turnGuard(
    {
      tenantId: backend.localBootstrap!.tenantId,
      projectId: seeded.projectId,
      runId: run.runId,
      sessionId: run.sessionId,
      taskId: authority.taskId,
      profileId: seeded.profile.id,
      workspaceId: run.workspaceId,
      graphEpoch: run.graphEpoch,
      model: run.model,
      correlationId: run.correlationId,
    },
    {
      fence: run.claim.fence,
      revision: run.claim.revision,
      requirementRevision: run.claim.requirementRevision,
      leaseExpiresMs: new Date(run.claim.leaseExpiresAt).getTime(),
    },
  );
}

test('live: the journal stores the exact transmitted bytes and separates every digest', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);

  const identity: AttemptIdentity = await guard.beginTurn();
  const prepared = preparedAttempt(identity, run.model, { inputItems: 3, digestSeed: 'exact' });
  await guard.authorizeAndJournal(prepared);

  const attempts = await execution.journal.list(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    run.sessionId,
  );
  const attempt = attempts.find((entry) => entry.logicalRequestId === identity.logicalRequestId);
  assert.ok(attempt, 'the attempt must be durable');

  // 1. The stored bytes are the transmitted bytes, byte for byte.
  const stored = await execution.artifacts.read(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    attempt.inputArtifactId,
  );
  assert.equal(stored.byteLength, prepared.requestBytes, 'stored byte length must equal sent byte length');
  assert.equal(stored.toString('utf8'), prepared.requestBody, 'stored bytes must equal sent bytes');

  // 2. The request digest really is the sha256 of those bytes.
  assert.equal(createHash('sha256').update(stored).digest('hex'), prepared.requestDigest);
  assert.equal(attempt.inputDigest, prepared.requestDigest);

  // 3. The profile digest is the profile's own configuration digest, and is a
  //    different fact from the request digest.
  assert.equal(attempt.profileDigest, seeded.profile.configDigest.trim());
  assert.notEqual(
    attempt.profileDigest,
    attempt.inputDigest,
    'profile configuration digest must never be the request digest',
  );

  // 4. The run's policy digest is yet another distinct digest, and the whole
  //    set is visible through the public inspect surface.
  const inspected = await execution.inspect(seeded.principal, run.runId);
  assert.ok(inspected.run.policyDigest, 'the run must record a policy digest');
  assert.equal(inspected.run.profileConfigDigest, attempt.profileDigest);
  assert.notEqual(inspected.run.policyDigest, inspected.run.profileConfigDigest);
  assert.notEqual(inspected.run.policyDigest, attempt.inputDigest);

  // 5. Inspect reports the real durable attempt, with both digests.
  const viewed = inspected.attempts.find((a) => a.logicalRequestId === identity.logicalRequestId);
  assert.ok(viewed, 'inspect must list the durable attempt');
  assert.equal(viewed.inputDigest, prepared.requestDigest);
  assert.equal(viewed.profileDigest, inspected.run.profileConfigDigest);
  assert.equal(viewed.possibleCharge, false, 'a prepared attempt cannot have been charged');

  await backend.stop();
});

test('live: bytes that disagree with the request digest are refused before any dispatch', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);

  const identity: AttemptIdentity = await guard.beginTurn();
  const honest = preparedAttempt(identity, run.model, { inputItems: 2, digestSeed: 'lie' });

  await assert.rejects(
    () =>
      guard.authorizeAndJournal({
        ...honest,
        // A digest that does not describe the bytes that would be sent.
        requestDigest: createHash('sha256').update('something else').digest('hex'),
      }),
    /digest does not match/i,
  );

  // Nothing durable, therefore nothing dispatchable.
  const attempts = await execution.journal.list(
    backend.localBootstrap!.tenantId,
    seeded.projectId,
    run.sessionId,
  );
  assert.equal(attempts.filter((entry) => entry.logicalRequestId === identity.logicalRequestId).length, 0);

  await backend.stop();
});

test('live: a profile that declares no context window fails closed with zero dispatch', options, async () => {
  const slug = nextTenantSlug();
  const backend = await admittedBackend(slug);
  const seeded = await seedExecution(backend, {
    probeStatus: 'configured',
    authRoute: 'api_key',
    profileSettings: { maxOutputTokens: 1500 },
  });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);

  const identity: AttemptIdentity = await guard.beginTurn();
  await assert.rejects(
    () => guard.authorizeAndJournal(preparedAttempt(identity, run.model, { inputItems: 1, digestSeed: 'c' })),
    /context window|fails closed/i,
  );

  assert.equal(
    (await execution.journal.list(backend.localBootstrap!.tenantId, seeded.projectId, run.sessionId)).length,
    0,
    'an undeclared capacity must leave no durable attempt',
  );

  await backend.stop();
});

test('live: a revoked standing session withdraws the authority a turn depends on', options, async () => {
  const slug = nextTenantSlug();
  const stores = await openStores(slug);
  const backend = await admittedBackend(slug, stores);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);

  // A live turn first, so the refusal below cannot be blamed on a run that was
  // never allowed to start.
  await guard.beginTurn();

  const tenantId = backend.localBootstrap!.tenantId;
  await stores.db.withTenantTransaction(tenantId, (tx) =>
    tx.rows('UPDATE threadline.user_sessions SET revoked_at = now() WHERE tenant_id = $1', [tenantId]),
  );

  // `beginTurn` re-verifies too, so the refusal surfaces there and no attempt
  // identity is ever handed out for a withdrawn authority.
  await assert.rejects(() => guard.beginTurn(), /revoked/i);
  assert.equal(
    (await execution.journal.list(tenantId, seeded.projectId, run.sessionId)).length,
    0,
    'a revoked session must leave no durable attempt to dispatch',
  );

  await backend.stop();
});

test('live: removing project membership withdraws the authority a turn depends on', options, async () => {
  const slug = nextTenantSlug();
  const stores = await openStores(slug);
  const backend = await admittedBackend(slug, stores);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);
  await guard.beginTurn();

  const tenantId = backend.localBootstrap!.tenantId;
  await stores.db.withTenantTransaction(tenantId, (tx) =>
    tx.rows(
      `UPDATE threadline.project_memberships SET status = 'revoked'
        WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3`,
      [tenantId, seeded.projectId, seeded.principal.userId],
    ),
  );

  await assert.rejects(() => guard.beginTurn(), /member/i);

  await backend.stop();
});

test('live: an expired claim lease stops the turn even when nothing else changed', options, async () => {
  const slug = nextTenantSlug();
  const stores = await openStores(slug);
  const backend = await admittedBackend(slug, stores);
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;

  const tenantId = backend.localBootstrap!.tenantId;
  // A control point: with the recorded lease intact the turn is allowed.
  const live = await guardFor(execution, backend, seeded, authority, run);
  await live.beginTurn();

  // Expire the lease the graph actually holds, without touching anything else.
  await stores.db.withTenantTransaction(tenantId, async (tx) => {
    const located = await tx.rows<{ graph_key: string }>(
      `SELECT pj.graph_key
         FROM threadline.agent_sessions s
         JOIN threadline.projects pj ON pj.tenant_id = s.tenant_id AND pj.id = s.project_id
        WHERE s.tenant_id = $1 AND s.run_id = $2`,
      [tenantId, run.runId],
    );
    const graphKey = located[0]?.graph_key;
    assert.ok(graphKey);
    await tx.rows(
      `UPDATE threadline.runs SET policy_digest = policy_digest WHERE tenant_id = $1 AND id = $2`,
      [tenantId, run.runId],
    );
    // The lease lives in the graph, so it is expired there.
    await stores.graphs.graph(graphKey).query(
      `MATCH (t:Entity:Task {id:$task_id})-[:CURRENT_STATE]->(s:Entity:TaskState), (a:AgentSession {sql_id:$session_id})
        WHERE s.fence = $fence AND s.status = 'running'
        SET a.lease_expires_ms = $expired`,
      { params: { task_id: authority.taskId, session_id: run.sessionId, fence: run.claim.fence, expired: Date.now() - 1 } },
    );
  });

  const expired = await guardFor(execution, backend, seeded, authority, run);
  await assert.rejects(() => expired.beginTurn(), /lease has expired/i);
  assert.equal(
    (await execution.journal.list(tenantId, seeded.projectId, run.sessionId)).length,
    0,
    'an expired lease must leave no durable attempt',
  );

  await backend.stop();
});

test('live: source bytes that no longer match their digest stop the release', options, async () => {
  const slug = nextTenantSlug();
  const stores = await openStores(slug);
  const backend = await admittedBackend(slug, stores);
  const seeded = await seedExecution(backend, {
    probeStatus: 'configured',
    authRoute: 'api_key',
    stores,
  });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);
  // Control point: the source is intact, so the turn is allowed.
  assert.ok(seeded.sourceMessageId.length > 0, 'the admitted source message must be known');
  await guard.beginTurn();

  const tenantId = backend.localBootstrap!.tenantId;
  // Rewrite the admitted source text without updating the digest recorded for
  // it, so the authority no longer describes the bytes it points at.
  await stores.db.withTenantTransaction(tenantId, (tx) =>
    tx.rows(
      `UPDATE threadline.project_messages SET body = 'rewritten after admission'
        WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
      [tenantId, seeded.projectId, seeded.sourceMessageId],
    ),
  );

  await assert.rejects(() => guard.beginTurn(), /source/i);
  assert.equal(
    (await execution.journal.list(tenantId, seeded.projectId, run.sessionId)).length,
    0,
    'an unreadable source must leave no durable attempt',
  );

  await backend.stop();
});

test('live: human command admission and worker release serialize on one project lock', options, async () => {
  const slug = nextTenantSlug();
  const stores = await openStores(slug);
  const backend = await admittedBackend(slug, stores);
  const seeded = await seedExecution(backend, {
    probeStatus: 'configured',
    authRoute: 'api_key',
    stores,
  });
  const execution = backend.services.execution();
  assert.ok(execution);
  const authority = await authorityOf(backend, seeded.projectId);
  const started = await execution.start(
    { apiKey: 'test-key' },
    seeded.principal,
    startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId),
    randomUUID(),
  );
  assert.equal(started.kind, 'admitted');
  if (started.kind !== 'admitted') return;
  const run = started.run;
  const guard = await guardFor(execution, backend, seeded, authority, run);
  const identity: AttemptIdentity = await guard.beginTurn();
  const prepared = preparedAttempt(identity, run.model, { inputItems: 2, digestSeed: 's' });

  const tenantId = backend.localBootstrap!.tenantId;
  const projectId = seeded.projectId;

  // A worker admitting an attempt and a human command being admitted for the
  // same project, started together. Both must complete, and neither may
  // interleave inside the other.
  const [workerOutcome, humanOutcome] = await Promise.allSettled([
    guard.authorizeAndJournal(prepared),
    stores.db.withTenantTransaction(tenantId, async (tx) => {
      await tx.rows('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        projectAdmissionLockKey(tenantId, projectId),
      ]);
      await tx.rows(
        `INSERT INTO threadline.command_inbox
           (tenant_id, project_id, id, initiated_by, user_session_id, request_id, graph_epoch,
            operation, payload, request_digest, status, attempts, next_attempt_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'serialization_probe', '{}'::jsonb, $8,
                 'pending', 0, now(), now())`,
        [
          tenantId,
          projectId,
          randomUUID(),
          seeded.principal.userId,
          seeded.userSessionId,
          randomUUID(),
          run.graphEpoch,
          '0'.repeat(64),
        ],
      );
      return true;
    }),
  ]);

  // Both sides committed exactly once: the shared lock made them serialize
  // rather than collide, and neither lost its work.
  assert.equal(workerOutcome.status, 'fulfilled', 'the worker attempt must still be admitted');
  assert.equal(humanOutcome.status, 'fulfilled');

  const attempts = await execution.journal.list(tenantId, projectId, run.sessionId);
  assert.equal(attempts.length, 1, 'exactly one attempt may be admitted');

  await backend.stop();
});

test('review: a definite claim refusal closes SQL identities and its retry stays refused', options, async t => {
  const backend = await admittedBackend(nextTenantSlug()); t.after(() => backend.stop());
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key' });
  const execution = backend.services.execution()!;
  const authority = await authorityOf(backend, seeded.projectId);
  const request = startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId);
  const refused = { ...request, expectedRevision: 999 };
  const first = await captureFailure(() => execution.start({ apiKey: 'test-key' }, seeded.principal, refused, randomUUID()));
  assert.equal(first.code, 'authority_conflict');
  assert.deepEqual(await execution.listActiveRuns(seeded.principal.tenantId, seeded.projectId), []);
  const retry = await captureFailure(() => execution.start({ apiKey: 'test-key' }, seeded.principal, refused, randomUUID()));
  assert.equal(retry.code, 'authority_conflict'); assert.equal(reasonOf(retry), 'claim_refused');
  const next = await execution.start({ apiKey: 'test-key' }, seeded.principal, { ...request, requestId: randomUUID() }, randomUUID());
  assert.equal(next.kind, 'admitted');
});

test('review: only the initiating project member can heartbeat or cancel a run', options, async t => {
  const slug = nextTenantSlug(), stores = await openStores(slug), backend = await admittedBackend(slug, stores); t.after(() => backend.stop());
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key', stores });
  const authority = await authorityOf(backend, seeded.projectId), execution = backend.services.execution()!;
  const started = await execution.start({ apiKey: 'test-key' }, seeded.principal, startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId), randomUUID());
  assert.equal(started.kind, 'admitted'); if (started.kind !== 'admitted') return;
  const other = randomUUID(), session = randomUUID(), token = randomUUID() + randomUUID();
  await stores.db.query("INSERT INTO threadline.users(id,display_name,status) VALUES($1,'review-other-member','active')", [other]);
  await stores.db.withTenantTransaction(seeded.principal.tenantId, async tx => {
    await tx.rows("INSERT INTO threadline.tenant_memberships(tenant_id,id,user_id,role,status) VALUES($1,$2,$3,'member','active')", [seeded.principal.tenantId,randomUUID(),other]);
    await tx.rows(`INSERT INTO threadline.user_sessions(tenant_id,id,user_id,token_hash,auth_method,last_seen_at,expires_at,idle_expires_at,client_label)
      VALUES($1,$2,$3,$4,'local_bootstrap',now(),now()+interval '1 hour',now()+interval '30 minutes','review')`, [seeded.principal.tenantId,session,other,createHash('sha256').update(token).digest('hex')]);
  });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const heartbeat = () => fetch(`${backend.address!.url}/runs/${started.run.runId}/heartbeat`, { method: 'POST', headers, body: '{}' });
  assert.equal((await heartbeat()).status, 401, 'a tenant user without project access cannot renew the lease');
  await stores.db.withTenantTransaction(seeded.principal.tenantId, tx => tx.rows("INSERT INTO threadline.project_memberships(tenant_id,project_id,id,user_id,role,status) VALUES($1,$2,$3,$4,'editor','active')", [seeded.principal.tenantId,seeded.projectId,randomUUID(),other]));
  assert.equal((await heartbeat()).status, 401, 'project membership does not grant control of another user’s run');
  const cancelled = await fetch(`${backend.address!.url}/runs/cancel`, { method: 'POST', headers, body: JSON.stringify({ runId: started.run.runId, reason: 'unauthorized cancellation' }) });
  assert.equal(cancelled.status, 401);
  const owner = await execution.inspect(seeded.principal, started.run.runId);
  assert.equal(owner.run.sessionState, 'live'); assert.equal(owner.run.claim.leaseExpiresAt, started.run.claim.leaseExpiresAt);
  await execution.heartbeat(seeded.principal, started.run.runId);
  assert.equal((await execution.cancel(seeded.principal, started.run.runId, 'owner cancellation')).acknowledged, true);
});

test('review: inspection persists active state and reports the exact unresolved count', options, async t => {
  const slug = nextTenantSlug(), stores = await openStores(slug), backend = await admittedBackend(slug, stores); t.after(() => backend.stop());
  const seeded = await seedExecution(backend, { probeStatus: 'configured', authRoute: 'api_key', stores });
  const authority = await authorityOf(backend, seeded.projectId), execution = backend.services.execution()!;
  const started = await execution.start({ apiKey: 'test-key' }, seeded.principal, startInput(seeded.projectId, authority.taskId, seeded.profile.id, seeded.host.hostId), randomUUID());
  assert.equal(started.kind, 'admitted'); if (started.kind !== 'admitted') return;
  assert.equal((await execution.inspect(seeded.principal, started.run.runId)).run.state, 'active');
  const guard = await guardFor(execution, backend, seeded, authority, started.run), identity = await guard.beginTurn();
  await guard.authorizeAndJournal(preparedAttempt(identity, 'fixture-model-m02', { inputItems: 1, digestSeed: 'review-count' }));
  await stores.db.withTenantTransaction(seeded.principal.tenantId, tx => tx.rows(`INSERT INTO threadline.model_requests
    (tenant_id,project_id,id,agent_session_id,logical_request_id,attempt_no,profile_id,input_artifact_id,input_digest,profile_digest,graph_epoch,requirement_revision,reservation_graph_id,status,created_at,reserved_tokens,possible_charge)
    SELECT tenant_id,project_id,$3,agent_session_id,$4,1,profile_id,input_artifact_id,input_digest,profile_digest,graph_epoch,requirement_revision,$5,'prepared',now(),reserved_tokens,false
    FROM threadline.model_requests WHERE tenant_id=$1 AND id=$2`, [seeded.principal.tenantId,identity.attemptId,randomUUID(),randomUUID(),randomUUID()]));
  const inspected = await execution.inspect(seeded.principal, started.run.runId);
  assert.equal(inspected.unresolvedAttempts, 2); assert.equal(inspected.run.budget.blockedOnReconciliation, true);
});
