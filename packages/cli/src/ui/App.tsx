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
import { CommandBar } from './CommandBar.js';
import { ConnectionStatus } from './ConnectionStatus.js';

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
}

export function App({ client, endpoint, authenticated, sessionIssuedAt, providerClient }: AppProps) {
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

  const streamRef = useRef<EventStreamHandle | null>(null);
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
        Read-only model runs use the CLI. Use /connect for provider setup; other text sends development echo.
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
