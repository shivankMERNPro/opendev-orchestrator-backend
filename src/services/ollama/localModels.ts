import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseModelIdentifier } from './modelIdentifier.js';
import type { InstalledModel } from './normalize.js';
import { parameterLabel } from './parameterTags.js';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MANIFESTS = 200;
const MODEL_MEDIA_TYPE = 'application/vnd.ollama.image.model';

export function defaultOllamaModelsDirectory(): string {
  return path.join(os.homedir(), '.ollama', 'models');
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

function digestOf(value: unknown): string | null {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    return null;
  }
  return value;
}

function displayName(parts: string[]): string | null {
  if (parts.length < 4) {
    return null;
  }
  const tag = parts[parts.length - 1];
  const model = parts[parts.length - 2];
  const namespace = parts[parts.length - 3];
  if (
    tag === undefined ||
    model === undefined ||
    namespace === undefined ||
    tag.length === 0 ||
    model.length === 0
  ) {
    return null;
  }
  const name =
    namespace === 'library'
      ? `${model}:${tag}`
      : `${namespace}/${model}:${tag}`;
  return parseModelIdentifier(name);
}

async function readManifest(
  filePath: string,
  relativeParts: string[],
  blobsDirectory: string,
): Promise<InstalledModel | null> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.layers)) {
    return null;
  }

  let sizeBytes = 0;
  let modelDigest: string | null = null;
  const configDigest = isRecord(parsed.config)
    ? digestOf(parsed.config.digest)
    : null;
  const configSize = isRecord(parsed.config)
    ? byteSize(parsed.config.size)
    : null;
  if (configSize !== null) {
    sizeBytes += configSize;
  }

  for (const layer of parsed.layers) {
    if (!isRecord(layer)) {
      return null;
    }
    const size = byteSize(layer.size);
    if (size === null) {
      return null;
    }
    sizeBytes += size;
    if (layer.mediaType === MODEL_MEDIA_TYPE) {
      modelDigest = digestOf(layer.digest);
    }
  }

  if (modelDigest === null) {
    return null;
  }
  const blobName = `sha256-${modelDigest.slice('sha256:'.length)}`;
  try {
    const blob = await stat(path.join(blobsDirectory, blobName));
    if (!blob.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const name = displayName(relativeParts);
  if (name === null) {
    return null;
  }
  const tag = name.slice(name.lastIndexOf(':') + 1);

  return {
    name,
    identifier: configDigest ?? modelDigest,
    sizeBytes,
    family: null,
    families: null,
    parameterSize: parameterLabel(tag),
    quantization: null,
    format: null,
    modifiedAt: info.mtime.toISOString(),
  };
}

async function walkManifests(
  directory: string,
  manifestsRoot: string,
  blobsDirectory: string,
  depth: number,
  found: InstalledModel[],
): Promise<void> {
  if (depth > 5 || found.length >= MAX_MANIFESTS) {
    return;
  }
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_MANIFESTS || entry.name.startsWith('.')) {
      continue;
    }
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkManifests(
        next,
        manifestsRoot,
        blobsDirectory,
        depth + 1,
        found,
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativeParts = path.relative(manifestsRoot, next).split(path.sep);
    const model = await readManifest(next, relativeParts, blobsDirectory);
    if (model !== null) {
      found.push(model);
    }
  }
}

export async function readLocalInstalledModels(
  modelsDirectory = defaultOllamaModelsDirectory(),
): Promise<InstalledModel[]> {
  const resolved = path.resolve(modelsDirectory);
  const found: InstalledModel[] = [];
  const manifestsRoot = path.join(resolved, 'manifests');
  await walkManifests(
    manifestsRoot,
    manifestsRoot,
    path.join(resolved, 'blobs'),
    0,
    found,
  );
  found.sort((left, right) => left.name.localeCompare(right.name));
  return found;
}
