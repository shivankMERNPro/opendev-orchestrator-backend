import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { OllamaLibraryClient } from './libraryClient.js';
import {
  defaultOllamaModelsDirectory,
  readLocalInstalledModels,
} from './localModels.js';
import type { InstalledModel } from './normalize.js';
import { selectParameterTags, type ParameterVariant } from './parameterTags.js';

export interface DiskSpace {
  freeBytes: number | null;
  totalBytes: number | null;
  memoryFreeBytes: number;
  memoryTotalBytes: number;
}

export type DownloadFit =
  'enough' | 'not-enough' | 'unknown' | 'already-installed';

export interface DownloadAssessment {
  model: string;
  freeBytes: number | null;
  totalBytes: number | null;
  memoryFreeBytes: number | null;
  memoryTotalBytes: number | null;
  modelBytes: number | null;
  alreadyInstalled: boolean;
  fit: DownloadFit;
}

export interface VariantListing {
  model: string;
  source: 'ollama-library' | 'local-manifest' | 'unavailable';
  variants: Array<ParameterVariant & { installed: boolean }>;
}

export interface ModelAssist {
  listLocal(): Promise<InstalledModel[]>;
  variants(modelName: string, signal: AbortSignal): Promise<VariantListing>;
  assess(model: string, signal: AbortSignal): Promise<DownloadAssessment>;
}

async function measureDisk(directory: string): Promise<DiskSpace> {
  const memoryFreeBytes = os.freemem();
  const memoryTotalBytes = os.totalmem();
  try {
    const stats = await statfs(directory);
    return {
      freeBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize,
      memoryFreeBytes,
      memoryTotalBytes,
    };
  } catch {
    return {
      freeBytes: null,
      totalBytes: null,
      memoryFreeBytes,
      memoryTotalBytes,
    };
  }
}

function splitModel(model: string): { name: string; tag: string } | null {
  const separator = model.lastIndexOf(':');
  if (separator <= 0 || separator === model.length - 1) {
    return null;
  }
  return {
    name: model.slice(0, separator),
    tag: model.slice(separator + 1),
  };
}

export function createModelAssist(options?: {
  modelsDirectory?: string;
  library?: OllamaLibraryClient;
  disk?: () => Promise<DiskSpace>;
  localModels?: InstalledModel[];
}): ModelAssist {
  const modelsDirectory =
    options?.modelsDirectory ?? defaultOllamaModelsDirectory();
  const library = options?.library;
  const disk = options?.disk ?? (() => measureDisk(modelsDirectory));

  async function localModels(): Promise<InstalledModel[]> {
    if (options?.localModels !== undefined) {
      return options.localModels;
    }
    return readLocalInstalledModels(modelsDirectory);
  }

  return {
    listLocal: localModels,

    async variants(modelName, signal) {
      const installed = await localModels();
      const localTags = selectParameterTags(
        installed
          .filter((model) => model.name.startsWith(`${modelName}:`))
          .map((model) => model.name.slice(modelName.length + 1)),
      );
      const remote =
        library === undefined
          ? null
          : await library.listParameterTags(modelName, signal);
      const chosen = remote ?? localTags;
      const source =
        remote !== null
          ? 'ollama-library'
          : localTags.length > 0
            ? 'local-manifest'
            : 'unavailable';
      const installedTags = new Set(localTags.map((variant) => variant.tag));
      return {
        model: modelName,
        source,
        variants: chosen.map((variant) => ({
          ...variant,
          installed: installedTags.has(variant.tag),
        })),
      };
    },

    async assess(model, signal) {
      const installed = (await localModels()).find(
        (entry) => entry.name === model,
      );
      const space = await disk();
      const parts = splitModel(model);
      let modelBytes = installed?.sizeBytes ?? null;
      if (modelBytes === null && parts !== null && library !== undefined) {
        modelBytes = await library.manifestSize(parts.name, parts.tag, signal);
      }

      let fit: DownloadFit = 'unknown';
      if (installed !== undefined) {
        fit = 'already-installed';
      } else if (
        modelBytes !== null &&
        space.freeBytes !== null &&
        space.freeBytes < modelBytes
      ) {
        fit = 'not-enough';
      } else if (modelBytes !== null && space.freeBytes !== null) {
        fit = 'enough';
      }

      return {
        model,
        freeBytes: space.freeBytes,
        totalBytes: space.totalBytes,
        memoryFreeBytes: space.memoryFreeBytes,
        memoryTotalBytes: space.memoryTotalBytes,
        modelBytes,
        alreadyInstalled: installed !== undefined,
        fit,
      };
    },
  };
}
