import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface CommandBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled: boolean;
  readonly placeholder: string;
}

/**
 * The single action available at this milestone: send one development command.
 *
 * The input is this process's own text. It is submitted to the backend and the
 * answer is rendered as received; nothing here decides whether the work
 * succeeded.
 */
export function CommandBar({ value, onChange, onSubmit, disabled, placeholder }: CommandBarProps) {
  if (disabled) {
    return (
      <Box>
        <Text dimColor>Not connected — no command can be sent.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>Type text and press Enter to send one development.echo command.</Text>
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
