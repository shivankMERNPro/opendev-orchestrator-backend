import { parseModelIdentifier } from './modelIdentifier.js';
import { selectParameterTags, type ParameterVariant } from './parameterTags.js';

const TAGS_ORIGIN = 'https://ollama.com';
const MANIFEST_ORIGIN = 'https://registry.ollama.ai';
const MAX_BYTES = 1_000_000;

const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const TAG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  body: ReadableStream<Uint8Array> | null;
  headers: { get(name: string): string | null };
}>;

export interface OllamaLibraryClient {
  listParameterTags(
    modelName: string,
    signal: AbortSignal,
  ): Promise<ParameterVariant[] | null>;
  manifestSize(
    modelName: string,
    tag: string,
    signal: AbortSignal,
  ): Promise<number | null>;
}

function isLibraryName(value: string): boolean {
  return (
    LIBRARY_NAME.test(value) &&
    !value.includes('..') &&
    parseModelIdentifier(value) === value
  );
}

function isTag(value: string): boolean {
  return TAG_NAME.test(value) && !value.includes('..');
}

async function readJson(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<unknown | null> {
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    return null;
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BYTES) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
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
      if (received > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteSize(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return value;
}

export function manifestByteSize(payload: unknown): number | null {
  if (!isRecord(payload) || !Array.isArray(payload.layers)) {
    return null;
  }
  let total = 0;
  if (isRecord(payload.config)) {
    const configSize = byteSize(payload.config.size);
    if (payload.config.size !== undefined && configSize === null) {
      return null;
    }
    if (configSize !== null) {
      total += configSize;
    }
  }
  for (const layer of payload.layers) {
    if (!isRecord(layer)) {
      return null;
    }
    const size = byteSize(layer.size);
    if (size === null) {
      return null;
    }
    total += size;
  }
  return total;
}

export function createOllamaLibraryClient(
  fetchImpl: FetchLike = fetch,
): OllamaLibraryClient {
  return {
    async listParameterTags(modelName, signal) {
      if (!isLibraryName(modelName)) {
        return null;
      }
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(`${TAGS_ORIGIN}/library/${modelName}/tags`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal,
        });
      } catch {
        return null;
      }
      const payload = await readJson(response);
      if (!isRecord(payload) || !Array.isArray(payload.tags)) {
        return null;
      }
      const tags = payload.tags.filter(
        (tag): tag is string => typeof tag === 'string',
      );
      return selectParameterTags(tags);
    },

    async manifestSize(modelName, tag, signal) {
      if (!isLibraryName(modelName) || !isTag(tag)) {
        return null;
      }
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(
          `${MANIFEST_ORIGIN}/v2/library/${modelName}/manifests/${tag}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/vnd.docker.distribution.manifest.v2+json',
            },
            redirect: 'error',
            signal,
          },
        );
      } catch {
        return null;
      }
      const payload = await readJson(response);
      return manifestByteSize(payload);
    },
  };
}
