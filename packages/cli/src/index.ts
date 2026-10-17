#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  PROTOCOL_VERSION,
  ROUTES,
  SOURCE_KINDS,
  ThreadlineError,
  type CapabilityReport,
  type HealthReport,
  type ProjectJoinResult,
  type ProjectView,
  type SourceAppendResult,
  type SourceHistoryPage,
  type SourceKind,
  type SourceRange,
  type SourceView,
} from '@threadline/shared';
import {
  createJsonLogger,
  createMemoryService,
  initializeInstallation,
  installationPaths,
  loadServiceConfig,
  readCredentialFile,
  resolveHomeDirectory,
  THREADLINE_BACKEND_VERSION,
} from '@threadline/backend';

import { createApiClient, type ApiClient } from './client.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, HELP_TEXT, UsageError, parseCliArgs, type CliInvocation } from './options.js';

/**
 * Process entry point.
 *
 * Owns argument parsing, dispatch and the exit code. Service commands run
 * in-process against the memory service; client commands are thin typed calls
 * to a running instance. No command performs inference or starts native work.
 */

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const writeJson = (value: unknown): void => {
  write(JSON.stringify(value, null, 2));
};

async function main(argv: readonly string[]): Promise<number> {
  let invocation: CliInvocation;
  try {
    invocation = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP_TEXT}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }

  if (invocation.help) {
    write(HELP_TEXT);
    return EXIT_OK;
  }

  switch (invocation.command) {
    case 'version':
      write(`threadline ${readCliVersion()} (protocol v${String(PROTOCOL_VERSION)}, service ${THREADLINE_BACKEND_VERSION})`);
      return EXIT_OK;
    case 'help':
      write(HELP_TEXT);
      return EXIT_OK;
    case 'init':
      return runInit(invocation);
    case 'serve':
      return runServe(invocation);
    default:
      return runClientCommand(invocation);
  }
}

async function runInit(invocation: CliInvocation): Promise<number> {
  const logger = createJsonLogger({ component: 'threadline-init' });
  const report = await initializeInstallation({ home: invocation.home, logger });
  if (invocation.json) {
    writeJson(report);
    return EXIT_OK;
  }
  write(`Installation initialized at ${report.home}`);
  write(`  schema: threadline_memory version ${String(report.schema.version)} (${report.schema.state})`);
  write(`  tenant fence: ${report.schema.roleVerified ? 'enforced by a restricted role' : 'NOT VERIFIED'}`);
  write(`  graph store: ${report.graphReachable ? 'reachable' : 'unavailable (source history still works)'}`);
  write(`  source root: ${report.sourcesWritable ? 'writable' : 'NOT WRITABLE'}`);
  write(`  owner: ${report.owner.created ? 'created' : 'reused'} (tenant ${report.owner.tenantId})`);
  write(`  credential: ${report.credentialPath}`);
  return EXIT_OK;
}

async function runServe(invocation: CliInvocation): Promise<number> {
  const logger = createJsonLogger({ component: 'threadline' });
  const home = resolveHomeDirectory(invocation.home);
  const loaded = loadServiceConfig(home);
  const config = invocation.port === undefined ? loaded.config : { ...loaded.config, port: invocation.port };
  const service = createMemoryService({ config, logger });

  const stop = (): void => {
    void service
      .stop()
      .catch(() => undefined)
      .then(() => {
        process.exit(EXIT_OK);
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const address = await service.start();
  write(`threadline: listening on ${address.url} (state: ${service.state})`);
  if (service.state === 'degraded') {
    write('threadline: storage is not fully ready; run "threadline init" and check "threadline status".');
  }
  write('Codex owns inference; this process only stores and serves memory. Press Ctrl+C to stop.');
  // The listening socket keeps the process alive; this promise never resolves.
  return new Promise<number>(() => {});
}

async function runClientCommand(invocation: CliInvocation): Promise<number> {
  const home = resolveHomeDirectory(invocation.home);
  const config = loadServiceConfig(home).config;
  const paths = installationPaths(home);
  const credential = readCredentialFile(paths.credentialFile);
  const host = config.host === '::1' ? '[::1]' : config.host;
  const client = createApiClient({
    baseUrl: `http://${host}:${String(config.port)}`,
    token: credential?.token ?? null,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  switch (invocation.command) {
    case 'status':
      return showStatus(client, invocation);
    case 'capabilities':
      return showCapabilities(client, invocation);
    case 'project:add':
      return addProject(client, invocation);
    case 'project:list':
      return listProjects(client, invocation);
    case 'project:grants':
      return listGrants(client, invocation);
    case 'source:append':
      return appendSource(client, invocation);
    case 'source:inspect':
      return inspectSource(client, invocation);
    case 'source:read':
      return readSource(client, invocation);
    case 'history':
      return showHistory(client, invocation);
    default:
      write(HELP_TEXT);
      return EXIT_OK;
  }
}

async function showStatus(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const status = (await client.get(ROUTES.status)) as {
    health: HealthReport;
    storage: { configured: boolean; reachable: boolean; sqlReady: boolean; privilegedSqlReady: boolean; graphReady: boolean; filesReady: boolean; detail: string };
  };
  if (invocation.json) {
    writeJson(status);
    return EXIT_OK;
  }
  const { health, storage } = status;
  write(`Threadline memory service at ${client.baseUrl}`);
  write(`  state: ${health.state}   uptime: ${formatDuration(health.uptimeMs)}   service: ${health.backendVersion}   protocol: v${String(health.protocolVersion)}`);
  write('Components:');
  for (const component of health.components) {
    write(`  ${component.name.padEnd(14)} ${component.ready ? 'ready  ' : 'blocked'} ${component.detail}`);
  }
  write(`Storage: ${storage.detail}`);
  write(`Guarantees: ${health.guarantees.note}`);
  return health.state === 'ready' || health.state === 'degraded' ? EXIT_OK : EXIT_FAILURE;
}

async function showCapabilities(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const report = (await client.get(ROUTES.capabilities)) as CapabilityReport;
  if (invocation.json) {
    writeJson(report);
    return EXIT_OK;
  }
  write(`Threadline capabilities (service ${report.serviceVersion}, protocol v${String(report.protocolVersion)})`);
  write('Supported:');
  for (const operation of report.operations.filter((entry) => entry.status === 'supported')) {
    write(`  ${operation.id.padEnd(24)} ${operation.effect.padEnd(6)} ${operation.summary}`);
  }
  write('Unavailable:');
  for (const operation of report.operations.filter((entry) => entry.status !== 'supported')) {
    write(`  ${operation.id.padEnd(24)} ${operation.status.padEnd(11)} ${operation.reason ?? ''}`);
  }
  write(`Codex adapter: ${report.adapter.detail}`);
  return EXIT_OK;
}

async function addProject(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const root = resolve(invocation.root ?? '');
  const result = (await client.post(ROUTES.projects, {
    root,
    ...(invocation.label === null ? {} : { label: invocation.label }),
    ...(invocation.joinProjectId === null ? {} : { joinProjectId: invocation.joinProjectId }),
    idempotencyKey: `cli:project-add:${createHash('sha256').update(root).digest('hex').slice(0, 32)}`,
  })) as ProjectJoinResult;
  if (invocation.json) {
    writeJson(result);
    return EXIT_OK;
  }
  write(`${result.created ? 'Created' : 'Reused'} project ${result.project.projectId} (${result.project.label})`);
  write(`  graph epoch: ${result.project.graphEpoch}`);
  write(`  binding: ${result.binding.bindingId} ${result.binding.rootKind} ${result.binding.canonicalRoot}`);
  return EXIT_OK;
}

async function listProjects(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const projects = (await client.get(ROUTES.projects)) as ProjectView[];
  if (invocation.json) {
    writeJson(projects);
    return EXIT_OK;
  }
  if (projects.length === 0) {
    write('No projects are associated with this credential. Use "threadline project:add --root <path>".');
    return EXIT_OK;
  }
  for (const project of projects) {
    write(`${project.projectId}  ${project.role.padEnd(6)} ${project.policyState.padEnd(7)} ${project.label}`);
  }
  return EXIT_OK;
}

async function listGrants(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const grants = (await client.get(ROUTES.projectGrants(invocation.projectId ?? ''))) as ReadonlyArray<{
    principalId: string;
    role: string;
    state: string;
    grantRevision: string;
  }>;
  if (invocation.json) {
    writeJson(grants);
    return EXIT_OK;
  }
  for (const grant of grants) {
    write(`${grant.principalId}  ${grant.role.padEnd(6)} ${grant.state.padEnd(7)} revision ${grant.grantRevision}`);
  }
  return EXIT_OK;
}

async function appendSource(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const kind = invocation.kind ?? '';
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new UsageError(`--kind must be one of: ${SOURCE_KINDS.join(', ')}.`);
  }
  const filePath = resolve(invocation.file ?? '');
  const bytes = readFileSync(filePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const record = {
    // Content-derived by default: repeating the same file is an idempotent
    // retry and different bytes under the same identity refuse.
    deliveryId: invocation.delivery ?? `cli:${digest.slice(0, 32)}`,
    originKey: invocation.origin ?? `authored:${basename(filePath)}`,
    originRevision: invocation.revision ?? 'v1',
    kind: kind as SourceKind,
    observedAtMs: Date.now(),
    bytesBase64: bytes.toString('base64'),
    mediaType: invocation.mediaType ?? guessMediaType(filePath),
    completeness: 'complete',
    ...(invocation.visibility === null ? {} : { visibility: invocation.visibility }),
  };
  const result = (await client.post(ROUTES.appendSources, {
    projectId: invocation.projectId ?? '',
    records: [record],
  })) as SourceAppendResult;
  if (invocation.json) {
    writeJson(result);
    return result.outcomes.some((outcome) => outcome.status === 'rejected') ? EXIT_FAILURE : EXIT_OK;
  }
  for (const outcome of result.outcomes) {
    if (outcome.status === 'rejected') {
      write(`rejected ${outcome.deliveryId}: ${outcome.code} — ${outcome.detail}`);
    } else {
      write(`${outcome.status} ${outcome.deliveryId} → source ${outcome.sourceId} at project sequence ${outcome.projectSeq}`);
    }
  }
  return result.outcomes.some((outcome) => outcome.status === 'rejected') ? EXIT_FAILURE : EXIT_OK;
}

async function inspectSource(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const view = (await client.get(ROUTES.source(invocation.sourceId ?? ''), {
    projectId: invocation.projectId ?? '',
  })) as SourceView;
  if (invocation.json) {
    writeJson(view);
    return EXIT_OK;
  }
  write(`Source ${view.sourceId} (${view.kind})`);
  write(`  digest: ${view.digest} (${String(view.byteSize)} bytes, ${view.mediaType})`);
  write(`  origin: ${view.originKey} revision ${view.originRevision}`);
  write(`  project sequence: ${view.projectSeq}`);
  write(`  observed: ${new Date(view.observedAtMs).toISOString()}  captured: ${new Date(view.capturedAtMs).toISOString()}`);
  write(`  completeness: ${view.completeness}   availability: ${view.availability}   retention: ${view.retention}   visibility: ${view.visibility}`);
  if (view.gapReason !== null) {
    write(`  gap: ${view.gapReason}`);
  }
  return EXIT_OK;
}

async function readSource(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const start = invocation.offset ?? 0;
  const end = start + (invocation.maxBytes ?? 32_768);
  const range = (await client.get(ROUTES.sourceRange(invocation.sourceId ?? ''), {
    projectId: invocation.projectId ?? '',
    start,
    end,
  })) as SourceRange;
  if (invocation.json) {
    writeJson(range);
    return EXIT_OK;
  }
  process.stdout.write(Buffer.from(range.base64, 'base64'));
  process.stderr.write(
    `\nthreadline: bytes ${String(range.start)}-${String(range.end)} of ${String(range.totalBytes)}${range.truncated ? ' (truncated)' : ''}\n`,
  );
  return EXIT_OK;
}

async function showHistory(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const page = (await client.get(ROUTES.history, {
    projectId: invocation.projectId ?? '',
    limit: invocation.limit ?? 50,
    ...(invocation.kinds === null ? {} : { kinds: invocation.kinds.join(',') }),
    ...(invocation.nativeSessionId === null ? {} : { nativeSessionId: invocation.nativeSessionId }),
    ...(invocation.cursor === null ? {} : { cursor: invocation.cursor }),
  })) as SourceHistoryPage;
  if (invocation.json) {
    writeJson(page);
    return EXIT_OK;
  }
  for (const entry of page.entries) {
    write(
      `${entry.projectSeq.padStart(6)} ${entry.kind.padEnd(18)} ${entry.completeness.padEnd(8)} ${entry.digest.slice(0, 12)} ${entry.sourceId}`,
    );
  }
  if (page.unavailableCount > 0) {
    write(`(${String(page.unavailableCount)} record(s) skipped: bytes unavailable)`);
  }
  if (page.nextCursor !== null) {
    write(`next: threadline history --project ${invocation.projectId ?? ''} --cursor ${page.nextCursor}`);
  } else {
    write('end of history');
  }
  return EXIT_OK;
}

function guessMediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.ts')) return 'text/javascript';
  return 'application/octet-stream';
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h`;
}

function readCliVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { version?: unknown }).version === 'string') {
      return (parsed as { version: string }).version;
    }
  } catch {
    // A bundled build may not carry package.json next to the output.
  }
  return '0.0.0';
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ThreadlineError) {
      process.stderr.write(`threadline: ${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`threadline: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = EXIT_FAILURE;
  });
