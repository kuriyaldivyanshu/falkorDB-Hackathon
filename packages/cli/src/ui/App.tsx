import type {ContextInspectResult,SelectableModel,SetupProvider} from '@threadline/shared';
import type { ProviderClient } from '../transport/provider-client.js';
import { ProviderSetup } from './ProviderSetup.js';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { AuthorityView, HealthReport } from '@threadline/shared';

import type { BackendClient, EventStreamHandle } from '../transport/backend-client.js';
import { describeCause } from '../transport/errors.js';
import {
  MAX_ACTIVITY_ENTRIES,
  appendActivity,
  toSingleLine,
  type ActivityEntry,
  type ActivityLevel,
  type ConnectionView,
} from './activity.js';
import { formatEvent, formatHealth } from './format.js';
/** Used only when no command surface is composed, so completion resolves empty. */
const EMPTY_REGISTRY = new CommandRegistry([]);

const NARROW_FALLBACK = 80;

/** Reads the provider route from the health report, or null when it is absent. */
function readProviderRoute(health: HealthReport | null): string | null {
  if (health === null) return null;
  const value = (health as unknown as Record<string, unknown>)['provider'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Narrow shape check for an inspector payload; never trusts the catalog. */
function isTacticalStateView(payload: unknown): payload is TacticalStateView {
  if (typeof payload !== 'object' || payload === null) return false;
  const value = payload as { freshness?: unknown; pendingCoverage?: unknown; episodes?: unknown };
  return typeof value.freshness === 'string' && Array.isArray(value.pendingCoverage) && Array.isArray(value.episodes);
}

import { ActivityLog } from './ActivityLog.js';
import { TacticalPanel } from './TacticalPanel.js';
import { CommandPicker, INITIAL_PICKER, TerminalHeader, moveSelection, resolveSuggestions, type PickerState } from './CommandPicker.js';
import type { TerminalCommands } from '../commands/dispatch.js';
import type { CapabilityClient } from '../transport/capability-client.js';
import { CommandRegistry } from '../commands/registry.js';
import {checkpointRoutes, type CheckpointRoutes, type TacticalHttp} from '../transport/checkpoint-http.js';
import type { TacticalStateView } from '@threadline/shared';
import { CommandBar } from './CommandBar.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import type { SourceClientDeps } from '../transport/source-client.js';

/** Bounded reconnection, then a visible manual retry. */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_000;

interface ActivityState {
  readonly entries: readonly ActivityEntry[];
  readonly dropped: number;
}

type ActivityAction = {
  readonly level: ActivityLevel;
  readonly source: ActivityEntry['source'];
  readonly text: string;
};

function activityReducer(state: ActivityState, action: ActivityAction): ActivityState {
  const entry: ActivityEntry = {
    id: nextEntryId(),
    at: new Date().toISOString(),
    level: action.level,
    source: action.source,
    text: action.text,
  };
  const entries = appendActivity(state.entries, entry);
  return { entries, dropped: state.dropped + (entries.length < state.entries.length + 1 ? 1 : 0) };
}

let entrySequence = 0;
function nextEntryId(): number {
  entrySequence += 1;
  return entrySequence;
}

export interface AppProps {
  readonly providerClient?: ProviderClient;
  readonly client: BackendClient;
  readonly endpoint: string;
  /** Whether a local owner session is attached. The token is never shown. */
  readonly authenticated: boolean;
  /** When the attached session was issued, or null when there is no session. */
  readonly sessionIssuedAt: string | null;
  /**
   * Source inspection and replay transport. Optional so a build without the
   * route registered reports that the capability is unavailable instead of
   * showing an empty panel that looks like "nothing was captured".
   */
  readonly sourceClient?: SourceClientDeps;
  /**
   * Checkpoint transport and its routes. Both are optional: until Agent A
   * registers the routes nothing is reachable, and the panel says so rather than
   * showing an empty checkpoint that reads as "nothing recorded".
   */
  readonly tacticalClient?: TacticalHttp;
  readonly tacticalRoutes?: CheckpointRoutes;
  /**
   * Registry-driven command surface. Absent means the client is running without
   * commands, which the interface states rather than falling back to echo.
   */
  readonly commands?: TerminalCommands;
  /** Capability report source; availability follows the backend, not the catalogue. */
  readonly capability?: CapabilityClient | null;
  /** Backend client used to read capability and authority state. */
  readonly backend?: BackendClient;
}

export function App(props: AppProps) {
  const { client, endpoint, authenticated, sessionIssuedAt, providerClient } = props;
  const { sourceClient: _sourceClient, tacticalClient: _tacticalClient } = props;
  const commands: TerminalCommands | undefined = props.commands;
  const capability: CapabilityClient | null | undefined = props.capability;
  const { exit } = useApp();
  const [connection, setConnection] = useState<ConnectionView>({
    status: 'connecting',
    attempt: 0,
    detail: '',
  });
  const [authority,setAuthority] = useState<AuthorityView | null>(null);
  const [modelChoices,setModelChoices]=useState<readonly SelectableModel[]|null>(null);
  const [modelChoiceIndex,setModelChoiceIndex]=useState(0);
  const [profileView,setProfileView]=useState<{provider:string;model:string}|null>(null);
  const [selectedRun,setSelectedRun]=useState<string|null>(null);
  const [contextView,setContextView]=useState<ContextInspectResult|null>(null);
  const [selectedProject,setSelectedProject]=useState<string|null>(null);
  const [authorityError,setAuthorityError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [activity, dispatch] = useReducer(activityReducer, { entries: [], dropped: 0 });
  const [input, setInput] = useState('');
  const [editorGeneration,setEditorGeneration]=useState(0);
  const [providerSetup, setProviderSetup] = useState(false);
  const [setupProvider,setSetupProvider]=useState<SetupProvider|undefined>(undefined);
  const [runState, setRunState] = useState<string | null>(null);
  const [tacticalView, setTacticalView] = useState<TacticalStateView | null>(null);
  const [tacticalError, setTacticalError] = useState<string | null>(null);
  const [tacticalBusy, setTacticalBusy] = useState(false);
  const [picker, setPicker] = useState<PickerState>(INITIAL_PICKER);
  const [busyCommand, setBusyCommand] = useState(false);
  const [form,setForm]=useState<{command:string;labels:string[];values:string[];baseRevision?:string;taskId?:string}|null>(null);
  const [capabilityRevision,setCapabilityRevision]=useState(0);
  const [capabilitySummary, setCapabilitySummary] = useState<string | null>(null);
  // Ink's useStdout exposes the raw stream; columns are absent on a pipe, which
  // is the conservative case for deciding to stack the header.
  const {stdout} = useStdout();
  const stdoutColumns = (stdout as NodeJS.WriteStream).columns ?? NARROW_FALLBACK;

  const streamRef = useRef<EventStreamHandle | null>(null);
  const historyRef = useRef<{ close(): void } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const scheduleReconnectRef = useRef<(reason: string) => void>(() => {});
  const alive = useRef(true);
  /**
   * The draft a refusal put back in the input.
   *
   * Ink appends to the existing value, so without this the next keystroke would
   * concatenate onto a restored refusal and turn it into a different, malformed
   * command. The first edit after a restore replaces the draft instead.
   */
  const restoredDraft = useRef<string | null>(null);

  const record = useCallback(
    (level: ActivityLevel, source: ActivityEntry['source'], text: string) => {
      dispatch({ level, source, text: toSingleLine(text) });
    },
    [],
  );

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const connect = useCallback(() => {
    record('info', 'client', `connecting to ${endpoint}`);
    setConnection({ status: 'connecting', attempt: reconnectAttempts.current, detail: '' });

    void (async () => {
      let report: HealthReport;
      try {
        report = await client.health();
      } catch (error) {
        if (!alive.current) {
          return;
        }
        const detail = describeCause(error);
        record('error', 'client', `health check failed: ${detail}`);
        if (reconnectAttempts.current > 0) {
          scheduleReconnectRef.current(`health check failed: ${detail}`);
          return;
        }
        setConnection({
          status: 'disconnected',
          attempt: reconnectAttempts.current,
          detail: `${detail} — press r to retry`,
        });
        return;
      }

      if (!alive.current) {
        return;
      }
      setHealth(report);
      record('info', 'backend', formatHealth(report));

      const stream = client.openEventStream({
        onEvent: (event) => {
          if (!alive.current) {
            return;
          }
          record('info', 'backend', formatEvent(event));
          // Run and attempt deltas also drive the header, so the current run is
          // visible without opening a separate screen.
          if (event.name === 'run.activity') {
            setRunState(`run ${event.payload.runId} ${event.payload.kind} ${event.payload.state}`);
          }
          if (event.name === 'run.state' || event.name === 'run.attempt') {
            setRunState(
              `run ${event.payload.runId} state=${event.payload.state} ` +
                `session=${event.payload.sessionState} detail="${event.payload.detail}"`,
            );
          }
        },
        onFrameError: (error) => {
          if (alive.current) {
            record('warn', 'client', `event stream frame ignored: ${error.message}`);
          }
        },
        onError: (error) => {
          if (alive.current) {
            record('error', 'client', `event stream: ${error.message}`);
          }
        },
        onEnd: (reason) => {
          if (alive.current && reason !== 'closed-by-client') {
            scheduleReconnect(reason);
          }
        },
      });

      if (!alive.current) {
        stream.close();
        return;
      }
      streamRef.current = stream;
      if (!(await stream.ready) || !alive.current || streamRef.current !== stream) return;
      reconnectAttempts.current = 0;
      setConnection({ status: 'connected', attempt: 0, detail: '' });
      record('info', 'client', 'event stream open');
      setAuthority(null); setAuthorityError(null);
      if (client.authenticated) {
        try {
          const principal=await client.principal();
          if(principal.projects.length !== 1) throw new Error('Use CLI inspect --project to select a project.');
          const project=principal.projects[0];
          if(project) {
            if(alive.current)setSelectedProject(project.projectId);
            const view=await client.authority(project.projectId);
            if(alive.current && streamRef.current===stream) setAuthority(view);
          }
        } catch(error) {if(alive.current && streamRef.current===stream) setAuthorityError(describeCause(error));}
      }
    })();
  }, [client, endpoint, record]);

  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (!alive.current) {
        return;
      }
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnection({
          status: 'disconnected',
          attempt: reconnectAttempts.current,
          detail: `stream ${reason}; no attempt left — press r to retry`,
        });
        record('error', 'client', `event stream ${reason}; not retrying again`);
        return;
      }
      reconnectAttempts.current += 1;
      const attempt = reconnectAttempts.current;
      setConnection({
        status: 'reconnecting',
        attempt,
        detail: `stream ${reason}; retrying in ${RECONNECT_DELAY_MS}ms`,
      });
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, RECONNECT_DELAY_MS);
    },
    [connect, record],
  );
  scheduleReconnectRef.current = scheduleReconnect;

  /**
   * Loads the backend capability report.
   *
   * Availability in this interface follows this report, not the published
   * catalogue. The cache is invalidated on connect and whenever authority moves,
   * because those are the observations the report is derived from.
   */
  useEffect(() => {
    if (connection.status !== 'connected' || capability == null) return;
    let cancelled = false;
    void (async () => {
      setCapabilitySummary('capability: availability unknown — loading report');
      try {
        const report = await capability!.report({ projectId: authority?.projectId ?? selectedProject, force: true });
        if (cancelled || !alive.current) return;
        const usable = report.operations.filter((operation) => operation.available).length;
        const blocked = report.operations.filter((operation) => !operation.available).length;
        setCapabilitySummary(
          `capability: ${usable} available · ${blocked} unavailable · project ${report.projectId === null ? 'none' : report.projectId.slice(0, 8)} · task ${report.observations.hasAdmittedTask ? 'admitted' : 'none'} · profile ${report.observations.hasConfiguredProfile ? 'configured' : 'none'}`,
        );
      } catch {
        if (!cancelled && alive.current) setCapabilitySummary('capability: availability unknown — report unavailable; commands remain guarded');
      }
    })();
    return () => { cancelled = true; };
  }, [connection.status, authority?.projectId, capability,capabilityRevision,selectedProject]);

  useEffect(() => {
    alive.current = true;
    connect();
    return () => {
      alive.current = false;
      historyRef.current?.close();
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      closeStream();
    };
  }, [closeStream, connect]);

  /**
   * Input entry point.
   *
   * Everything goes through the command registry dispatcher. There is no
   * development-echo fallback here any more: an unknown slash command is a local
   * usage error, and plain text with no durable input operation refuses visibly
   * and keeps the draft, because silently echoing it would make unknown input
   * look like successful agent work.
   */
  const submit = useCallback(() => {
    let raw = input;
    if(modelChoices){
      const choices=modelChoices.filter(m=>`${m.providerId}/${m.modelId} ${m.displayName}`.toLowerCase().includes(input.toLowerCase()));
      const selected=choices[Math.min(modelChoiceIndex,Math.max(0,choices.length-1))];
      if(!selected){record('warn','client','No configured model matches; Esc cancels, /model choose accepts a manual ID.');return;}
      setModelChoices(null);setInput(selected.modelId?'':selected.providerId+'/');setEditorGeneration(n=>n+1);
      setForm({command:'model',labels:['Provider/model','Declared context window','Maximum output tokens'],values:selected.modelId?[selected.providerId+'/'+selected.modelId]:[]});return;
    }
    if(form){
      if(!raw.trim()){record('warn','client','A form value is required; Esc cancels.');return;}
      const values=[...form.values,raw];setInput('');
      if(values.length<form.labels.length){setForm({...form,values});return;}
      if(form.taskId&&authority?.taskId!==form.taskId){record('warn','client','Task changed while editing; reopen the form.');setForm(null);return;}
      raw=`/${form.command} ${values.map(value=>JSON.stringify(value)).join(' ')}${form.baseRevision?' '+form.baseRevision:''}`;setForm(null);
    }else{
      const command=raw.trim();
      const labels=command==='/checkpoint'?['Progress','Next action']:command==='/plan'?['Step ID','Status: pending / in_progress / completed','Step text']:command==='/model choose'?['Provider/model','Declared context window','Maximum output tokens']:null;
      if(labels){
        setInput('');setPicker(INITIAL_PICKER);
        if((command==='/checkpoint'||command==='/plan')&&props.tacticalClient&&authority){
          setBusyCommand(true);
          void props.tacticalClient.readState(checkpointRoutes(authority.projectId,authority.taskId)).then(state=>{
            if(alive.current)setForm({command:command.slice(1),labels,values:[],baseRevision:state.pointer?.checkpointRevision??'0',taskId:authority.taskId});
          }).catch(error=>record('error','client',describeCause(error))).finally(()=>setBusyCommand(false));
        }else setForm({command:command==='/model choose'?'model':command.slice(1),labels,values:[]});
        return;
      }
    }
    setInput('');
    if (raw.trim().length === 0) {
      record('warn', 'client', 'ignored an empty command');
      return;
    }

    // Provider setup keeps its dedicated modal; it is a masked form, not a command.
    const connectMatch=/^\/(?:connect|provider)(?:\s+(openai|anthropic|openrouter|opencode-go))?$/.exec(raw.trim());
    if (connectMatch && providerClient) {
      setPicker(INITIAL_PICKER);setSetupProvider(connectMatch[1] as SetupProvider|undefined);setProviderSetup(true);
      return;
    }

    setPicker(INITIAL_PICKER);
    setBusyCommand(true);
    void (async () => {
      let requestedExit = false;
      try {
        const result = await commands!.dispatch({
          text: raw,
          capabilityFor:id=>connection.status==='connected'?capability?.entry(id)??null:null,
          argv: raw.trim().split(/\s+/).slice(1),
          write: (line) => record(line.trim().startsWith('unavailable') ? 'warn' : 'info', 'backend', line),
          // Scope comes from this session's own authenticated authority, so a
          // handler never inherits flags that described a different run. It is
          // re-read per command because authority can move mid-session.
          scope: authority === null
            ? { projectId:selectedProject, taskId: null }
            : { projectId: authority.projectId, taskId: authority.taskId },
          // A handler that already has a structured view hands it here, so the
          // inspector renders backend truth without the catalog holding state.
          inspect: (payload) => {
            if(payload&&typeof payload==='object'&&'type' in payload){
              const view=payload as Record<string,unknown>;
              if(view.type==='model-list'&&Array.isArray(view.models)){setModelChoices(view.models as SelectableModel[]);setModelChoiceIndex(0);setInput('');}
              if(view.type==='profile-selected'&&typeof view.provider==='string'&&typeof view.model==='string')setProfileView({provider:view.provider,model:view.model});
              if(view.type==='run-selected'&&typeof view.runId==='string')setSelectedRun(view.runId);
              if(view.type==='context-view'&&view.view&&typeof view.view==='object'&&'packet' in view.view)setContextView(view.view as ContextInspectResult);
            }

            if (isTacticalStateView(payload)) {
              setTacticalView(payload);
              setTacticalError(null);
              setTacticalBusy(false);
            }
          },
        });
        if (!alive.current) return;
        requestedExit = result.exitRequested;
        setCapabilityRevision(n=>n+1);
        if(result.code===0&&['admit','init','task'].includes(result.commandName??'')){
          const principal=await client.principal();const project=principal.projects[0];
          if(project){setSelectedProject(project.projectId);try{setAuthority(await client.authority(project.projectId));setAuthorityError(null);}catch{/* A preview does not admit a task. */}}
        }
        if (result.kind === 'usage-error' || result.kind === 'unknown') {
          // The dispatcher's own lines are already recorded; this marks the input
          // itself so a refusal is attributable to what was typed.
          record('warn', 'client', `refused: ${raw.trim()}`);
          return;
        }
        // A refused command keeps the draft so the operator can correct it
        // rather than retype a long argument list.
        if (result.code !== 0 && !result.exitRequested) {
          setInput(raw);
          restoredDraft.current = raw;
        }
      } catch (error) {
        if (!alive.current) return;
        record('error', 'client', `command failed: ${describeCause(error)}`);
        setInput(raw);
        restoredDraft.current = raw;
      } finally {
        if (alive.current) setBusyCommand(false);
        if (requestedExit) exit();
      }
    })();
  }, [input, commands, providerClient, record, exit, authority,form,props.tacticalClient,client,selectedProject,modelChoices,modelChoiceIndex,capability,connection.status]);

  const suggestions = resolveSuggestions(commands?.registry ?? EMPTY_REGISTRY, picker.query, capability ?? null);

  useInput((inputKey, key) => {
    if (providerSetup) return;

    // Esc closes an open picker first. Detaching is a separate, explicit action,
    // so losing a typed draft to a stray Esc cannot happen.
    if (key.escape) {
      if(modelChoices){setModelChoices(null);setInput('');return;}
      if(form){setForm(null);setInput('');return;}
      if (picker.open) { setPicker(INITIAL_PICKER); return; }
      closeStream();
      exit();
      return;
    }
    if (key.ctrl && inputKey === 'c') {
      if(modelChoices){setModelChoices(null);setInput('');return;}
      if(form){setForm(null);setInput('');return;}
      // Ctrl-C cancels a draft when there is one, then detaches when idle.
      if (input.length > 0) { setInput(''); record('info', 'client', 'draft discarded'); return; }
      closeStream();
      exit();
      return;
    }
    if(modelChoices&&(key.upArrow||key.downArrow)){const count=modelChoices.filter(m=>`${m.providerId}/${m.modelId} ${m.displayName}`.toLowerCase().includes(input.toLowerCase())).length;setModelChoiceIndex(i=>Math.max(0,Math.min(count-1,i+(key.upArrow?-1:1))));return;}
    if (picker.open && (key.upArrow || key.downArrow)) {
      setPicker(moveSelection(picker, key.upArrow ? -1 : 1, suggestions.length));
      return;
    }
    if (picker.open && key.tab) {
      // Tab accepts the highlighted name into the input line without running
      // anything, so a long argument list can be finished deliberately. With
      // nothing highlighted it leaves the draft alone.
      const highlighted = suggestions[picker.index];
      if (highlighted !== undefined) {
        setInput(`${highlighted.name} `);
        setPicker(INITIAL_PICKER);
      }
      return;
    }
    // Reconnection shortcuts only apply while no overlay can receive the key.
    if (!picker.open && connection.status === 'disconnected' && (inputKey === 'r' || inputKey === 'R')) {
      reconnectAttempts.current = 0;
      connect();
    }
  });

  if (providerSetup && providerClient) return <ProviderSetup client={providerClient} initialProvider={setupProvider} onClose={() => setProviderSetup(false)} />;

  const canSend = !busyCommand; // Local help remains usable while the backend reconnects.

  return (
    <Box flexDirection="column">
      <TerminalHeader
        connection={connection.status}
        endpoint={endpoint}
        projectId={authority?.projectId ?? selectedProject}
        taskId={authority?.taskId ?? null}
        // Provider route and model come from the backend's own report; the
        // header shows "none" rather than guessing them from configuration.
        provider={profileView?.provider??readProviderRoute(health)}
        model={profileView?.model??null}
        runId={selectedRun}
        runState={runState}
        authenticated={authenticated}
        width={stdoutColumns}
      />
      <Text dimColor>
        {'Type / for commands, /help for the list, /hotkeys for keys. Plain text is recorded as durable human input.'}
      </Text>
      {capabilitySummary !== null && <Text dimColor>{capabilitySummary}</Text>}
      <Box marginY={1} flexDirection="column">
        <ConnectionStatus
          endpoint={endpoint}
          connection={connection}
          health={health}
          authenticated={authenticated}
          sessionIssuedAt={sessionIssuedAt}
          runLine={runState}
        />
      </Box>
      {connection.status === 'connected' && authority !== null && <Box flexDirection="column" marginBottom={1}>
        <Text bold>Task {authority.taskId} — {authority.taskStatus} / revision {authority.taskRevision}</Text>
        <Text>{authority.goalText.slice(0,800)}{authority.goalText.length > 800 ? ' … (CLI inspect shows full source)' : ''}</Text>
        {authority.constraints.map(c=><Text key={c.constraintId}>{c.field} = {c.value} / revision {c.revision}</Text>)}
        {authority.criteria.map(c=><Text key={c.criterionId}>Required={String(c.required)}: {c.ref}</Text>)}
        <Text dimColor>Source: {authority.sourceMessageIds.join(', ')}</Text>
      </Box>}
      {connection.status === 'connected' && authorityError !== null && <Text color="yellow">Authority unavailable: {authorityError}</Text>}
      {contextView&&<Box flexDirection="column" marginBottom={1}>
        <Text bold>Context {contextView.packet?.packetId??'not staged'} — occurrence {contextView.currentOccurrenceId??'not submitted'}</Text>
        {contextView.packet&&<Text>Task {contextView.packet.taskRevision}; requirements {contextView.packet.requirementRevision}; {contextView.packet.totalEstimatedTokens} tokens ({contextView.packet.totalTokenPrecision})</Text>}
        {contextView.budget&&<Text>Submitted input {contextView.budget.inputTokensEstimate}; output reserve {contextView.budget.reservedOutputTokens}; total {contextView.budget.totalTokens}/{contextView.budget.limitTokens} ({contextView.budget.precision})</Text>}
        {contextView.packet?.items.slice(0,16).map((item,index)=><Text key={index}>{item.priority} {item.kind}: {item.inclusionReason} Sources: {item.bindings.map(b=>b.sourceId).join(', ')}</Text>)}
        {contextView.omissions.slice(0,8).map((item,index)=><Text key={index}>Omitted {item.count} {item.kind}: {item.reason}</Text>)}
      </Box>}
      {(tacticalView !== null || tacticalError !== null) && <Box flexDirection="column" marginBottom={1}>

        <TacticalPanel view={tacticalView} busy={tacticalBusy} error={tacticalError} />
      </Box>}
      <Box flexDirection="column">
        <ActivityLog entries={activity.entries} limit={MAX_ACTIVITY_ENTRIES} dropped={activity.dropped} />
      </Box>
      {modelChoices&&<Box flexDirection="column"><Text bold>Choose a configured model/provider — type to filter, arrows select, Enter opens declared limits, Esc cancels</Text>
        {modelChoices.filter(m=>`${m.providerId}/${m.modelId} ${m.displayName}`.toLowerCase().includes(input.toLowerCase())).slice(0,8).map((m,index)=><Text key={m.providerId+':'+m.modelId}>{index===modelChoiceIndex?'> ':'  '}{m.providerId}/{m.modelId||'(manual model ID)'} — {m.accountConfigured?'configured':'connect this provider first'}</Text>)}
      </Box>}
      {picker.open && <Box marginY={1} flexDirection="column"><CommandPicker state={picker} suggestions={suggestions} busy={busyCommand} availabilityUnknown={capability?.loaded !== true} /></Box>}
      <Box marginY={1} flexDirection="column">
        {form&&<Text>/{form.command} — {form.labels[form.values.length]} {form.baseRevision?`(base ${form.baseRevision})`:null} (Esc cancels)</Text>}
        <CommandBar
          key={editorGeneration}
          value={input}
          onChange={(nextRaw) => {
            // The first edit after a refusal replaces the restored draft rather
            // than extending it, so a retried command is never a concatenation.
            const draft = restoredDraft.current;
            const next = draft !== null && nextRaw.length>draft.length && nextRaw.endsWith(draft)
              ? nextRaw.slice(0,-draft.length)
              : draft !== null && nextRaw.startsWith(draft)
                ? nextRaw.slice(draft.length)
                : nextRaw;
            if (draft !== null) {restoredDraft.current = null;setEditorGeneration(n=>n+1);}
            setInput(next);
            if(modelChoices)setModelChoiceIndex(0);
            // A leading slash opens the picker and narrows it as the user types.
            if (!form&&!modelChoices&&next.startsWith('/')) {
              const query = next.slice(1).split(/\s+/, 1)[0] ?? '';
              setPicker({ open: true, query, index: 0 });
            } else if (picker.open) {
              setPicker(INITIAL_PICKER);
            }
          }}
          onSubmit={() => {
            // Enter always submits what was typed, whether or not the picker has
            // a suggestion. Completion is Tab's job: every highlighted suggestion
            // trivially starts with the query, so any prefix rule here would
            // swallow the submit and silently rewrite `/checkpoint` into whichever
            // alias happened to be highlighted. With nothing to suggest, the
            // dispatcher's unknown-command answer is still the honest outcome, so
            // an empty picker never stands in for one.
            submit();
          }}
          disabled={!canSend || commands === undefined}
          disabledReason={commands === undefined
            ? 'This build was mounted without a command surface, so nothing can be sent.'
            : connection.status !== 'connected'
              ? 'Not connected — no command can be sent.'
              : undefined}
          placeholder={form?(form.labels[form.values.length]??'Form value'):commands === undefined ? 'commands are not available in this build' : 'command or text…  (/ for commands)'}
          hint={commands === undefined
            ? undefined
            : 'Enter runs the command. Plain text is recorded as durable human input.'}
        />
      </Box>
      <Text dimColor>Esc closes an open picker, then disconnects; Ctrl-C discards a draft, then disconnects. The backend and its data remain.</Text>
    </Box>
  );
}
