import type { ProviderClient } from '../transport/provider-client.js';
import { ProviderSetup } from './ProviderSetup.js';
import { Box, Text, useApp, useInput } from 'ink';
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
import { formatDevelopmentEchoResult, formatErrorPayload, formatEvent, formatHealth } from './format.js';
import { ActivityLog } from './ActivityLog.js';
import { CapturePanel } from './CapturePanel.js';
import { reduceCursorError, reduceReplayPage, type ReplayStatus } from './capture-state.js';
import { CommandBar } from './CommandBar.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { inspectSourceView, readSourceRange, replayPage, type SourceClientDeps, type SourceInspectionView } from '../transport/source-client.js';

/** Bounded reconnection, then a visible manual retry. */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_000;
/** Inspected Sources kept on screen. Older entries fall off rather than growing. */
const MAX_SOURCE_VIEWS = 8;

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
}

export function App({ client, endpoint, authenticated, sessionIssuedAt, providerClient, sourceClient }: AppProps) {
  const { exit } = useApp();
  const [connection, setConnection] = useState<ConnectionView>({
    status: 'connecting',
    attempt: 0,
    detail: '',
  });
  const [authority,setAuthority] = useState<AuthorityView | null>(null);
  const [authorityError,setAuthorityError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [activity, dispatch] = useReducer(activityReducer, { entries: [], dropped: 0 });
  const [input, setInput] = useState('');
  const [providerSetup, setProviderSetup] = useState(false);
  const [runState, setRunState] = useState<string | null>(null);
  const [sourceViews, setSourceViews] = useState<readonly { sourceId: string; view: SourceInspectionView }[]>([]);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus | null>(null);
  const [sourceRange, setSourceRange] = useState<Awaited<ReturnType<typeof readSourceRange>> | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);

  const streamRef = useRef<EventStreamHandle | null>(null);
  const historyRef = useRef<{ close(): void } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const scheduleReconnectRef = useRef<(reason: string) => void>(() => {});
  const alive = useRef(true);

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

  const submit = useCallback(() => {
    const text = input.trim();
    setInput('');
    if (text.length === 0) {
      record('warn', 'client', 'ignored an empty command');
      return;
    }
    if (text === '/connect') {
      if (providerClient) setProviderSetup(true);
      else record('error', 'client', 'Provider setup requires a loopback backend.');
      return;
    }
    // Source inspection and durable replay. Both read the backend's answer and
    // render it as given; neither retries, resumes, or infers state.
    if (text.startsWith('/source ')) {
      const [sourceId='', offset, maxBytes] = text.slice('/source '.length).trim().split(/\s+/);
      if (sourceId.length === 0) { record('warn', 'client', 'usage: /source <source-id>'); return; }
      const projectId = authority?.projectId;
      if (!sourceClient) { record('error', 'client', 'Source inspection is not available in this client build.'); return; }
      if (projectId === undefined) { record('error', 'client', 'A project with accepted authority is required before inspecting a Source.'); return; }
      setCaptureBusy(true);
      void (async () => {
        try {
          const view = await inspectSourceView(sourceClient, projectId, sourceId);
          if (offset !== undefined) {
            const range=await readSourceRange(sourceClient,projectId,sourceId,Number(offset),Number(maxBytes ?? '256'));
            if (alive.current) setSourceRange(range);
          } else if (alive.current) setSourceRange(null);
          if (!alive.current) return;
          setSourceViews((previous) => [{ sourceId, view }, ...previous].slice(0, MAX_SOURCE_VIEWS));
          record('info', 'backend', `source ${sourceId} ${view.state}`);
        } catch (error) {
          if (!alive.current) return;
          record('error', 'backend', `source ${sourceId} unavailable: ${describeCause(error)}`);
        } finally {
          if (alive.current) setCaptureBusy(false);
        }
      })();
      return;
    }
    if (text.startsWith('/replay ')) {
      const parts = text.slice('/replay '.length).trim().split(/\s+/);
      const [epoch, afterSeq] = parts;
      const projectId = authority?.projectId;
      if (!sourceClient) { record('error', 'client', 'Durable replay is not available in this client build.'); return; }
      if (epoch === undefined) { record('warn', 'client', 'usage: /replay <graph-epoch-uuid> [after-seq]'); return; }
      if (projectId === undefined) { record('error', 'client', 'A project with accepted authority is required before replaying history.'); return; }
      setCaptureBusy(true);
      historyRef.current?.close();
      if (sourceClient.follow) {
        historyRef.current=sourceClient.follow(projectId,{graphEpoch:epoch,afterSeq:Number(afterSeq ?? '0')},{
          frame(frame) {
            if (!alive.current) return;
            record('info','backend',`history seq=${frame.seq} kind=${frame.kind} source=${String(frame.payload['sourceId'] ?? '')}`);
            setReplayStatus({kind:'catching_up',cursor:{graphEpoch:frame.graphEpoch,afterSeq:frame.seq},hasMore:true});
          },
          status(page) { if (alive.current) { setReplayStatus(reduceReplayPage(page)); setCaptureBusy(false); } },
          error(error) { if (alive.current) { setReplayStatus(reduceCursorError(error)); setCaptureBusy(false); } },
        });
      } else {
        void replayPage(sourceClient,projectId,{graphEpoch:epoch,afterSeq:Number(afterSeq ?? '0')})
          .then(page => { if (alive.current) setReplayStatus(reduceReplayPage(page)); })
          .catch(error => { if (alive.current) setReplayStatus(reduceCursorError(error)); })
          .finally(() => { if (alive.current) setCaptureBusy(false); });
      }
      return;
    }
    record('info', 'client', `sending development.echo: "${toSingleLine(text, 80)}"`);
    void (async () => {
      try {
        const response = await client.sendCommand('development.echo', { text });
        if (!alive.current) {
          return;
        }
        if (response.ok) {
          record('info', 'backend', `${response.commandId} ${formatDevelopmentEchoResult(response.result)}`);
        } else {
          const id = response.commandId ?? '(rejected before an id existed)';
          record('error', 'backend', `${id} rejected: ${formatErrorPayload(response.error)}`);
        }
      } catch (error) {
        if (alive.current) {
          record('error', 'client', `command failed: ${describeCause(error)}`);
        }
      }
    })();
  }, [client, input, record, providerClient]);

  useInput((inputKey, key) => {
    if (providerSetup) return;
    if (key.escape || (key.ctrl && inputKey === 'c')) {
      closeStream();
      exit();
      return;
    }
    // Only meaningful while no text field can receive it.
    if (connection.status === 'disconnected' && (inputKey === 'r' || inputKey === 'R')) {
      reconnectAttempts.current = 0;
      connect();
    }
  });

  if (providerSetup && providerClient) return <ProviderSetup client={providerClient} onClose={() => setProviderSetup(false)} />;

  const canSend = connection.status === 'connected';

  return (
    <Box flexDirection="column">
      <Text bold>Threadline — terminal interface</Text>
      <Text dimColor>
        {'Read-only model runs use the CLI. Use /connect for provider setup, /source <id> to inspect captured evidence, /replay <epoch> [after-seq] for durable history; other text sends development echo.'}
      </Text>
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
      {(sourceViews.length > 0 || replayStatus !== null) && <Box flexDirection="column" marginBottom={1}>
        <CapturePanel
          evidence={[]}
          sources={sourceViews.map(({ sourceId, view }) => ({ sourceId, inspection: view }))}
          range={sourceRange}
          replay={replayStatus}
          busy={captureBusy}
        />
      </Box>}
      <Box flexDirection="column">
        <ActivityLog entries={activity.entries} limit={MAX_ACTIVITY_ENTRIES} dropped={activity.dropped} />
      </Box>
      <Box marginY={1} flexDirection="column">
        <CommandBar
          value={input}
          onChange={setInput}
          onSubmit={submit}
          disabled={!canSend}
          placeholder="text to echo (development-only)"
        />
      </Box>
      <Text dimColor>Esc or Ctrl+C to disconnect; backend and data remain. Use CLI admit/inspect for durable actions.</Text>
    </Box>
  );
}
