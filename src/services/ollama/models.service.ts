import { OllamaRequestError } from './errors.js';
import {
  normalizeInstalledModels,
  normalizeRuntimeModels,
  normalizeVersionStatus,
  type InstalledModel,
  type RuntimeModel,
} from './normalize.js';
import type { OllamaClient } from './client.js';

async function readPayload(
  load: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await load(signal);
  } catch (error) {
    if (error instanceof OllamaRequestError) {
      throw error;
    }
    throw new OllamaRequestError('unavailable');
  }
}

export async function readOllamaStatus(
  client: OllamaClient,
  signal: AbortSignal,
): Promise<'available' | 'unavailable' | 'invalid'> {
  try {
    const payload = await readPayload(
      (current) => client.getVersion(current),
      signal,
    );
    const status = normalizeVersionStatus(payload);
    return status === 'available' ? 'available' : 'invalid';
  } catch (error) {
    if (error instanceof OllamaRequestError) {
      if (error.code === 'invalid') {
        return 'invalid';
      }
      return 'unavailable';
    }
    return 'unavailable';
  }
}

export async function readInstalledModels(
  client: OllamaClient,
  signal: AbortSignal,
): Promise<InstalledModel[]> {
  const payload = await readPayload(
    (current) => client.getTags(current),
    signal,
  );
  try {
    return normalizeInstalledModels(payload);
  } catch {
    throw new OllamaRequestError('invalid');
  }
}

export async function readRuntimeModels(
  client: OllamaClient,
  signal: AbortSignal,
): Promise<RuntimeModel[]> {
  const payload = await readPayload(
    (current) => client.getRunning(current),
    signal,
  );
  try {
    return normalizeRuntimeModels(payload);
  } catch {
    throw new OllamaRequestError('invalid');
  }
}
