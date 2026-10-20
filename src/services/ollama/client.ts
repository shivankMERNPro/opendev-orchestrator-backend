import { resolveOllamaBaseUrl } from '../../configs/ollamaEndpoint.js';
import { OllamaRequestError } from './errors.js';

const JSON_LIMIT_BYTES = 2_000_000;
const LINE_LIMIT_BYTES = 64 * 1024;

export interface PullStreamOptions {
  signal: AbortSignal;
  onEvent: (event: unknown) => void;
}

export interface OllamaClient {
  getVersion(signal: AbortSignal): Promise<unknown>;
  getTags(signal: AbortSignal): Promise<unknown>;
  getRunning(signal: AbortSignal): Promise<unknown>;
  pullModel(name: string, options: PullStreamOptions): Promise<void>;
}

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  headers: { get(name: string): string | null };
}>;

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (body === null) {
    throw new OllamaRequestError('invalid');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new OllamaRequestError('invalid');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  return text;
}

function mapAbort(timedOut: boolean, error: unknown): never {
  if (timedOut) {
    throw new OllamaRequestError('timeout');
  }
  if (error instanceof OllamaRequestError) {
    throw error;
  }
  throw new OllamaRequestError('unavailable');
}

function combineSignals(
  parent: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cancel: () => void;
} {
  const controller = new AbortController();
  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = (): void => {
    controller.abort();
  };
  if (parent.aborted) {
    controller.abort();
  } else {
    parent.addEventListener('abort', onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cancel() {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}

export function createHttpOllamaClient(
  baseUrl: string,
  requestTimeoutMs: number,
  fetchImpl: FetchLike = fetch,
): OllamaClient {
  let origin: string;
  try {
    origin = resolveOllamaBaseUrl(baseUrl);
  } catch {
    throw new OllamaRequestError('invalid');
  }

  async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
    const timeout = combineSignals(signal, requestTimeoutMs);
    try {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(endpoint(origin, path), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: timeout.signal,
        });
      } catch (error) {
        mapAbort(timeout.timedOut(), error);
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new OllamaRequestError('invalid');
      }

      const declared = response.headers.get('content-length');
      if (declared !== null && Number(declared) > JSON_LIMIT_BYTES) {
        await response.body?.cancel();
        throw new OllamaRequestError('invalid');
      }

      let text: string;
      try {
        text = await readLimited(response.body, JSON_LIMIT_BYTES);
      } catch (error) {
        mapAbort(timeout.timedOut(), error);
      }

      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new OllamaRequestError('invalid');
      }
    } finally {
      timeout.cancel();
    }
  }

  return {
    getVersion(signal: AbortSignal): Promise<unknown> {
      return getJson('/api/version', signal);
    },
    getTags(signal: AbortSignal): Promise<unknown> {
      return getJson('/api/tags', signal);
    },
    getRunning(signal: AbortSignal): Promise<unknown> {
      return getJson('/api/ps', signal);
    },
    async pullModel(name: string, options: PullStreamOptions): Promise<void> {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(endpoint(origin, '/api/pull'), {
          method: 'POST',
          headers: {
            Accept: 'application/x-ndjson',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, stream: true }),
          redirect: 'error',
          signal: options.signal,
        });
      } catch (error) {
        mapAbort(false, error);
      }

      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new OllamaRequestError('invalid');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > LINE_LIMIT_BYTES) {
            await reader.cancel();
            throw new OllamaRequestError('invalid');
          }
          let newline = buffer.indexOf('\n');
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line.length > 0) {
              try {
                options.onEvent(JSON.parse(line) as unknown);
              } catch (error) {
                if (error instanceof OllamaRequestError) {
                  throw error;
                }
                throw new OllamaRequestError('invalid');
              }
            }
            if (buffer.length > LINE_LIMIT_BYTES) {
              await reader.cancel();
              throw new OllamaRequestError('invalid');
            }
            newline = buffer.indexOf('\n');
          }
        }
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail.length > 0) {
          try {
            options.onEvent(JSON.parse(tail) as unknown);
          } catch (error) {
            if (error instanceof OllamaRequestError) {
              throw error;
            }
            throw new OllamaRequestError('invalid');
          }
        }
      } catch (error) {
        mapAbort(false, error);
      } finally {
        reader.releaseLock();
      }
    },
  };
}
