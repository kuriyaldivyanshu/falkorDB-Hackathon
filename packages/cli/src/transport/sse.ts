/**
 * Minimal server-sent-events frame parser.
 *
 * Only what this client needs from the SSE grammar: `event`, `data` and `id`
 * fields, `:` comment lines (the backend sends one as a preamble) and blank
 * line dispatch. `retry` is accepted and ignored because nothing here
 * reconnects on a server-suggested delay.
 *
 * An incomplete trailing frame at end of stream is discarded rather than
 * delivered: the stream is process-local and has no replay, so a half-read
 * event is not a real event.
 */

export interface SseFrame {
  readonly id: string | null;
  readonly event: string | null;
  readonly data: string;
}

const FIELD_SEPARATOR = ':';
const MAX_FRAME_CHARACTERS = 1_048_576;

export class SseDecoder {
  private event: string | null = null;
  private id: string | null = null;
  private data: string[] = [];
  private pendingLine = '';
  private frameCharacters = 0;

  /** Feeds a decoded text chunk and returns every frame it completed. */
  push(chunk: string): SseFrame[] {
    const frames: SseFrame[] = [];
    // A fetch chunk is not an SSE line or event boundary. Retain the unfinished
    // line and consume only real newline-terminated input.
    let offset = 0;
    for (;;) {
      const newline = chunk.indexOf('\n', offset);
      const segment = chunk.slice(offset, newline === -1 ? undefined : newline);
      this.frameCharacters += segment.length;
      if (this.frameCharacters > MAX_FRAME_CHARACTERS) {
        this.reset();
        throw new Error('SSE frame exceeds the client buffer limit.');
      }
      this.pendingLine += segment;
      if (newline === -1) break;
      const line = this.pendingLine;
      this.pendingLine = '';
      const frame = this.consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      if (line === '' || line === '\r') this.frameCharacters = 0;
      if (frame !== null) frames.push(frame);
      offset = newline + 1;
    }
    return frames;
  }

  /** Drops any partial frame. Called when the stream ends. */
  reset(): void {
    this.pendingLine = '';
    this.frameCharacters = 0;
    this.event = null;
    this.id = null;
    this.data = [];
  }

  private consumeLine(line: string): SseFrame | null {
    if (line === '') {
      return this.dispatch();
    }
    // A line beginning with a colon is a comment and carries no field.
    if (line.startsWith(FIELD_SEPARATOR)) {
      return null;
    }

    const separator = line.indexOf(FIELD_SEPARATOR);
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.event = value;
        break;
      case 'data':
        this.data.push(value);
        break;
      case 'id':
        this.id = value;
        break;
      default:
        // 'retry' and any unknown field are ignored, as the grammar requires.
        break;
    }
    return null;
  }

  private dispatch(): SseFrame | null {
    if (this.data.length === 0) {
      this.event = null;
      this.id = null;
      return null;
    }
    const frame: SseFrame = {
      id: this.id,
      event: this.event,
      data: this.data.join('\n'),
    };
    this.event = null;
    this.id = null;
    this.data = [];
    return frame;
  }
}
