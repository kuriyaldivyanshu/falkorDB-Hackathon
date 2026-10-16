import { EXIT_FAILURE, EXIT_OK, type LineSink } from '../one-shot.js';
import { describeCause } from '../transport/errors.js';
import type { BackendClient } from '../transport/backend-client.js';
import type { RunClient } from '../transport/run-client.js';
import type { SourceClientDeps } from '../transport/source-client.js';
import type { CliInvocation } from '../options.js';
import type { CheckpointRoutes, TacticalHttp } from '../transport/checkpoint-http.js';
import type { ProvisioningHttp } from '../transport/provisioning-http.js';
import { HUMAN_INPUT_MAX_CHARS } from '@threadline/shared';
import { provisioningRecordLabel, resolveProvisioningOperationId } from '../admission/provisioning-record.js';

import {
  historyReplayCommand,
  sourceInspectCommand,
  sourceReadCommand,
} from './source-commands.js';
import { runCancelCommand, runInspectCommand, runPrepareCommand, runStartCommand } from './run-commands.js';

import type { HandlerContext } from '../commands/catalog.js';

/**
 * Terminal handlers for the existing backend operations (M05B09/B10).
 *
 * Two rules run through all of them.
 *
 * - **HTTP success is not completion.** A Source inspect answers 200 with a
 *   typed state, and a checkpoint route answers a rejection with an
 *   authoritative result. Success is decided from the typed answer, never from
 *   the status line.
 * - **Reuse, do not reimplement.** Where the CLI already has a typed command for
 *   an operation, the terminal calls that same function with the same argument
 *   validation, so the two surfaces cannot drift into disagreeing about what a
 *   pending or conflicting outcome means.
 *
 * The terminal resolves scope from its own authenticated authority rather than
 * from invocation flags, because the flags describe a CLI run and the authority
 * describes this session.
 */

/** Adapts a handler context to the line sink the typed CLI commands take. */
export const sinkOf = (context: HandlerContext): LineSink => context.write;

/**
 * Merges the terminal's own authority over the CLI invocation, then overlays the
 * positional arguments the operator typed. Only fields the underlying commands
 * read are touched; everything else keeps its parsed value.
 */
function scopeFor(base: CliInvocation, context: HandlerContext, projectId: string | null, taskId: string | null): CliInvocation {
  // `argv` holds only the arguments the parser accepted, so index 0 is always
  // the first positional. Offsets are decimal strings validated by the parser and
  // are never rounded through a float.
  const args = context.argv;
  const decimal = (value: string | undefined, fallback: number | null): number | null =>
    value === undefined || !/^(0|[1-9][0-9]*)$/.test(value) ? fallback : Number(value);
  return {
    ...base,
    projectId,
    checkpointTaskId: taskId ?? base.checkpointTaskId,
    sourceId: args[0] ?? base.sourceId,
    sourceOffset: decimal(args[1], base.sourceOffset),
    sourceMaxBytes: decimal(args[2], base.sourceMaxBytes),
    replayEpoch: args[0] ?? base.replayEpoch,
    replayAfterSeq: decimal(args[1], base.replayAfterSeq),
    replayLimit: decimal(args[2], base.replayLimit),
    runId: args[0] ?? base.runId,
  } as CliInvocation;
}

export async function statusTerminal(context: HandlerContext, client: BackendClient): Promise<number> {
  try {
    const health = await client.health();
    context.write(`backend ${health.state} · protocol ${health.protocolVersion} · version ${health.backendVersion}`);
    for (const component of health.components) {
      context.write(`  ${component.name}: ${component.ready ? 'ready' : component.present ? 'present but not ready' : 'absent'}${component.detail.length === 0 ? '' : ` (${component.detail})`}`);
    }
    if (health.state !== 'ready') {
      context.write('The backend is reachable but not ready; nothing below is claimed as available.');
      return EXIT_FAILURE;
    }
    return EXIT_OK;
  } catch (error) {
    context.write(`status failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

export async function sessionTerminal(context: HandlerContext, client: BackendClient): Promise<number> {
  try {
    const principal = await client.principal();
    if(context.argv[0]&&context.argv[0]!==principal.sessionId){context.write('That is not the attached human session. Use /run inspect for an agent session; the session picker arrives in M07.');return EXIT_FAILURE;}
    context.write(`session ${principal.sessionId}`);
    context.write(`  user     ${principal.userId}`);
    context.write(`  tenant   ${principal.tenantId}`);
    context.write(`  projects ${principal.projects.map((project) => project.projectId).join(', ') || 'none'}`);
    // The credential is never read here and therefore can never be rendered.
    context.write('  the credential itself is never displayed.');
    return EXIT_OK;
  } catch (error) {
    context.write(`session failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * `/task` — the accepted goal, its versions and its Source links.
 *
 * A missing project or task is a typed refusal, never an empty inspection.
 */
export async function taskTerminal(
  context: HandlerContext,
  client: BackendClient,
  projectId: string | null,
): Promise<number> {
  if (projectId === null) {
    context.write('No admitted task yet. /init then /admit first; this command inspects, it does not admit.');
    return EXIT_FAILURE;
  }
  try {
    const authority = await client.authority(projectId);
    if(context.argv[0]&&context.argv[0]!==authority.taskId){context.write('That is not the currently selected accepted task.');return EXIT_FAILURE;}
    context.write(`task ${authority.taskId} status=${authority.taskStatus} revision=${authority.taskRevision}`);
    context.write(`  goal revision ${authority.goalRevision} (version ${authority.goalVersionId})`);
    context.write(`  graph epoch ${authority.graphEpoch}`);
    context.write(`  goal: ${authority.goalText.slice(0, 400)}${authority.goalText.length > 400 ? ' … (the CLI shows the full source)' : ''}`);
    for (const constraint of authority.constraints) context.write(`  constraint ${constraint.field} = ${constraint.value} @${constraint.revision}`);
    for (const criterion of authority.criteria) context.write(`  required ${criterion.required} ${criterion.ref}`);
    context.write(`  sources: ${authority.sourceMessageIds.join(', ') || 'none'}`);
    return EXIT_OK;
  } catch (error) {
    context.write(`task failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * `/run prepare|start|inspect|cancel`.
 *
 * `prepare` needs an explicit context window. The terminal never supplies a
 * default, because a guessed token budget changes what the model sees.
 */
export async function runTerminal(
  context: HandlerContext,
  client: RunClient,
  base: CliInvocation,
  projectId: string | null,
  taskId: string | null,
): Promise<number> {
  const sub = context.subcommand ?? '';
  const scope = scopeFor(base, context, projectId, taskId);
  try {
    if (sub === 'prepare') {
      return await runPrepareCommand(client, { ...scope, contextWindowTokens: explicitWindow(context) }, sinkOf(context));
    }
    if (sub === 'start') return await runStartCommand(client, scope, sinkOf(context));
    if (sub === 'inspect') return await runInspectCommand(client, scope, sinkOf(context));
    if (sub === 'cancel') return await runCancelCommand(client, scope, sinkOf(context));
    context.write('usage: /run <prepare|start|inspect|cancel> [run-id]');
    context.write('  prepare takes an explicit context window; it is never assumed.');
    return EXIT_FAILURE;
  } catch (error) {
    context.write(`run failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * Reads the context window the operator typed, or null.
 *
 * Null is passed through so the typed command produces its own refusal message
 * rather than this layer inventing a budget.
 */
function explicitWindow(context: HandlerContext): number | null {
  // The parser consumed the sub-command, so the window is the first argument.
  const raw = context.argv[0];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * `/source <source-id> [offset] [max-bytes]`.
 *
 * Without an offset this inspects; with one it reads a bounded authorized
 * range. A range is never implied by an inspection, and the typed state decides
 * success rather than the HTTP status.
 */
export async function sourceTerminal(
  context: HandlerContext,
  client: SourceClientDeps,
  base: CliInvocation,
  projectId: string | null,
  taskId: string | null,
): Promise<number> {
  const scope = scopeFor(base, context, projectId, taskId);
  try {
    return scope.sourceOffset === null || scope.sourceOffset === undefined
      ? await sourceInspectCommand(client, scope, sinkOf(context))
      : await sourceReadCommand(client, scope, sinkOf(context));
  } catch (error) {
    context.write(`source failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/** `/history` and `/replay` — a gap stays visible, never a successful empty page. */
export async function historyTerminal(
  context: HandlerContext,
  client: SourceClientDeps,
  base: CliInvocation,
  projectId: string | null,
  taskId: string | null,
): Promise<number> {
  const scope = scopeFor(base, context, projectId, taskId);
  try {
    // Naming an epoch in the terminal means "replay from the start of it", so the
    // cursor is the canonical zero rather than a value the operator has to know
    // the CLI's flag spelling for. The CLI itself still requires both.
    if (scope.replayEpoch !== null && scope.replayAfterSeq === null) {
      return await historyReplayCommand(client, { ...scope, replayAfterSeq: 0 } as CliInvocation, sinkOf(context));
    }
    return await historyReplayCommand(client, scope, sinkOf(context));
  } catch (error) {
    context.write(`history failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/** `/recover` — a bounded checkpoint-tail scan that never repeats a send. */
export async function recoverTerminal(
  context: HandlerContext,
  http: TacticalHttp,
  routes: CheckpointRoutes,
): Promise<number> {
  try {
    const report = await http.recover(routes);
    context.write(`recovery ${report.state}: scanned ${report.scanned}, episodes ${report.episodes}`);
    if (report.blockedBy !== undefined && report.blockedBy !== null) {
      context.write(`  blocked by ${report.blockedBy.fromSeq}..${report.blockedBy.toSeq}: ${report.blockedBy.reason}`);
      context.write('  recovery never repeats an uncertain tool or model send.');
      return EXIT_FAILURE;
    }
    if (report.published !== null && report.published !== undefined) {
      context.write(`  published revision ${report.published.revision ?? 'pending'} source ${report.published.checkpointSourceId ?? 'not yet available'}`);
    }
    return report.state === 'blocked' ? EXIT_FAILURE : EXIT_OK;
  } catch (error) {
    context.write(`recover failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}
/**
 * `/model` — list or select the provider/model applied to future runs.
 *
 * Selection is prospective: it changes what a *prepared* run would use, and this
 * layer never claims it changed an existing one. A catalogue entry with no model
 * id is the manual fallback, so an operator whose provider publishes no
 * catalogue can still select by typing the id.
 */
export async function modelTerminal(
  context: HandlerContext,
  http: ProvisioningHttp,
  recordPath: string,
  projectId: string | null,
  onSelected?: (profileId:string,window:number,output:number,route:string)=>void,
): Promise<number> {
  if (projectId === null) {
    context.write('No project scope yet. /init then /admit first.');
    return EXIT_FAILURE;
  }
  const [selector, listFilter] = context.argv;
  try {
    if (selector === undefined || selector === 'list') {
      const result = await http.listModels(projectId, { query: listFilter ?? null, limit: 50 });
      // Discovery being unavailable is stated, not hidden: a manual id remains
      // the path, so an empty catalogue is a fact rather than a dead end.
      if (result.discoveryNote !== undefined && result.discoveryNote !== null) {
        context.write(`  discovery: ${result.discoveryNote}`);
      }
      if (result.models.length === 0) {
        context.write('  no selectable models were returned.');
        context.write('  /model <provider-id>/<model-id> <context-window> <max-output> selects by hand.');
        return EXIT_FAILURE;
      }
      context.inspect?.({type:'model-list',models:result.models});
      for (const model of result.models) {
        const id = model.modelId.length === 0 ? '(manual model id)' : model.modelId;
        const window = model.contextWindowTokens === null ? 'window not declared' : `${model.contextWindowTokens} window`;
        context.write(`  ${model.providerId}/${id} — ${model.displayName} · ${window} · ${model.accountConfigured ? 'account configured' : 'no account configured'}`);
      }
      if (result.truncated) context.write(`  showing ${result.models.length} of ${result.total}; narrow the query to see the rest.`);
      context.write('Select with /model <provider-id>/<model-id> <context-window> <max-output>.');
      return EXIT_OK;
    }

    // `/model <provider>/<model> <context-window> <max-output>`
    //
    // The limits are declared by the backend, so the operator states them rather
    // than the client guessing: a guessed window changes what the model sees.
    const separator = selector.indexOf('/');
    const providerId = separator > 0 ? selector.slice(0, separator) : '';
    const modelId = separator > 0 ? selector.slice(separator + 1) : '';
    if (providerId.length === 0 || modelId.length === 0) {
      context.write('usage: /model <provider-id>/<model-id> <context-window> <max-output>');
      context.write('  Listing needs no argument; selecting needs both declared limits.');
      return EXIT_FAILURE;
    }
    // argv[1] and argv[2] follow the provider/model selector.
    const contextWindowTokens = decimalArgument(context, context.argv[1]);
    const maxOutputTokens = decimalArgument(context, context.argv[2]);
    if (contextWindowTokens === undefined || maxOutputTokens === undefined) {
      context.write('Both declared limits are required as whole numbers: /model <provider>/<model> <context-window> <max-output>.');
      context.write('  They are never assumed, because the context window decides what the model sees.');
      return EXIT_FAILURE;
    }
    const record = await resolveProvisioningOperationId(recordPath, {
      kind: 'model.select',
      projectId,
      providerId,
      modelId,
      contextWindowTokens,
      maxOutputTokens,
    });
    const result = await http.selectModel(projectId, record.operationId, { providerId, modelId, contextWindowTokens, maxOutputTokens });
    if (result.outcome === 'rejected') {
      context.write(`model selection rejected: ${describeRejection(result.rejection)}`);
      context.write(`  operation ${record.operationId} was spent on that rejection; correcting it is a new intent.`);
      context.write(`  Operation ids are kept in ${provisioningRecordLabel(recordPath)}.`);
      return EXIT_FAILURE;
    }
    if (result.outcome === 'replayed') {
      context.write(`model selection replayed for operation ${result.operationId}; no second profile was created.`);
    } else {
      context.write(`model selected ${result.providerId ?? providerId}/${result.modelId ?? modelId} for future runs.`);
    }
    if(result.profileId){onSelected?.(result.profileId,contextWindowTokens,maxOutputTokens,`${providerId}/${modelId}`);context.inspect?.({type:'profile-selected',provider:result.providerId,model:result.modelId,profileId:result.profileId});}
    context.write(`  profile ${result.profileId ?? 'unavailable'}; prepare explicitly before starting.`);
    return EXIT_OK;
  } catch (error) {
    context.write(`model failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * `/send` and plain text — durable human input.
 *
 * This is the only acceptable meaning for text typed into the interface. The
 * text is stored by the backend under a durable operation id, so a retry resumes
 * the same submission rather than posting it twice.
 */
export async function inputTerminal(
  context: HandlerContext,
  http: ProvisioningHttp,
  recordPath: string,
  projectId: string | null,
  text: string,
  kind: 'initial' | 'follow_up',
): Promise<number> {
  if (projectId === null) {
    context.write('No project scope yet, so this cannot be stored as durable input.');
    return EXIT_FAILURE;
  }
  if (text.trim().length === 0) {
    context.write('Nothing to send.');
    return EXIT_FAILURE;
  }
  if (text.length > HUMAN_INPUT_MAX_CHARS) {
    context.write(`Input is ${text.length} characters; the published limit is ${HUMAN_INPUT_MAX_CHARS}. Nothing was sent.`);
    return EXIT_FAILURE;
  }
  try {
    const record = await resolveProvisioningOperationId(recordPath, { kind: 'input.submit', projectId, inputKind: kind, text });
    const result = await http.submitInput(projectId, record.operationId, { kind, text, consent: 'none' });
    if (result.outcome === 'rejected') {
      context.write(`input rejected: ${describeRejection(result.rejection)}`);
      context.write(`  operation ${result.operationId} was spent on that rejection.`);
      return EXIT_FAILURE;
    }
    if (result.outcome === 'replayed') {
      // A replay is the durable identity working: the original submission stands
      // and nothing was recorded twice.
      context.write(`input replayed for operation ${result.operationId}; the original submission stands.`);
      return EXIT_OK;
    }
    context.write(`input recorded${result.messageId === undefined ? '' : ` as ${result.messageId}`}.`);
    context.write('  Recorded only. Review the selected provider/model, then use /run prepare and /run start confirm to authorize inference.');
    return EXIT_OK;
  } catch (error) {
    context.write(`input failed: ${describeCause(error)}`);
    return EXIT_FAILURE;
  }
}

/**
 * Reads a whole-number argument, or undefined when it is absent or malformed.
 *
 * Rejects a float outright rather than rounding it: a declared token limit that
 * is off by one changes what the model sees, so a malformed one must not become
 * a nearby valid one.
 */
function decimalArgument(context: HandlerContext, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    context.write(`  ${raw} is not a whole number.`);
    return undefined;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Renders a published rejection as what it refused and why, never as a bare failure. */
function describeRejection(rejection: unknown): string {
  if (typeof rejection !== 'object' || rejection === null) return 'no reason given';
  const entry = rejection as { kind?: unknown; providerId?: unknown; modelId?: unknown; runId?: unknown; field?: unknown; requested?: unknown; allowed?: unknown; reason?: unknown };
  switch (entry.kind) {
    case 'unknown_provider': return `unknown provider ${String(entry.providerId ?? '')}`;
    case 'unknown_model': return `unknown model ${String(entry.providerId ?? '')}/${String(entry.modelId ?? '')}`;
    case 'no_configured_account': return `no configured account for ${String(entry.providerId ?? '')}; configure one first`;
    case 'active_run_conflict': return `an active run (${String(entry.runId ?? '')}) conflicts with this selection`;
    case 'declined_limit': return `${String(entry.field ?? 'a limit')} of ${String(entry.requested ?? '')} exceeds the allowed ${String(entry.allowed ?? '')}`;
    case 'invalid': return `${String(entry.field ?? 'a field')} is invalid: ${String(entry.reason ?? '')}`;
    default: return 'no reason given';
  }
}
