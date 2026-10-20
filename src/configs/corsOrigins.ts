import { isLoopbackBindAddress } from '../utils/loopback.js';
import { StartupError } from '../utils/startupError.js';

export const DEFAULT_CORS_ORIGIN = 'http://127.0.0.1:5173';

export function resolveCorsOrigins(value: string | undefined): string[] {
  const source =
    value === undefined || value.trim().length === 0
      ? DEFAULT_CORS_ORIGIN
      : value.trim();
  const pieces = source
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (pieces.length === 0) {
    throw new StartupError('CORS_ORIGINS is invalid');
  }

  const origins: string[] = [];
  for (const piece of pieces) {
    const origin = assertLoopbackOrigin(piece);
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
}

function assertLoopbackOrigin(value: string): string {
  if (value === '*' || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new StartupError('CORS_ORIGINS is invalid');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StartupError('CORS_ORIGINS is invalid');
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StartupError('CORS_ORIGINS is invalid');
  }

  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (!isLoopbackBindAddress(hostname)) {
    throw new StartupError('CORS_ORIGINS must use a loopback origin');
  }

  return url.origin;
}
