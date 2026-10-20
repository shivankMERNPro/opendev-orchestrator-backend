import { StartupError } from './startupError.js';

const LOOPBACK_NAMES = new Set(['localhost', '::1']);

export function isLoopbackBindAddress(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (LOOPBACK_NAMES.has(value)) {
    return true;
  }

  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (match === null) {
    return false;
  }

  return match.slice(1).every((octet) => {
    const number = Number(octet);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

export function isLoopbackRequestHost(hostHeader: string): boolean {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) {
      return false;
    }
    return isLoopbackBindAddress(trimmed.slice(1, end));
  }

  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) {
    return isLoopbackBindAddress(trimmed);
  }

  const maybePort = trimmed.slice(colon + 1);
  if (!/^\d+$/.test(maybePort)) {
    return isLoopbackBindAddress(trimmed);
  }

  return isLoopbackBindAddress(trimmed.slice(0, colon));
}

export function assertLoopbackBind(host: string): void {
  if (!isLoopbackBindAddress(host)) {
    throw new StartupError('HOST must be a loopback address');
  }
}
