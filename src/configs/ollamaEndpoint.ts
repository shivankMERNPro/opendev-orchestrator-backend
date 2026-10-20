import { isLoopbackBindAddress } from '../utils/loopback.js';
import { StartupError } from '../utils/startupError.js';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MAX_CONCURRENT_PULLS = 1;
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 4000;
export const DEFAULT_OLLAMA_PULL_TIMEOUT_MS = 30 * 60 * 1000;

const INVALID_URL = 'OLLAMA_BASE_URL is invalid';
const REMOTE_URL = 'OLLAMA_BASE_URL must use a loopback address';

export function resolveOllamaBaseUrl(value: string | undefined): string {
  const source =
    value === undefined || value.trim().length === 0
      ? DEFAULT_OLLAMA_BASE_URL
      : value.trim();

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new StartupError(INVALID_URL);
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StartupError(INVALID_URL);
  }

  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!isLoopbackBindAddress(hostname)) {
    throw new StartupError(REMOTE_URL);
  }

  if (url.port.length > 0) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new StartupError(INVALID_URL);
    }
  }

  return url.origin;
}

export function resolveOllamaLimit(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  invalidMessage: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new StartupError(invalidMessage);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new StartupError(invalidMessage);
  }

  return parsed;
}
