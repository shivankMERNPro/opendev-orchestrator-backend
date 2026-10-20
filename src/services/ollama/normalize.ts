export interface InstalledModel {
  name: string;
  identifier: string;
  sizeBytes: number | null;
  family: string | null;
  families: string[] | null;
  parameterSize: string | null;
  quantization: string | null;
  format: string | null;
  modifiedAt: string | null;
}

export interface RuntimeModel {
  name: string;
  identifier: string;
  sizeBytes: number | null;
  vramBytes: number | null;
  expiresAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export type InterpretedPullEvent =
  | { kind: 'invalid' }
  | { kind: 'failed' }
  | {
      kind: 'success';
      bytesCompleted: number | null;
      bytesTotal: number | null;
      progressPercent: number | null;
    }
  | {
      kind: 'progress';
      phase: 'downloading' | 'verifying';
      message: string;
      bytesCompleted: number | null;
      bytesTotal: number | null;
      progressPercent: number | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return value;
}

function optionalByteCount(value: unknown, present: boolean): number | null {
  if (!present) {
    return null;
  }
  return byteCount(value);
}

function textField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maxLength) {
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function timestamp(value: unknown): string | null {
  const text = textField(value, 40);
  if (text === null) {
    return null;
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function families(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const names: string[] = [];
  for (const entry of value) {
    const name = textField(entry, 64);
    if (name === null) {
      return null;
    }
    names.push(name);
  }
  return names;
}

function displayName(value: unknown): string | null {
  return textField(value, 256);
}

function identifierFor(name: string, digest: unknown): string {
  if (
    typeof digest === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(digest.trim())
  ) {
    return digest.trim();
  }
  return name;
}

function detailsOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function progressPercent(
  completed: number | null,
  total: number | null,
): number | null {
  if (completed === null || total === null || total <= 0 || completed > total) {
    return null;
  }
  return Math.floor((completed * 100) / total);
}

function publicStatus(status: string): string {
  const compact = status.replace(/\s+/g, ' ').trim();
  if (
    compact.length < 1 ||
    compact.length > 120 ||
    /https?:\/\/|\/\/|\d{1,3}(?:\.\d{1,3}){3}/i.test(compact) ||
    !/^[A-Za-z0-9 .:_-]+$/.test(compact)
  ) {
    return 'Download in progress.';
  }
  return compact;
}

function readCounts(record: Record<string, unknown>): {
  bytesCompleted: number | null;
  bytesTotal: number | null;
  progressPercent: number | null;
} | null {
  const hasCompleted = 'completed' in record;
  const hasTotal = 'total' in record;
  if (hasCompleted && byteCount(record.completed) === null) {
    return null;
  }
  if (hasTotal && byteCount(record.total) === null) {
    return null;
  }
  const bytesCompleted = optionalByteCount(record.completed, hasCompleted);
  const bytesTotal = optionalByteCount(record.total, hasTotal);
  if (
    bytesCompleted !== null &&
    bytesTotal !== null &&
    bytesCompleted > bytesTotal
  ) {
    return null;
  }
  return {
    bytesCompleted,
    bytesTotal,
    progressPercent: progressPercent(bytesCompleted, bytesTotal),
  };
}

export function normalizeInstalledModels(payload: unknown): InstalledModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error('invalid');
  }

  return payload.models.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('invalid');
    }
    const name = displayName(entry.name);
    if (name === null) {
      throw new Error('invalid');
    }
    const details = detailsOf(entry.details);
    return {
      name,
      identifier: identifierFor(name, entry.digest),
      sizeBytes: 'size' in entry ? byteCount(entry.size) : null,
      family: details === null ? null : textField(details.family, 64),
      families: details === null ? null : families(details.families),
      parameterSize:
        details === null ? null : textField(details.parameter_size, 32),
      quantization:
        details === null ? null : textField(details.quantization_level, 32),
      format: details === null ? null : textField(details.format, 32),
      modifiedAt: timestamp(entry.modified_at),
    };
  });
}

export function normalizeRuntimeModels(payload: unknown): RuntimeModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error('invalid');
  }

  return payload.models.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('invalid');
    }
    const name = displayName(entry.name);
    if (name === null) {
      throw new Error('invalid');
    }
    const details = detailsOf(entry.details);
    return {
      name,
      identifier: identifierFor(name, entry.digest),
      sizeBytes: 'size' in entry ? byteCount(entry.size) : null,
      vramBytes: 'size_vram' in entry ? byteCount(entry.size_vram) : null,
      expiresAt: timestamp(entry.expires_at),
      family: details === null ? null : textField(details.family, 64),
      parameterSize:
        details === null ? null : textField(details.parameter_size, 32),
      quantization:
        details === null ? null : textField(details.quantization_level, 32),
    };
  });
}

export function normalizeVersionStatus(
  payload: unknown,
): 'available' | 'invalid' {
  if (!isRecord(payload)) {
    return 'invalid';
  }
  const version = textField(payload.version, 40);
  if (version === null || !/^[0-9A-Za-z._+-]+$/.test(version)) {
    return 'invalid';
  }
  return 'available';
}

export function interpretPullEvent(event: unknown): InterpretedPullEvent {
  if (!isRecord(event)) {
    return { kind: 'invalid' };
  }

  if ('error' in event) {
    if (typeof event.error !== 'string' || event.error.trim().length === 0) {
      return { kind: 'invalid' };
    }
    return { kind: 'failed' };
  }

  if (typeof event.status !== 'string') {
    return { kind: 'invalid' };
  }

  const counts = readCounts(event);
  if (counts === null) {
    return { kind: 'invalid' };
  }

  if (event.status.trim().toLowerCase() === 'success') {
    return { kind: 'success', ...counts };
  }

  const phase = /verif/i.test(event.status) ? 'verifying' : 'downloading';
  return {
    kind: 'progress',
    phase,
    message: publicStatus(event.status),
    ...counts,
  };
}
