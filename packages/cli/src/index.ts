#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  type CorrectMemoryInput,
  type MemoryKind,
  type ProposeMemoryInput,
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
import {
  DEFAULT_OPERATION_WAIT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  HELP_TEXT,
  MAX_INPUT_DOCUMENT_BYTES,
  UsageError,
  parseCliArgs,
  type CliInvocation,
} from './options.js';
import {
  createMemorySurface,
  isInFlight,
  isInFlightState,
  waitForOperation,
  type MemorySurface,
} from './memory-surface.js';
import { startStdioMcpServer, verifyProjectBinding } from './mcp/server.js';
import { classifyPreviewTargets, renderCodexMcpPreview } from './codex/mcp-preview.js';
import { shellQuote } from './codex/config-preview.js';

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
/** The operation exists but has no durable outcome yet. */
const EXIT_PENDING = 3;

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const writeJson = (value: unknown): void => {
  write(JSON.stringify(value, null, 2));
};

/** Diagnostics never share a stream with machine-readable or protocol output. */
const note = (line: string): void => {
  process.stderr.write(`${line}\n`);
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
    case 'mcp':
      return runMcp(invocation);
    case 'codex:preview':
      return runCodexPreview(invocation);
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
      return runMemoryCommand(client, invocation);
  }
}

/**
 * The human memory/task surface.
 *
 * Every command here is one typed call into the same core implementation the
 * read-only MCP server uses, so the CLI and the server cannot drift on a route,
 * a bound or a validator. Human mutations use the service's own human
 * authorization; the CLI adds no authority of its own.
 */
async function runMemoryCommand(client: ApiClient, invocation: CliInvocation): Promise<number> {
  const surface = createMemorySurface(client);
  const projectId = invocation.projectId ?? '';

  switch (invocation.command) {
    case 'task:create': {
      const result = await surface.createTask({
        projectId,
        title: invocation.title ?? '',
        ...(invocation.family === null ? {} : { taskFamily: invocation.family }),
        idempotencyKey: invocation.idempotencyKey ?? '',
      });
      return reportOperation(surface, invocation, { ...result, versionId: null }, 'task.create', projectId);
    }
    case 'task:inspect': {
      const view = await surface.inspectTask(projectId, invocation.sourceId ?? '');
      if (invocation.json) {
        writeJson(view);
        return EXIT_OK;
      }
      write(`Task ${view.taskId} (${view.state}${view.taskFamily === null ? '' : `, family ${view.taskFamily}`})`);
      write(`  title: ${view.title}`);
      write(`  revision: ${view.revision}`);
      write(`  required memories: ${view.requiredMemoryIds.length === 0 ? '(none)' : view.requiredMemoryIds.join(', ')}`);
      note('The revision is an opaque equality guard. Pass it to task:require as --expect-revision.');
      return EXIT_OK;
    }
    case 'task:requirements': {
      const view = await surface.inspectTaskRequirements(projectId, invocation.sourceId ?? '');
      if (invocation.json) {
        writeJson(view);
        return EXIT_OK;
      }
      write(`Requirements for task ${view.taskId} (revision ${view.revision})`);
      if (view.requirements.length === 0) {
        write('  (no requirement is bound to this task)');
      }
      for (const requirement of view.requirements) {
        if (requirement.state === 'current' && requirement.current !== null) {
          write(
            `  current   ${requirement.memoryId}  ${requirement.current.content.kind}: ${describeContent(requirement.current.content)}`,
          );
          write(`           accepted version ${requirement.current.versionId}; sources ${requirement.current.sourceIds.join(', ')}`);
        } else if (requirement.state === 'missing_current') {
          write(`  UNBOUND   ${requirement.memoryId}  no accepted version governs this requirement yet`);
        } else {
          write(`  CONFLICT  ${requirement.memoryId}  more than one current version; authority is ambiguous`);
        }
      }
      note('missing_current means a proposal exists but no human has accepted it, so it governs nothing.');
      return EXIT_OK;
    }
    case 'task:require': {
      const result = await surface.bindTaskRequirement({
        projectId,
        taskId: invocation.sourceId ?? '',
        memoryId: invocation.memoryId ?? '',
        expectedTaskRevision: invocation.expectedTaskRevision ?? '',
        idempotencyKey: invocation.idempotencyKey ?? '',
      });
      return reportOperation(surface, invocation, { ...result, versionId: null }, 'task.require', projectId);
    }
    case 'memory:propose': {
      const document = readInputDocument<ProposeMemoryInput>(invocation.input);
      const result = await surface.proposeMemory(document);
      return reportOperation(
        surface,
        invocation,
        { ...result },
        'memory.propose',
        requireDocumentProject(document),
      );
    }
    case 'memory:accept': {
      const result = await surface.acceptMemory({
        projectId,
        memoryId: invocation.sourceId ?? '',
        versionId: invocation.versionId ?? '',
        expectedCurrentVersionId:
          invocation.expectCurrentVersionId === 'none'
            ? null
            : invocation.expectCurrentVersionId,
        ...(invocation.reason === null ? {} : { reason: invocation.reason }),
        idempotencyKey: invocation.idempotencyKey ?? '',
      });
      return reportOperation(surface, invocation, { ...result }, 'memory:accept', projectId);
    }
    case 'memory:correct': {
      const document = readInputDocument<CorrectMemoryInput>(invocation.input);
      const result = await surface.correctMemory(document);
      return reportOperation(
        surface,
        invocation,
        { ...result },
        'memory:correct',
        requireDocumentProject(document),
      );
    }
    case 'memory:inspect': {
      const view = await surface.inspectMemory(projectId, invocation.sourceId ?? '');
      if (invocation.json) {
        writeJson(view);
        return EXIT_OK;
      }
      write(`Memory ${view.memoryId} (${view.kind})`);
      if (view.current === null) {
        write('  CURRENT: none — nothing is authoritative for this memory yet.');
      } else {
        write(`  CURRENT version ${view.current.versionId} (${view.current.acceptance})`);
        write(`    ${describeContent(view.current.content)}`);
        write(`    sources: ${view.current.sourceIds.join(', ')}`);
        if (view.current.supersedesVersionId !== null) {
          write(`    supersedes: ${view.current.supersedesVersionId}`);
        }
        if (view.current.acceptedByPrincipalId !== null) {
          write(`    accepted by human principal: ${view.current.acceptedByPrincipalId}`);
        }
      }
      if (view.candidates.length === 0) {
        write('  candidates: none');
      } else {
        write(`  candidates (${String(view.candidates.length)}): proposed, not authoritative`);
        for (const candidate of view.candidates) {
          write(`    ${candidate.versionId}  ${describeContent(candidate.content)}`);
        }
      }
      return EXIT_OK;
    }
    case 'memory:query': {
      if (invocation.kind !== null && !(MEMORY_QUERY_KINDS as readonly string[]).includes(invocation.kind)) {
        throw new UsageError(`--kind must be one of: ${MEMORY_QUERY_KINDS.join(', ')}.`);
      }
      const result = await surface.queryMemory({
        projectId,
        limit: invocation.limit === null ? 20 : Math.min(invocation.limit, 50),
        ...(invocation.taskId === null ? {} : { taskId: invocation.taskId }),
        ...(invocation.kind === null ? {} : { kind: invocation.kind as MemoryKind }),
        ...(invocation.focus === null ? {} : { focus: invocation.focus }),
      });
      if (invocation.json) {
        writeJson(result);
        return EXIT_OK;
      }
      write(`Current memory in project ${projectId}: ${String(result.memories.length)} shown`);
      for (const view of result.memories) {
        const head =
          view.current === null ? 'no accepted version' : `v ${view.current.versionId} ${describeContent(view.current.content)}`;
        write(`  ${view.memoryId}  ${view.kind.padEnd(10)} ${head}`);
      }
      if (result.memories.length === 0) {
        write('  (nothing accepted yet — proposals do not appear as current memory)');
      }
      note(result.hasMore ? 'hasMore: the bounded scan stopped early; raise --limit or narrow --focus.' : 'This set is complete for the query.');
      return EXIT_OK;
    }
    case 'operation:inspect': {
      const view = await surface.inspectOperation(projectId, invocation.sourceId ?? '');
      if (invocation.json) {
        writeJson(view);
        return operationExit(view.state);
      }
      write(`Operation ${view.operationId} (${view.kind})`);
      write(`  state: ${view.state}${view.errorCode === null ? '' : ` — ${view.errorCode}`}`);
      write(`  attempts: ${String(view.attempts)}   settled: ${view.settledAtMs === null ? 'no' : new Date(view.settledAtMs).toISOString()}`);
      if (view.receipt !== null) {
        write(`  receipt: event ${view.receipt.eventSeq} in graph epoch ${view.receipt.graphEpoch} (${view.receipt.outcome})`);
      }
      if (isInFlight(view)) {
        note('The operation has no durable outcome yet. Run this command again, or retry with --wait.');
      }
      return operationExit(view.state);
    }
    default:
      write(HELP_TEXT);
      return EXIT_USAGE;
  }
}

const MEMORY_QUERY_KINDS = ['semantic', 'episodic', 'procedural', 'handoff'] as const;

/** The common shape of every mutation result this CLI reports. */
interface OperationReport {
  readonly operationId: string;
  readonly state: string;
  readonly memoryId: string | null;
  readonly versionId: string | null;
  readonly errorCode: string | null;
}

/** The project a content-bearing input document named, for the `--wait` follow-up. */
function requireDocumentProject(document: Record<string, unknown>): string {
  const projectId = document['projectId'];
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new UsageError('The input document must name the project it targets.');
  }
  return projectId;
}

/** A one-line rendering of any memory content kind. */
function describeContent(content: { readonly kind: string } & Record<string, unknown>): string {
  if (content['kind'] === 'semantic') {
    return `${String(content['subtype'])}: ${String(content['statement'])}`;
  }
  return `${String(content['kind'])} version`;
}

function operationExit(state: string): number {
  if (state === 'committed') {
    return EXIT_OK;
  }
  if (state === 'pending' || state === 'leased' || state === 'ambiguous') {
    return EXIT_PENDING;
  }
  return EXIT_FAILURE;
}

/**
 * Reads one bounded JSON input document.
 *
 * `-` reads standard input. The byte ceiling applies before parsing, so an
 * oversized document is refused rather than buffered.
 */
function readInputDocument<T>(input: string | null): T {
  if (input === null) {
    throw new UsageError('--input is required.');
  }
  let bytes: Buffer;
  if (input === '-') {
    try {
      const buffer = Buffer.alloc(MAX_INPUT_DOCUMENT_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const count = readSync(0, buffer, total, Math.min(64 * 1024, buffer.length - total), null);
        if (count === 0) {
          break;
        }
        total += count;
      }
      bytes = buffer.subarray(0, total);
    } catch {
      throw new UsageError('Standard input could not be read for --input.');
    }
  } else {
    const path = resolve(input);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw new UsageError(`--input file could not be read: ${path}`);
    }
    if (size > MAX_INPUT_DOCUMENT_BYTES) {
      throw new UsageError(`--input must be at most ${String(MAX_INPUT_DOCUMENT_BYTES)} bytes.`);
    }
    try {
      bytes = readFileSync(path);
    } catch {
      throw new UsageError(`--input file could not be read: ${path}`);
    }
  }
  if (bytes.byteLength > MAX_INPUT_DOCUMENT_BYTES) {
    throw new UsageError(`--input must be at most ${String(MAX_INPUT_DOCUMENT_BYTES)} bytes.`);
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch {
    throw new UsageError('--input is not valid JSON.');
  }
}

/**
 * Follows a mutation to a settled state and reports one machine-readable result.
 *
 * The JSON body is always the shared operation result; the settled state is
 * reported by the exit status and, with --wait, by the operation receipt shown
 * in human mode. A pending outcome is never printed as a success.
 */
async function reportOperation(
  surface: MemorySurface,
  invocation: CliInvocation,
  result: OperationReport,
  headline: string,
  waitProjectId: string,
): Promise<number> {
  let settled = result;
  let exit = operationExit(result.state);

  if (invocation.wait) {
    const view = await waitForOperation(surface, result.operationId, {
      projectId: waitProjectId,
      timeoutMs: invocation.waitTimeoutMs ?? DEFAULT_OPERATION_WAIT_MS,
    });
    settled = { ...result, state: view.state, errorCode: view.errorCode };
    exit = operationExit(view.state);
    if (invocation.json) {
      writeJson({ ...result, state: view.state, errorCode: view.errorCode, receipt: view.receipt });
    } else if (view.receipt !== null) {
      note(`graph receipt: event ${view.receipt.eventSeq} in epoch ${view.receipt.graphEpoch} (${view.receipt.outcome})`);
    }
  } else if (invocation.json) {
    writeJson(result);
  }

  if (!invocation.json) {
    const subject =
      result.versionId === null ? result.operationId : `${result.operationId} → version ${result.versionId}`;
    write(`${headline} ${subject}: ${settled.state}${settled.errorCode === null ? '' : ` (${settled.errorCode})`}`);
    if (isInFlightState(settled.state)) {
      note('The operation has no durable outcome yet. Re-run with --wait, or inspect it with operation:inspect.');
    }
    if (settled.state === 'committed' && headline === 'memory.propose') {
      note('A proposal is not authoritative. A human must run memory:accept before it governs anything.');
    }
  }

  return exit;
}

/**
 * The project-bound, read-only stdio MCP server.
 *
 * The binding is resolved before the transport starts: the configured
 * credential must be able to see the configured project, or the process exits
 * rather than answering every later call with an authorization failure.
 */
async function runMcp(invocation: CliInvocation): Promise<number> {
  const home = resolveHomeDirectory(invocation.home);
  const config = loadServiceConfig(home).config;
  const paths = installationPaths(home);
  const token = readServerCredential(invocation, paths.credentialFile);
  const host = config.host === '::1' ? '[::1]' : config.host;
  const client = createApiClient({
    baseUrl: `http://${host}:${String(config.port)}`,
    token,
    timeoutMs: invocation.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  const projectId = invocation.projectId ?? '';
  const binding = await verifyProjectBinding(client, projectId);
  note(
    `threadline mcp: project ${binding.projectId} (role ${binding.role}) at ${client.baseUrl}; ` +
      'read-only surface, no native session identity is asserted',
  );

  const server = await startStdioMcpServer({
    client,
    projectId: binding.projectId,
    threadlineHome: home,
    requestTimeoutMs: invocation.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    ...(invocation.concurrency === null ? {} : { maxConcurrentRequests: invocation.concurrency }),
    logger: note,
  });
  await server.finished;
  return EXIT_OK;
}

/**
 * Resolves the MCP credential.
 *
 * The local owner credential is used when no file is named. A reader credential
 * is preferred wherever one exists: `--token-file` (or THREADLINE_MCP_TOKEN_FILE)
 * names a file containing only the token. This build has no command that issues
 * a non-owner grant, so that path is documented as a limitation rather than
 * implemented here. The token never appears in argv, output or diagnostics.
 */
function readServerCredential(invocation: CliInvocation, credentialFile: string): string | null {
  const explicit = invocation.tokenFile ?? process.env['THREADLINE_MCP_TOKEN_FILE'] ?? null;
  if (explicit !== null) {
    let raw: string;
    try {
      raw = readFileSync(explicit, 'utf8');
    } catch {
      throw new UsageError(`The credential file could not be read: ${explicit}`);
    }
    const token = raw.trim();
    if (token.length === 0) {
      throw new UsageError(`The credential file is empty: ${explicit}`);
    }
    return token;
  }
  return readCredentialFile(credentialFile)?.token ?? null;
}

/**
 * Renders the Codex profile that starts `mcp`.
 *
 * The command writes nothing: it prints the exact file bytes a human would
 * install, their digests, the ownership classification of anything already at
 * those paths, and the command a reviewer can run by hand. No credential is
 * rendered — the server reads it from the Threadline home at startup.
 */
function runCodexPreview(invocation: CliInvocation): Promise<number> {
  const home = resolveHomeDirectory(invocation.home);
  const preview = renderCodexMcpPreview({
    codexHome: invocation.codexHome ?? defaultCodexHome(),
    executable: invocation.executable ?? process.execPath,
    entryScript: invocation.entryScript ?? fileURLToPath(new URL('./index.js', import.meta.url)),
    threadlineHome: home,
    projectId: invocation.projectId ?? '',
  });

  const existing = new Map<string, string>();
  for (const file of preview.files) {
    try {
      existing.set(file.path, readFileSync(file.path, 'utf8'));
    } catch {
      // Absent is a normal, installable state; checkPreviewOwnership reports it.
    }
  }
  const ownership = classifyPreviewTargets(preview, existing);
  const commandLine = [preview.serverCommand.executable, ...preview.serverCommand.args]
    .map((part) => shellQuote(part))
    .join(' ');

  if (invocation.json) {
    writeJson({
      mode: preview.mode,
      profileName: preview.profileName,
      mcpServerId: preview.mcpServerId,
      serverCommand: preview.serverCommand,
      serverCommandLine: commandLine,
      files: preview.files.map((file) => ({ path: file.path, role: file.role, digest: file.digest })),
      ownership,
      notes: preview.notes,
    });
    return Promise.resolve(EXIT_OK);
  }

  write(`Codex configuration preview (${preview.mode}) — nothing is written.`);
  write(`  Select with: codex --profile ${preview.profileName}`);
  write(`  Threadline home: ${home}`);
  for (const file of preview.files) {
    write('');
    write(`--- ${file.role}: ${file.path}`);
    write(`    digest ${file.digest}`);
    process.stdout.write(file.content);
  }
  write('');
  write('Ownership of anything already at those paths:');
  for (const entry of ownership) {
    write(`  ${entry.role.padEnd(8)} ${entry.state.padEnd(8)} ${entry.detail}`);
  }
  write('');
  write('Run the server by hand:');
  write(`  ${commandLine}`);
  write('');
  for (const line of preview.notes) {
    write(`  - ${line}`);
  }
  return Promise.resolve(EXIT_OK);
}

/** The Codex home a preview targets; it is only read, never written. */
function defaultCodexHome(): string {
  const configured = process.env['CODEX_HOME'];
  return configured !== undefined && configured.length > 0 ? configured : resolve(homedir(), '.codex');
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
    process.stderr.write(`threadline: ${describeFailure(error)}\n`);
    process.exitCode = error instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE;
  });

/**
 * A safe one-line description of a failure.
 *
 * The shared error payload's details are primitives by contract, so a bounded
 * field path can be shown: "which field of your document was wrong" is the
 * difference between a usable refusal and a guess. Nothing else is echoed, so a
 * credential or a submitted body can never reach a diagnostic.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof ThreadlineError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const head = `${error.code}: ${error.message}`;
  const details = error.details;
  if (details === undefined || Object.keys(details).length === 0) {
    return head;
  }
  const rendered = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value).slice(0, 80)}`)
    .join(' ');
  return `${head} (${rendered})`;
}
