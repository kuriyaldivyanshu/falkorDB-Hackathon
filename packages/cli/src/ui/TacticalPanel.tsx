import { Box, Text } from 'ink';

import type { CheckpointFreshness, CheckpointResult, TacticalStateView } from '@threadline/shared';

import {
  PLAN_STATUS_COLOR,
  formatCheckpointResult,
  formatFreshness,
  formatPlan,
  planIsComplete,
} from './tactical-format.js';

/**
 * Checkpoint and tactical state panel.
 *
 * Renders backend truth and nothing else. It cannot advance a revision, mark a
 * task complete, or clear a conflict; a stale or blocked state stays visible
 * until the backend says otherwise. A completed plan is labelled as a completed
 * checklist, because that is the only thing the milestone established.
 */

const FRESHNESS_COLOR: Record<CheckpointFreshness, string> = {
  ready: 'green',
  stale: 'yellow',
  blocked: 'red',
  capture_pending: 'yellow',
};

export interface TacticalPanelProps {
  readonly view: TacticalStateView | null;
  /** The most recent submission result, rendered beneath the state. */
  readonly lastResult?: CheckpointResult | null;
  readonly busy?: boolean;
  readonly error?: string | null;
}

export function TacticalPanel({ view, lastResult = null, busy = false, error = null }: TacticalPanelProps) {
  if (view === null && lastResult === null && error === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Checkpoint</Text>
        <Text dimColor>No checkpoint state has been requested yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{busy ? 'Checkpoint (loading)' : 'Checkpoint'}</Text>

      {error !== null && <Text color="red">{`unavailable: ${error}`}</Text>}

      {view !== null && (
        <Box flexDirection="column">
          <Text color={FRESHNESS_COLOR[view.freshness]}>{formatFreshness(view.freshness)[0]}</Text>
          {view.criticalCapturePending && <Text color="yellow">Critical capture is awaiting graph admission; dependent inference is blocked.</Text>}
          {!!view.unavailableSourceIds?.length && <Text color="red">{`Blocker: ${view.unavailableSourceIds.length} required Source(s) are unavailable.`}</Text>}
          {view.episodes.slice(-3).map(episode=><Text key={`${episode.session_id}:${episode.capture_seq}`}>
            {`Observed ${episode.tool_name}: ${episode.observed_outcome} — Source ${episode.source_id}`}
          </Text>)}
          {view.recoveryOverflow && <Text color="red">Recovery tail exceeds the bounded scan; reconciliation is required.</Text>}
          {view.pendingReplacement && <Text color="yellow">{`Replacement ${view.pendingReplacement.revision}: ${view.pendingReplacement.publicationState}; previous checkpoint retained.`}</Text>}
          {view.awaitingRunBinding && <Text dimColor>awaiting a run binding; nothing can be published yet</Text>}
          {view.pointer === null
            ? <Text dimColor>no checkpoint accepted yet</Text>
            : (
              <Box flexDirection="column">
                <Text>{`revision ${view.pointer.checkpointRevision}  Source ${view.pointer.checkpointSourceId}`}</Text>
                {view.pointer.manifestArtifactId
                  ? <Text dimColor>{`manifest ${view.pointer.manifestArtifactId}`}</Text>
                  : null}
              </Box>
            )}
          {view.manifest !== null && <Text>{`Progress: ${view.manifest.progress || 'No narrative progress recorded.'}`}</Text>}
          {view.manifest !== null && <Text>{`Next action: ${view.manifest.next_action || 'Not specified.'}`}</Text>}
          {!!view.manifest?.unresolved_effects.length && <Text color="yellow">{`Blocker: ${view.manifest.unresolved_effects.length} unresolved effect(s) require reconciliation.`}</Text>}
          {view.pendingCoverage.length > 0 && (
            <Text dimColor>{`pending coverage: ${view.pendingCoverage.length} position(s) not covered`}</Text>
          )}
          {view.blockingGap !== null && view.blockingGap !== undefined && (
            <Text color="red">{`BLOCKING GAP session ${view.blockingGap.sessionId} ${view.blockingGap.fromSeq}..${view.blockingGap.toSeq}`}</Text>
          )}
        </Box>
      )}

      {view !== null && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Plan</Text>
          {formatPlan(view.manifest?.tactical_plan ?? []).map((line, position) => (
            <Text key={position} >
              {line}
            </Text>
          ))}
          {planIsComplete(view.manifest?.tactical_plan ?? []) && (
            <Text dimColor>every step is completed; this is a checklist, not verified task completion.</Text>
          )}
        </Box>
      )}

      {lastResult !== null && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Last submission</Text>
          {formatCheckpointResult(lastResult).map((line, position) => (
            <Text key={position} dimColor={position > 0} color={lastResult.state === 'rejected' && position === 0 ? 'red' : undefined}>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export { PLAN_STATUS_COLOR };