#!/usr/bin/env node
import {loadFixtureManifest,previewFixture} from './fixture/manifest.js';
import { createHash } from 'node:crypto';
import { readCheckpointRequestRecord } from './admission/checkpoint-record.js';
import type { StartRunInput } from '@threadline/shared';
import { createContextHttp } from './transport/context-http.js';
import { resolve } from 'node:path';
import { runDurableCommand } from './durable-commands.js';
import { runFixturePreview } from './fixture-command.js';
import { HELP_TEXT, UsageError, parseCliArgs, type CliInvocation } from './options.js';
import { EXIT_FAILURE, EXIT_OK, runEcho, runHealth } from './one-shot.js';
import { createBackendClient } from './transport/backend-client.js';
import { createSourceClient } from './transport/source-client.js';
import { historyReplayCommand, sourceInspectCommand, sourceReadCommand } from './ui/source-commands.js';
import {
  checkpointInspectCommand,
  checkpointWriteCommand,
  planUpdateCommand,
} from './ui/checkpoint-commands.js';
import { checkpointRoutes, createTacticalHttp } from './transport/checkpoint-http.js';
import { createCapabilityClient } from './transport/capability-client.js';
import { createProvisioningHttp } from './transport/provisioning-http.js';
import { createTerminalCommands } from './commands/dispatch.js';
import { historyTerminal, inputTerminal, modelTerminal, recoverTerminal, sessionTerminal, sourceTerminal, statusTerminal, taskTerminal } from './ui/terminal-commands.js';
import { readLocalSessionCredential } from './credentials/local-session.js';
import { describeCause } from './transport/errors.js';
import { createRunClient } from './transport/run-client.js';
import {
  runCancelCommand,
  runInspectCommand,
  runPrepareCommand,
  runStartCommand,
} from './ui/run-commands.js';
import { createProviderClient } from './transport/provider-client.js';
import { startProviderSetup } from './provider-setup.js';
import { startTui } from './tui.js';

/**
 * Process entry point.
 *
 * Owns argument parsing, dispatch, and the exit code. It contains no protocol
 * knowledge and no view state; the transport client and the interface are
 * started from here and nothing else.
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(argv: readonly string[]): Promise<number> {
  let invocation: CliInvocation;
  try {
    invocation = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP_TEXT}\n`);
      return EXIT_FAILURE;
    }
    throw error;
  }

  if (invocation.help) {
    write(HELP_TEXT);
    return EXIT_OK;
  }

  if (invocation.command === 'fixture') {
    return runFixturePreview(invocation.fixtureManifestPath, write);
  }

  // Loaded before the client so a credential problem is reported plainly rather
  // than as an authentication failure from the backend. A missing credential is
  // not fatal yet: the M00 development surface does not require a session.
  const credential = await readLocalSessionCredential(invocation.credentialPath).catch(
    (error: unknown) => {
      process.stderr.write(`threadline: ${describeCause(error)}\n`);
      return null;
    },
  );

  const client = createBackendClient({
    baseUrl: invocation.backendUrl,
    requestTimeoutMs: invocation.requestTimeoutMs,
    token: credential?.token ?? null,
  });
  const sourceClient = (): ReturnType<typeof createSourceClient> =>
    createSourceClient({
      baseUrl: invocation.backendUrl,
      timeoutMs: invocation.requestTimeoutMs,
      token: credential?.token ?? null,
    });
  const runClient = createRunClient({
    baseUrl: invocation.backendUrl,
    requestTimeoutMs: invocation.requestTimeoutMs,
    token: credential?.token ?? null,
  });
  const checkpointHttp = () => createTacticalHttp({
    baseUrl: invocation.backendUrl,
    token: credential?.token ?? null,
    timeoutMs: invocation.requestTimeoutMs,
  });

  /**
   * The command surface the terminal mounts.
   *
   * Every handler reuses the same typed command the CLI uses for that
   * operation, so the two surfaces cannot drift in validation, retry identity or
   * the pending/conflict outcomes they report. Scope comes from the session's
   * own authority via `HandlerContext.scope`, never from invocation flags, which
   * describe a different run.
   */
  /**
   * Where durable provisioning operation ids are kept.
   *
   * Separate from the admission record because the intents are unrelated: a
   * model selection and a submitted message are not retries of each other, and
   * sharing one record would make each look like a changed payload of the other.
   */
  const provisioningRecord = (kind: 'model' | 'input'): string =>
    resolve(invocation.requestRecordPath.replace(/\.json$/, `-provisioning-${kind}.json`));
  const provisioningHttp = () => createProvisioningHttp({
    baseUrl: invocation.backendUrl,
    token: credential?.token ?? null,
    timeoutMs: invocation.requestTimeoutMs,
  });
  /** Whether this terminal session has already recorded a human message. */
  let inputSubmitted = false;
  let selectedModel:{profileId:string;window:number;output:number;route:string}|null=null;
  let preparedRun:StartRunInput|null=null;
  let selectedRunId:string|null=null;


  const terminalCommands = () => createTerminalCommands({
    status:async(c)=>{const code=await statusTerminal(c,client);c.write(`Selected ${selectedModel?.route??'none'}; profile ${selectedModel?.profileId??'none'}; run ${selectedRunId??'none'}; window ${selectedModel?.window??'unknown'}; output ${selectedModel?.output??'unknown'}`);return code;},
    session: async (c) => sessionTerminal(c, client),
    durable: async (c) => {
      // init/admit/inspect share the durable CLI path, so admission retry identity
      // is byte-identical between the terminal and the CLI. /task inspects through
      // the same client and reports the authority as the backend states it.
      if (c.commandName === 'task') return taskTerminal(c, client, c.scope?.projectId ?? null);
      if(c.commandName==='admit'&&!c.argv[0]){
        const fixture=await loadFixtureManifest(invocation.fixtureManifestPath);
        previewFixture(fixture).forEach(c.write);c.write(`Explicitly accept the displayed goal/criteria with /admit ${fixture.digest}`);return EXIT_OK;
      }
      const sub = { ...invocation, command: c.commandName === 'init' ? 'init' : c.commandName === 'admit' ? 'admit' : 'inspect', projectId: c.scope?.projectId ?? invocation.projectId,acceptedFixtureDigest:c.commandName==='admit'?c.argv[0]??null:invocation.acceptedFixtureDigest } as CliInvocation;
      return runDurableCommand(client, sub, c.write);
    },
    run: async(c)=>{
      const projectId=c.scope?.projectId??invocation.projectId;
      if(!projectId){c.write('Attach an admitted task first.');return EXIT_FAILURE;}
      if(c.subcommand==='prepare'){
        if(!selectedModel){c.write('Select /model <provider/model> <context-window> <max-output> first.');return EXIT_FAILURE;}
        preparedRun=await runClient.prepareRun(projectId,selectedModel.window,selectedModel.profileId);
        c.write(`Prepared ${selectedModel.route}; API-key billing, window ${selectedModel.window}, output ${selectedModel.output}. No inference started.`);
        c.write('Use /run start confirm to explicitly authorize this prepared run.');return EXIT_OK;
      }
      if(c.subcommand==='start'){
        if(!preparedRun||preparedRun.projectId!==projectId||!selectedModel||preparedRun.profileId!==selectedModel.profileId){c.write('Prepare the selected profile first.');return EXIT_FAILURE;}
        if(c.argv[0]!=='confirm'){c.write(`Confirm ${selectedModel.route}, API-key billing, window ${selectedModel.window}, output ${selectedModel.output}: /run start confirm`);return EXIT_FAILURE;}
        const answer=await runClient.startRun(preparedRun);
        c.write(JSON.stringify(answer));if('run' in answer){selectedRunId=answer.run.runId;c.inspect?.({type:'run-selected',runId:selectedRunId});}
        return answer.kind==='rejected'?EXIT_FAILURE:EXIT_OK;
      }
      const runId=c.argv[0]??selectedRunId;
      if(!runId){c.write('Supply a run ID; /run inspect <id> or /run cancel <id>.');return EXIT_FAILURE;}
      if(c.subcommand==='inspect'){c.write(JSON.stringify(await runClient.inspectRun(runId),null,2));return EXIT_OK;}
      if(c.subcommand==='cancel'){c.write(JSON.stringify(await runClient.cancelRun(runId,'Explicit terminal cancellation')));return EXIT_OK;}
      return EXIT_FAILURE;
    },
    source: async (c) => sourceTerminal(c, sourceClient(), invocation, c.scope?.projectId ?? null, c.scope?.taskId ?? null),
    replay: async(c)=>{
      const p=c.scope?.projectId;if(!p){c.write('An admitted project is required.');return EXIT_FAILURE;}
      if(c.commandName==='history'){
        const a=await client.authority(p);
        return historyTerminal({...c,commandName:'replay',argv:[a.graphEpoch,c.argv[0]??'0']},sourceClient(),invocation,p,a.taskId);
      }
      return historyTerminal(c,sourceClient(),invocation,p,c.scope?.taskId??null);
    },
    model: async (c) => modelTerminal(c, provisioningHttp(), provisioningRecord('model'), c.scope?.projectId ?? null,(profileId,window,output,route)=>{selectedModel={profileId,window,output,route};preparedRun=null;}),
    durableInput: async (c) => {
      // The first message in a session is the initial one; later ones are
      // follow-ups. Guessing the kind from the wording would be meaningless, and
      // claiming every message is initial would misdescribe the task.
      const kind = inputSubmitted ? 'follow_up' : 'initial';
      const code = await inputTerminal(
        c,
        provisioningHttp(),
        provisioningRecord('input'),
        c.scope?.projectId ?? null,
        c.argv.length ? c.argv.join(' ') : c.text,
        kind,
      );
      if (code === EXIT_OK) inputSubmitted = true;
      return code;
    },
    memory:async(c)=>{
      const p=c.scope?.projectId,t=c.scope?.taskId;if(!p||!t){c.write('An admitted task is required.');return EXIT_FAILURE;}
      const http=createContextHttp({baseUrl:invocation.backendUrl,token:credential?.token??null});
      if(c.commandName==='search'){
        const result=await http.search(p,t,c.argv.join(' '));
        c.write(`Search scanned ${result.scannedCandidates}/${result.limits.maxCandidates}; ${result.hits.length} hits${result.truncated?' (more available)':''}.`);
        for(const hit of result.hits)c.write(`${hit.proofStatus}: ${hit.snippet} Sources: ${hit.bindings.map(b=>b.sourceId).join(', ')}`);return EXIT_OK;
      }
      if(c.commandName==='compact'){
        const result=await http.compact(p,t);c.write(JSON.stringify(result));return result.kind==='refused'?EXIT_FAILURE:EXIT_OK;
      }
      if(c.commandName==='refresh'){
        const result=await http.refresh(p,t);c.write(`Context ${result.kind}: ${result.packetId??result.refusal?.message??'unavailable'}; staged, not provider-delivered.`);
        if(result.kind==='refused')return EXIT_FAILURE;
      }
      const result=await http.inspect(p,t);
      c.inspect?.({type:'context-view',view:result});
      if(!result.packet){c.write('No current packet; /refresh to build current context.');return EXIT_OK;}
      c.write(`Packet ${result.packet.packetId}; task revision ${result.packet.taskRevision}; requirements ${result.packet.requirementRevision}; ${result.packet.totalEstimatedTokens} tokens (${result.packet.totalTokenPrecision}). Occurrence ${result.currentOccurrenceId??'not submitted'}`);
      if(result.budget)c.write(`Exact submitted input estimate ${result.budget.inputTokensEstimate}; reserved output ${result.budget.reservedOutputTokens}; headroom ${result.budget.headroomTokens}; total ${result.budget.totalTokens}/${result.budget.limitTokens} (${result.budget.precision}).`);
      for(const item of result.packet.items)c.write(`${item.priority} ${item.kind}: ${item.inclusionReason} Sources: ${item.bindings.map(b=>b.sourceId).join(', ')}`);
      for(const o of result.omissions)c.write(`Omitted ${o.count} ${o.kind}: ${o.reason}`);
      return EXIT_OK;
    },
    checkpoint: async (c) => {
      let request = { ...invocation, projectId: c.scope?.projectId ?? invocation.projectId, checkpointTaskId: c.scope?.taskId ?? invocation.checkpointTaskId } as CliInvocation;
      if((c.commandName==='checkpoint'||c.commandName==='plan')&&request.projectId&&request.checkpointTaskId){
        const digest=createHash('sha256').update(JSON.stringify({projectId:request.projectId,taskId:request.checkpointTaskId,command:c.commandName,args:c.argv})).digest('hex');
        const path=resolve('.threadline/terminal-intents',digest+'.json');
        const previous=await readCheckpointRequestRecord(path);
        const state=previous?null:await checkpointHttp().readState(checkpointRoutes(request.projectId,request.checkpointTaskId));
        const explicitBase=c.commandName==='checkpoint'?c.argv[2]:c.argv[3];
        request={...request,checkpointRunId:previous?.input.runId??state?.manifest?.run_id??null,
          checkpointBaseRevision:previous?.input.baseRevision??explicitBase??state?.pointer?.checkpointRevision??'0',
          requestRecordPath:path,
          checkpointProgress:c.commandName==='checkpoint'?c.argv[0]??null:null,
          checkpointNextAction:c.commandName==='checkpoint'?c.argv[1]??null:null,
          checkpointSteps:c.commandName==='plan'?[`${c.argv[0]}:${c.argv[1]}=${c.argv[2]??''}`]:null};
      }
      if (c.commandName === 'checkpoint') return checkpointWriteCommand(checkpointHttp(), request, c.write);
      if (c.commandName === 'plan') return planUpdateCommand(checkpointHttp(), request, c.write);
      return checkpointInspectCommand(checkpointHttp(), request, c.write);
    },
    recover: async (c) => {
      const projectId = c.scope?.projectId ?? null;
      const taskId = c.scope?.taskId ?? null;
      if (projectId === null || taskId === null) {
        c.write('No established task scope yet. /init then /admit first; /recover needs an admitted task.');
        return EXIT_FAILURE;
      }
      return recoverTerminal(c, checkpointHttp(), checkpointRoutes(projectId, taskId));
    },
  });

  const providerClient = () => createProviderClient({ baseUrl: invocation.backendUrl, token: credential?.token ?? null });
  switch (invocation.command) {
    case 'command': {
      if(/^\/(?:help|hotkeys|quit)(?:\s|$)/.test(invocation.echoText??''))return (await terminalCommands().dispatch({text:invocation.echoText??'',argv:[],write,scope:{projectId:null,taskId:null}})).code;
      const principal=await client.principal();
      const projectId=invocation.projectId??principal.projects[0]?.projectId;
      if(!projectId)throw new Error('No authorized project exists.');
      let taskId:string|null=null;try{taskId=(await client.authority(projectId)).taskId;}catch{/* Admission commands work before a task. */}
      return (await terminalCommands().dispatch({text:invocation.echoText??'',argv:[],write,scope:{projectId,taskId}})).code;
    }
    case 'provider:list': write(JSON.stringify(await providerClient().list(), null, 2)); return EXIT_OK;
    case 'provider:setup': await startProviderSetup(providerClient()); return EXIT_OK;
    case 'init': case 'admit': case 'inspect':
      return runDurableCommand(client,invocation,write);
    case 'run:prepare':
      if (!runClient.authenticated || invocation.projectId === null || invocation.contextWindowTokens === null) {
        write('A local session, project and declared context window are required.');
        return EXIT_FAILURE;
      }
      return runPrepareCommand(runClient, invocation, write);
    case 'run:start':
      return runStartCommand(runClient, invocation, write);
    case 'run:inspect':
      return runInspectCommand(runClient, invocation, write);
    case 'run:cancel':
      return runCancelCommand(runClient, invocation, write);
    case 'tactical:inspect':
      return checkpointInspectCommand(checkpointHttp(), invocation, write);
    case 'tactical:checkpoint':
      return checkpointWriteCommand(checkpointHttp(), invocation, write);
    case 'tactical:plan':
      return planUpdateCommand(checkpointHttp(), invocation, write);
    case 'source:inspect':
      return sourceInspectCommand(sourceClient(), invocation, write);
    case 'source:read':
      return sourceReadCommand(sourceClient(), invocation, write);
    case 'history:replay':
      return historyReplayCommand(sourceClient(), invocation, write);
    case 'health':
      return runHealth(client, write, invocation.showStoreReadiness, credential?.token ?? null);
    case 'echo':
      return runEcho(client, invocation.echoText ?? '', write);
    case 'tui':
      const target = invocation.projectId !== null && invocation.checkpointTaskId !== null
        ? checkpointRoutes(invocation.projectId, invocation.checkpointTaskId)
        : undefined;
      const terminal = terminalCommands();
      await startTui({
        commands: terminal,
        capability: createCapabilityClient({ baseUrl: invocation.backendUrl, token: credential?.token ?? null, timeoutMs: invocation.requestTimeoutMs }),
        client, endpoint: client.baseUrl, credential,
        sourceClient: sourceClient(),
        // The routes are only supplied when a target is known; otherwise the
        // panel reports the capability as unavailable rather than showing an
        // empty checkpoint.
        tacticalClient: checkpointHttp(),
        tacticalRoutes: target,
        providerClient: ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(invocation.backendUrl).hostname) ? providerClient() : undefined });
      return EXIT_OK;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`threadline: ${describeCause(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  });
