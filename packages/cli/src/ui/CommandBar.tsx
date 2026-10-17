import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface CommandBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
  readonly placeholder: string;
  /** Why the bar is refusing input, or null when it accepts it. */
  readonly disabledReason?: string | null;
  /** One line of guidance, supplied by the host so the bar cannot describe a
   *  dispatch path the host has removed. */
  readonly hint?: string;
}

/**
 * The single input line.
 *
 * The hint comes from the host rather than being written here, because the bar
 * is reused across mount points and a hard-coded description of what Enter does
 * outlives the dispatch path it described. When there is no command surface, it
 * says so instead of implying that text will be sent.
 */
export function CommandBar({ value, onChange, onSubmit, disabled, placeholder, disabledReason, hint }: CommandBarProps) {
  if (disabled) {
    return (
      <Box>
        <Text dimColor>{disabledReason ?? 'Not connected — no command can be sent.'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {hint !== undefined && hint.length > 0 && <Text dimColor>{hint}</Text>}
      <Box>
        <Text>{'> '}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}