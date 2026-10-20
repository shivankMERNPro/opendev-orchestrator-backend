import { isLoopbackBindAddress } from '../utils/loopback.js';
import { StartupError } from '../utils/startupError.js';

export const DEFAULT_MONGO_URI =
  'mongodb://127.0.0.1:27017/opendev-orchestrator';

export function resolveMongoUri(value: string | undefined): string {
  const candidate =
    value === undefined || value.trim().length === 0
      ? DEFAULT_MONGO_URI
      : value.trim();
  return assertLocalMongoUri(candidate);
}

export function assertLocalMongoUri(value: string): string {
  if (value.includes('\0') || /[\r\n]/.test(value)) {
    throw new StartupError('MONGO_URI is invalid');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StartupError('MONGO_URI is invalid');
  }

  if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') {
    throw new StartupError('MONGO_URI is invalid');
  }

  if (
    url.protocol !== 'mongodb:' ||
    !isLoopbackBindAddress(normalizeMongoHostname(url.hostname))
  ) {
    throw new StartupError('MONGO_URI must use the local MongoDB instance');
  }

  if (url.port.length > 0) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new StartupError('MONGO_URI is invalid');
    }
  }

  if (decodeDatabaseName(url.pathname) === null) {
    throw new StartupError('MONGO_URI is invalid');
  }

  return value;
}

function normalizeMongoHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function decodeDatabaseName(pathname: string): string | null {
  if (!pathname.startsWith('/') || pathname.includes('/', 1)) {
    return null;
  }

  let name: string;
  try {
    name = decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }

  if (name.length === 0 || name.includes('\0')) {
    return null;
  }

  return name;
}
