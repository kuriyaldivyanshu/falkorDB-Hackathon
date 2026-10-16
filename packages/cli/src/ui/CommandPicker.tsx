import { Box, Text } from 'ink';

import type { CapabilityClient, CapabilityClient as Client } from '../transport/capability-client.js';
import { unavailabilityReason } from '../transport/capability-client.js';
import type { CommandRegistry, RegisteredCommand } from '../commands/registry.js';

/**
 * The bounded command picker (M05B10).
 *
 * A list, not a framework. It opens on `/`, narrows by prefix, moves with the
 * arrows, accepts with Tab and submits deliberately with Enter. Esc closes it
 * and nothing else — it must never reach the exit action, because losing a typed
 * draft to a stray Esc is a data-loss bug, not a shortcut.
 *
 * Availability is resolved from the backend capability report, never from
 * catalogue presence. Normal completion shows only commands with a composed
 * handler and a current positive capability; `/help all` carries the broader
 * catalog and its unavailable reasons.
 */

export interface PickerState {
  readonly open: boolean;
  readonly query: string;
  readonly index: number;
}

export const INITIAL_PICKER: PickerState = { open: false, query: '', index: 0 };

/** Bounded so the picker can never grow with the catalog. */
export const MAX_PICKER_ROWS = 10;

export interface Suggestion {
  readonly command: RegisteredCommand;
  readonly name: string;
  /** Null when the operation is available or purely local. */
  readonly unavailableReason: string | null;
}

/**
 * Resolves suggestions and their availability.
 *
 * `capability === null` means the report has not loaded; suggestions are then
 * shown as unknown rather than as available, which is the honest state.
 */
export function resolveSuggestions(
  registry: CommandRegistry,
  query: string,
  capability: Client | null,
): readonly Suggestion[] {
  const names = registry.suggestNames(query, MAX_PICKER_ROWS);
  const seen = new Set<RegisteredCommand>();
  const rows: Suggestion[] = [];
  for (const name of names) {
    const command = registry.resolve(name);
    if (command === null || seen.has(command)) continue;
    seen.add(command);
    // Two independent facts must be true before a command appears in normal
    // completion: the backend offers the operation and this client has a handler.
    let unavailableReason: string | null = null;
    if (!command.composed) {
      // Kept short: a narrow terminal truncates the row, and a truncated reason
      // is indistinguishable from no reason at all.
      unavailableReason = 'no handler here';
    } else if (command.capabilityId !== null) {
      if (capability === null || !capability.loaded) {
        unavailableReason = 'availability unknown';
      } else {
      const entry = capability.entry(command.capabilityId);
      if (entry === null) unavailableReason='capabilities not loaded';
      else if (!entry.available) unavailableReason=unavailabilityReason(entry);
      if(command.name==='run'&&['run.prepare','run.inspect','run.cancel'].some(id=>capability.entry(id as 'run.prepare'|'run.inspect'|'run.cancel')?.available))unavailableReason=null;
      }
    }
    if(unavailableReason!==null)continue;
    rows.push({ command, name, unavailableReason });
  }
  return rows;
}

/** Clamps the selection, which is what makes arrow keys safe at the ends. */
export function moveSelection(state: PickerState, delta: number, rowCount: number): PickerState {
  if (!state.open || rowCount === 0) return state;
  const next = (state.index + delta + rowCount) % rowCount;
  return { ...state, index: next };
}

export interface CommandPickerProps {
  readonly state: PickerState;
  readonly suggestions: readonly Suggestion[];
  readonly busy: boolean;
  readonly availabilityUnknown?: boolean;
}

export function CommandPicker({ state, suggestions, busy, availabilityUnknown = false }: CommandPickerProps) {
  if (!state.open) return null;
  if (suggestions.length === 0) {
    return (
      <Box flexDirection="column">
        {availabilityUnknown
          ? <Text color="yellow">Command availability is unknown while capability metadata loads.</Text>
          : <Text color="yellow">No available command matches "/{state.query.trim()}"</Text>}
        <Text dimColor>Esc closes the picker. A leading "/" is required for a command.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Commands</Text>
      {availabilityUnknown && <Text dimColor>Operation availability is unknown while capability metadata loads.</Text>}
      {suggestions.slice(0, MAX_PICKER_ROWS).map((suggestion, position) => {
        const selected = position === state.index;
        const marker = selected ? '▸' : ' ';
        // State is carried by text as well as colour, so a narrow or monochrome
        // terminal still reads correctly.
        const suffix = suggestion.unavailableReason === null
          ? ''
          : `  — unavailable: ${suggestion.unavailableReason}`;
        return (
          <Text key={suggestion.name} color={selected ? 'cyan' : undefined} dimColor={suggestion.unavailableReason !== null}>
            {`${marker} ${suggestion.command.usage.padEnd(30)} ${suggestion.command.description}${suffix}`}
          </Text>
        );
      })}
      {suggestions.length > MAX_PICKER_ROWS && (
        <Text dimColor>{`… ${suggestions.length - MAX_PICKER_ROWS} more; keep typing to narrow`}</Text>
      )}
      <Text dimColor>
        {busy
          ? 'working…'
          : 'Up/Down move · Tab accepts · Enter submits · Esc closes this picker'}
      </Text>
    </Box>
  );
}

/**
 * The compact header.
 *
 * One line when the terminal is wide, stacked when it is narrow, and always in
 * text labels so no state depends on colour alone.
 */
export interface HeaderProps {
  readonly connection: string;
  readonly endpoint: string;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly runId: string | null;
  readonly runState: string | null;
  readonly authenticated: boolean;
  readonly width: number;
}

const NARROW = 76;

export function TerminalHeader(props: HeaderProps) {
  const task = props.taskId === null ? 'none' : `${props.taskId.slice(0, 8)}`;
  const route = `${props.provider ?? 'no provider'}/${props.model ?? 'no model'}`;
  const run = props.runId === null ? 'none' : `${props.runId.slice(0, 8)} ${props.runState ?? ''}`.trim();

  if (props.width < NARROW) {
    // Stack rather than hide: a blocker the operator cannot see is not a blocker
    // they can act on.
    return (
      <Box flexDirection="column">
        <Text bold>{`Threadline — ${props.connection}`}</Text>
        <Text dimColor>{props.endpoint}</Text>
        <Text>{`project ${props.projectId === null ? 'none' : props.projectId.slice(0, 8)} · task ${task}`}</Text>
        <Text>{`route ${route}`}</Text>
        <Text>{`run ${run} · session ${props.authenticated ? 'attached' : 'none'}`}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>{`Threadline — ${props.connection} · project ${props.projectId === null ? 'none' : props.projectId.slice(0, 8)} · task ${task}`}</Text>
      <Text dimColor>{`${props.endpoint} · route ${route} · run ${run} · session ${props.authenticated ? 'attached' : 'none'}`}</Text>
    </Box>
  );
}

export type { CapabilityClient };
