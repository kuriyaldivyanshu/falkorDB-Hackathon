import {
  AUTHORIZATION_HEADER,
  CLIENT_KIND_HEADER,
  isThreadlineErrorPayload,
  ThreadlineError,
} from '@threadline/shared';

/**
 * Typed loopback transport.
 *
 * Every call returns the shared success payload or throws the shared typed
 * error; a network failure is reduced to `service_unavailable` with the address
 * that did not answer, so a caller never sees a raw fetch error.
 */

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly timeoutMs: number;
  /** Invocation cancellation also covers response consumption. */
  readonly signal?: AbortSignal;
  readonly maxResponseBytes?: number;
}

export interface ApiClient {
  readonly baseUrl: string;
  get(path: string, query?: Readonly<Record<string, string | number | undefined>>): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const request = async (path: string, init: RequestInit): Promise<unknown> => {
    const headers: Record<string, string> = {
      accept: 'application/json',
      [CLIENT_KIND_HEADER]: 'cli',
      ...(options.token === null ? {} : { [AUTHORIZATION_HEADER]: `Bearer ${options.token}` }),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    };
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: options.signal === undefined
          ? AbortSignal.timeout(options.timeoutMs)
          : AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
      });
    } catch (error) {
      throw new ThreadlineError('service_unavailable', 'The memory service did not answer.', {
        address: baseUrl,
        reason: error instanceof Error ? error.name : typeof error,
      });
    }

    let payload: unknown;
    let text: string;
    if (options.maxResponseBytes === undefined) {
      text = await response.text();
    } else {
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (reader !== undefined) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > options.maxResponseBytes) throw new Error('response_bound');
          chunks.push(next.value);
        }
        text = Buffer.concat(chunks).toString('utf8');
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    }
    try {
      payload = text.length === 0 ? null : JSON.parse(text);
    } catch {
      throw new ThreadlineError('service_unavailable', 'The memory service returned an unreadable response.', {
        status: response.status,
      });
    }
    if (typeof payload === 'object' && payload !== null) {
      const envelope = payload as { ok?: unknown; data?: unknown; error?: unknown };
      if (envelope.ok === true) {
        return envelope.data;
      }
      if (envelope.ok === false && isThreadlineErrorPayload(envelope.error)) {
        throw new ThreadlineError(envelope.error.code, envelope.error.message, envelope.error.details);
      }
    }
    throw new ThreadlineError('service_unavailable', 'The memory service returned an unexpected envelope.', {
      status: response.status,
    });
  };

  return {
    baseUrl,
    get(path, query) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) {
          search.set(key, String(value));
        }
      }
      const suffix = search.size === 0 ? '' : `?${search.toString()}`;
      return request(`${path}${suffix}`, { method: 'GET' });
    },
    post(path, body) {
      return request(path, { method: 'POST', body: JSON.stringify(body) });
    },
  };
}
