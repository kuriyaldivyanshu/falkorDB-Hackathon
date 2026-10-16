import { Box, Text } from 'ink';

import {
  formatCaptureState,
  formatReplayStatus,
  formatSourceInspection,
  formatSourceRange,
  reduceCapture,
  type CaptureFact,
  type CaptureState,
  type ReplayStatus,
} from './capture-state.js';
import type { SourceInspectionView } from '../transport/source-client.js';

/**
 * Durable capture and replay panel.
 *
 * Every line is produced by the reducers in `capture-state.ts` from backend
 * facts. This component renders and nothing else: it cannot mark a capture
 * available, cannot clear a gap, and cannot turn pending evidence into a result.
 *
 * The four capture states are shown on their own lines and never merged with
 * run state or tool success, because "the tool worked" and "its evidence is
 * durable" are separate facts. A gap is rendered as a gap with its refresh
 * guidance rather than as a shorter list.
 */

const CAPTURE_COLOR: Record<CaptureState['kind'], string | undefined> = {
  available: 'green',
  partial: 'yellow',
  pending: 'yellow',
  missing: 'red',
  failed: 'red',
};

const CAPTURE_LABEL: Record<CaptureState['kind'], string> = {
  available: 'available',
  partial: 'partial',
  pending: 'pending',
  missing: 'missing',
  failed: 'failed',
};

export interface CapturePanelProps {
  /** Label plus facts for one piece of evidence, e.g. a tool result. */
  readonly evidence: readonly { readonly label: string; readonly fact: CaptureFact }[];
  readonly sources: readonly { readonly sourceId: string; readonly inspection: SourceInspectionView }[];
  readonly range?: {
    readonly sourceId: string;
    readonly offset: number;
    readonly returnedBytes: number;
    readonly totalBytes: number;
    readonly truncated: boolean;
  } | null;
  readonly replay?: ReplayStatus | null;
  readonly busy?: boolean;
}

/**
 * A Source inspection state, rendered without collapsing distinct causes.
 *
 * `denied` and `missing` stay separate lines on purpose: an operator inside the
 * scope is entitled to know the difference, and the reducer only reports either
 * when the backend stated it for this reader.
 */
function sourceLines(sourceId: string, inspection: SourceInspectionView): string[] {
  switch (inspection.state) {
    case 'available':
      return formatSourceInspection(
        sourceId,
        'available',
        `${inspection.byteSize ?? 0} bytes digest=${(inspection.contentDigest ?? '').slice(0, 12)}`,
      );
    default:
      return formatSourceInspection(sourceId, inspection.state, inspection.reason ?? 'the backend gave no further detail');
  }
}

export function CapturePanel({ evidence, sources, range = null, replay = null, busy = false }: CapturePanelProps) {
  const states = evidence.map(({ fact }) => reduceCapture(fact));
  const captureLines = evidence.flatMap(({ label }, position) =>
    formatCaptureState(label, states[position]!).map((line, index) => ({ line, index })),
  );

  if (evidence.length === 0 && sources.length === 0 && replay === null && range === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Capture</Text>
        <Text dimColor>No captured evidence has been reported yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{busy ? 'Capture (loading)' : 'Capture'}</Text>

      {evidence.length === 0 ? (
        <Text dimColor>No captured evidence reported for this session.</Text>
      ) : (
        captureLines.map(({ line, index }, position) =>
          position % 2 === 0 ? (
            <Text key={position} color={CAPTURE_COLOR[states[index]?.kind ?? 'pending']}>
              {`${CAPTURE_LABEL[states[index]?.kind ?? 'pending']}: ${line}`}
            </Text>
          ) : (
            <Text key={position} dimColor>
              {`  ${line}`}
            </Text>
          ),
        )
      )}

      {sources.map(({ sourceId, inspection }) => (
        <Box key={sourceId} flexDirection="column">
          {sourceLines(sourceId, inspection).map((line, position) =>
            position === 0 ? <Text key={position}>{line}</Text> : <Text key={position} dimColor>{`  ${line}`}</Text>,
          )}
        </Box>
      ))}

      {range !== null ? formatSourceRange(range.sourceId, range).map((line, position) => (
        <Text key={position} dimColor={position > 0}>{line}</Text>
      )) : null}

      {replay !== null ? (
        formatReplayStatus(replay).map((line, position) => (
          <Text key={position} color={position === 0 && replay.kind === 'gap' ? 'red' : undefined} dimColor={position > 0}>
            {line}
          </Text>
        ))
      ) : null}
    </Box>
  );
}
