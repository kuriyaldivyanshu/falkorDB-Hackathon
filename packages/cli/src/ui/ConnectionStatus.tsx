import { Box, Text } from 'ink';

import type { HealthReport } from '@threadline/shared';

import type { ConnectionView } from './activity.js';

/**
 * Connection state, shown at the top of the interface.
 *
 * The backend's own state and guarantees are printed as reported. A report
 * that says the backend is not ready, or that nothing is durable, must stay
 * visible rather than being summarised as "connected".
 */
export interface ConnectionStatusProps {
  readonly endpoint: string;
  readonly connection: ConnectionView;
  readonly health: HealthReport | null;
  /** Whether a local owner session is attached. The token is never rendered. */
  readonly authenticated: boolean;
  readonly sessionIssuedAt: string | null;
}

const STATUS_COLOR = {
  connecting: 'yellow',
  connected: 'green',
  reconnecting: 'yellow',
  disconnected: 'red',
} as const;

const STATUS_LABEL = {
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
} as const;

export function ConnectionStatus({
  endpoint,
  connection,
  health,
  authenticated,
  sessionIssuedAt,
}: ConnectionStatusProps) {
  const attempt =
    connection.attempt > 0 ? ` (attempt ${connection.attempt})` : '';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={STATUS_COLOR[connection.status]} bold>
          {STATUS_LABEL[connection.status]}
        </Text>
        <Text dimColor>{attempt} </Text>
        <Text dimColor>to </Text>
        <Text>{endpoint}</Text>
      </Text>
      {connection.detail === '' ? null : (
        <Text dimColor>{connection.detail}</Text>
      )}
      {/*
        The report is only shown while connected. After a disconnect the last
        known report would still read "state ready", which would claim a
        readiness this client can no longer observe.
      */}
      {connection.status === 'connected' && health !== null ? (
        <Text dimColor>
          backend {health.backendVersion} protocol {health.protocolVersion} state {health.state} ·{' '}
          {health.guarantees.note}
        </Text>
      ) : null}
      {/*
        Session state is stated, not assumed. An unauthenticated client is still
        a valid M00 development client, so this is information rather than an
        error; the token itself never reaches the view.
      */}
      <Text dimColor>
        session {authenticated ? 'credential attached (server validates each durable request)' : 'none (development commands only)'}
        {authenticated && sessionIssuedAt !== null
          ? ` · issued ${sessionIssuedAt.slice(0, 19).replace('T', ' ')}Z`
          : ''}
      </Text>
    </Box>
  );
}
