import { Box, Text } from 'ink';

import type { ActivityEntry } from './activity.js';

const LEVEL_COLOR = {
  info: undefined,
  warn: 'yellow',
  error: 'red',
} as const;

export interface ActivityLogProps {
  readonly entries: readonly ActivityEntry[];
  readonly limit: number;
  /** How many entries the bounded buffer has discarded. */
  readonly dropped: number;
}

/**
 * The newest activity, newest last.
 *
 * The buffer is bounded, so the view also states the cap and how many entries
 * it has dropped. A truncated activity list is shown as truncated rather than
 * quietly looking complete.
 */
export function ActivityLog({ entries, limit, dropped }: ActivityLogProps) {
  if (entries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Activity</Text>
        <Text dimColor>No activity yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Activity</Text>
      {dropped > 0 ? (
        <Text dimColor>
          {`showing the newest ${entries.length} of ${entries.length + dropped} (buffer limit ${limit})`}
        </Text>
      ) : (
        <Text dimColor>{`${entries.length} of at most ${limit}`}</Text>
      )}
      {entries.map((entry) => (
        <Text key={entry.id} color={LEVEL_COLOR[entry.level]}>
          <Text dimColor>{entry.at.slice(11, 19)}</Text>
          <Text dimColor>{` ${entry.source.padEnd(7)} `}</Text>
          {entry.text}
        </Text>
      ))}
    </Box>
  );
}
