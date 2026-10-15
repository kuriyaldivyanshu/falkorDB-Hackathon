import {
  PROTOCOL_VERSION,
  isCommandId,
  isHealthReport,
  isThreadlineErrorPayload,
  isThreadlineEvent,
  type CommandInput,
  type CommandName,
  type CommandResponse,
  type CommandResult,
  type HealthReport,
  type ThreadlineEvent,
} from '@threadline/shared';


import {
  BackendProtocolError,
  BackendUnreachableError,
  describeCause,
  isAbortError,
} from './errors.js';
import { ACCEPT_EVENT_STREAM, BACKEND_ROUTES } from './routes.js';
import { SseDecoder } from './sse.js';

/**
 * The only component in this package that performs I/O.
 *
 * It turns backend answers into the shared wire contract or into a
 * {@link BackendUnreachableError} / {@link BackendProtocolError}. It never
 * interprets a command result: task truth belongs to the backend, and this
 * client has no store, no credentials and no inference route of its own.
 */

export type EventStreamEndReason = 'closed-by-client' | 'stream-ended' | 'failed';

export interface EventStreamHandlers {
  readonly onEvent: (event: ThreadlineEvent) => void;
  /** A malformed or unsupported frame was skipped; the stream remains open. */
  readonly onFrameError: (error: Error) => void;
  /** A stream-level problem. The stream is finished when this is called. */
  readonly onError: (error: Error) => void;
  readonly onEnd: (reason: EventStreamEndReason) => void;
}

export interface EventStreamHandle {
  /** Resolves true only after a valid stream handshake; false on failure/close. */
  readonly ready: Promise<boolean>;
  readonly closed: boolean;
  /** Idempotent. Aborts the request and releases the reader. */
  close(): void;
}

export interface BackendClient {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  health(signal?: AbortSignal): Promise<HealthReport>;
  sendCommand<C extends CommandName>(
    command: C,
    input: CommandInput<C>,
    signal?: AbortSignal,
  ): Promise<CommandResponse<C>>;
  openEventStream(handlers: EventStreamHandlers): EventStreamHandle;
}

export interface BackendClientOptions {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  /** Injected so a check can drive the client without a live socket. */
  readonly fetchImpl?: typeof fetch;
}

export function createBackendClient(options: BackendClientOptions): BackendClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  const endpoint = (route: string): string => `${baseUrl}${route}`;

  const send = async (
    route: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> => {
    const url = endpoint(route);
    const timeout = AbortSignal.timeout(options.requestTimeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    try {
      return await doFetch(url, { ...init, signal: combined });
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      const detail = isAbortError(error)
        ? `no answer within ${options.requestTimeoutMs}ms`
        : describeCause(error);
      throw new BackendUnreachableError(url, detail, { cause: error });
    }
  };

  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new BackendProtocolError(
        response.url,
        'the response body was not JSON',
        response.status,
        { cause: error },
      );
    }
  };

  return {
    baseUrl,
    requestTimeoutMs: options.requestTimeoutMs,

    async health(signal?: AbortSignal): Promise<HealthReport> {
      const response = await send(BACKEND_ROUTES.health, { method: 'GET' }, signal);
      const body = await readJson(response);
      // The backend answers 503 with a complete report while it is not ready.
      // The report itself states the state, so it is returned and shown rather
      // than discarded as an error.
      if (isHealthReport(body)) {
        return body;
      }
      throw new BackendProtocolError(
        response.url,
        `health answered ${response.status} with a body that is not a health report`,
        response.status,
      );
    },

    async sendCommand<C extends CommandName>(
      command: C,
      input: CommandInput<C>,
      signal?: AbortSignal,
    ): Promise<CommandResponse<C>> {
      const body: unknown = { protocolVersion: PROTOCOL_VERSION, command, input };
      const response = await send(
        BACKEND_ROUTES.commands,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        },
        signal,
      );
      const payload = await readJson(response);
      // The HTTP status is deliberately ignored here: the envelope's `ok`
      // field is the discriminator, and a rejection carries a typed error the
      // interface renders instead of throwing.
      return parseCommandResponse<C>(response, payload);
    },

    openEventStream(handlers: EventStreamHandlers): EventStreamHandle {
      const controller = new AbortController();
      let closed = false;
      let resolveReady: (ready: boolean) => void = () => {};
      const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });
      const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
      timer.unref();
      const finishHandshake = (value: boolean): void => {
        clearTimeout(timer);
        resolveReady(value);
      };
      const handle: EventStreamHandle = {
        ready,
        get closed() {
          return closed;
        },
        close() {
          if (closed) {
            return;
          }
          closed = true;
          finishHandshake(false);
          controller.abort();
        },
      };
      void runEventStream(
        doFetch, endpoint(BACKEND_ROUTES.events), controller.signal, () => closed,
        { ...handlers, onEnd: (reason) => { closed = true; handlers.onEnd(reason); } },
        () => finishHandshake(true),
      ).finally(() => finishHandshake(false));
      return handle;
    },
  };
}

async function runEventStream(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal,
  isClosed: () => boolean,
  handlers: EventStreamHandlers,
  onOpen: () => void,
): Promise<void> {
  let response: Response;
  try {
    response = await doFetch(url, { headers: { accept: ACCEPT_EVENT_STREAM }, signal });
  } catch (error) {
    if (isClosed()) {
      handlers.onEnd('closed-by-client');
      return;
    }
    handlers.onError(new BackendUnreachableError(url, describeCause(error), { cause: error }));
    handlers.onEnd('failed');
    return;
  }

  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    handlers.onError(new BackendProtocolError(url, `the stream answered ${response.status}`, response.status));
    handlers.onEnd('failed');
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes(ACCEPT_EVENT_STREAM)) {
    void response.body?.cancel().catch(() => {});
    handlers.onError(
      new BackendProtocolError(url, `expected ${ACCEPT_EVENT_STREAM}, received "${contentType}"`, 200),
    );
    handlers.onEnd('failed');
    return;
  }

  if (response.body === null) {
    handlers.onError(new BackendProtocolError(url, 'the response carried no stream body', 200));
    handlers.onEnd('failed');
    return;
  }

  onOpen();
  const decoder = new SseDecoder();
  const text = new TextDecoder();
  const reader = response.body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const frame of decoder.push(text.decode(value, { stream: true }))) {
        dispatchFrame(frame.data, handlers);
      }
    }
    decoder.reset();
    handlers.onEnd(isClosed() ? 'closed-by-client' : 'stream-ended');
  } catch (error) {
    if (isClosed()) {
      handlers.onEnd('closed-by-client');
      return;
    }
    handlers.onError(new BackendUnreachableError(url, describeCause(error), { cause: error }));
    handlers.onEnd('failed');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * A frame the client cannot read is reported rather than dropped silently, but
 * one bad frame does not end the stream.
 */
function dispatchFrame(data: string, handlers: EventStreamHandlers): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch (error) {
    handlers.onFrameError(
      new BackendProtocolError('event stream', 'a frame was not valid JSON', 200, { cause: error }),
    );
    return;
  }
  if (!isThreadlineEvent(parsed)) {
    handlers.onFrameError(new BackendProtocolError('event stream', 'a frame was not a known event', 200));
    return;
  }
  handlers.onEvent(parsed);
}

/**
 * Validates the response envelope. The `result` payload is command-specific and
 * opaque at this layer, so it is passed through unchanged: the envelope is
 * checked in full and the backend remains the sole authority on the shape of
 * its own result.
 */
function parseCommandResponse<C extends CommandName>(
  response: Response,
  payload: unknown,
): CommandResponse<C> {
  if (!isJsonObject(payload)) {
    throw new BackendProtocolError(response.url, 'the command answer was not an object', response.status);
  }
  const ok = payload['ok'];
  const protocolVersion = payload['protocolVersion'];
  const receivedAt = payload['receivedAt'];
  if (typeof ok !== 'boolean') {
    throw new BackendProtocolError(response.url, 'the command answer had no "ok" field', response.status);
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new BackendProtocolError(
      response.url,
      `the backend speaks protocol version ${String(protocolVersion)}, this client speaks ${PROTOCOL_VERSION}`,
      response.status,
    );
  }
  if (typeof receivedAt !== 'string') {
    throw new BackendProtocolError(response.url, 'the command answer had no "receivedAt"', response.status);
  }

  if (ok) {
    const commandId = payload['commandId'];
    const result: unknown = payload['result'];
    if (!isCommandId(commandId) || !isPlainObject(result)) {
      throw new BackendProtocolError(
        response.url,
        'a successful answer must carry a command id and an object result',
        response.status,
      );
    }
    return {
      ok: true,
      protocolVersion,
      commandId,
      receivedAt,
      result: result as CommandResult<C>,
    };
  }

  const commandId = payload['commandId'];
  if (commandId !== null && !isCommandId(commandId)) {
    throw new BackendProtocolError(response.url, 'the failed answer had a malformed command id', response.status);
  }
  const error = payload['error'];
  if (!isThreadlineErrorPayload(error)) {
    throw new BackendProtocolError(response.url, 'the failed answer had no usable error', response.status);
  }
  return { ok: false, protocolVersion, commandId, receivedAt, error };
}

/** Narrows an untrusted answer to a JSON object before its fields are read. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A `boolean` check on purpose: a type predicate would narrow `result` to
 * `Record<string, unknown>`, and the command-specific result type then needs a
 * second cast to be reached. Keeping `result` as `unknown` until the return
 * statement documents that the payload is passed through deliberately.
 */
function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
