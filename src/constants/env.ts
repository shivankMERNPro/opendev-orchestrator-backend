import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { ZodError } from 'zod';
import { resolveCorsOrigins } from '../configs/corsOrigins.js';
import { resolveMongoUri } from '../configs/mongoUri.js';
import {
  DEFAULT_OLLAMA_MAX_CONCURRENT_PULLS,
  DEFAULT_OLLAMA_PULL_TIMEOUT_MS,
  DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
  resolveOllamaBaseUrl,
  resolveOllamaLimit,
} from '../configs/ollamaEndpoint.js';
import type { AppConfig } from '../types/config.type.js';
import { envSchema } from '../validationSchemas/env.schema.js';
import { StartupError } from '../utils/startupError.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3001;

function messageFromZod(error: ZodError): string {
  const key = error.issues[0]?.path[0];
  switch (key) {
    case 'MONGO_URI':
      return 'MONGO_URI is invalid';
    case 'CORS_ORIGINS':
      return 'CORS_ORIGINS is invalid';
    case 'PORT':
      return 'PORT is invalid';
    case 'HOST':
      return 'HOST is invalid';
    case 'NODE_ENV':
      return 'NODE_ENV is invalid';
    case 'OLLAMA_BASE_URL':
      return 'OLLAMA_BASE_URL is invalid';
    case 'OLLAMA_MAX_CONCURRENT_PULLS':
      return 'OLLAMA_MAX_CONCURRENT_PULLS is invalid';
    case 'OLLAMA_REQUEST_TIMEOUT_MS':
      return 'OLLAMA_REQUEST_TIMEOUT_MS is invalid';
    case 'OLLAMA_PULL_TIMEOUT_MS':
      return 'OLLAMA_PULL_TIMEOUT_MS is invalid';
    default:
      return 'configuration is invalid';
  }
}

function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new StartupError('PORT is invalid');
  }

  return port;
}

export function loadLocalEnvFile(directory = process.cwd()): void {
  const envFile = path.resolve(directory, '.env');
  if (!fs.existsSync(envFile)) {
    return;
  }

  const result = loadDotenv({
    path: envFile,
    quiet: true,
    override: false,
  });
  if (result.error) {
    throw new StartupError('The environment file could not be read');
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const candidate: {
    MONGO_URI?: string;
    CORS_ORIGINS?: string;
    NODE_ENV?: string;
    HOST?: string;
    PORT?: string;
    OLLAMA_BASE_URL?: string;
    OLLAMA_MAX_CONCURRENT_PULLS?: string;
    OLLAMA_REQUEST_TIMEOUT_MS?: string;
    OLLAMA_PULL_TIMEOUT_MS?: string;
  } = {};

  if (typeof env.NODE_ENV === 'string') {
    candidate.NODE_ENV = env.NODE_ENV.trim();
  }
  if (typeof env.HOST === 'string') {
    const host = env.HOST.trim();
    if (host.length === 0) {
      throw new StartupError('HOST is invalid');
    }
    candidate.HOST = host;
  }
  if (typeof env.PORT === 'string') {
    candidate.PORT = env.PORT.trim();
  }
  if (typeof env.MONGO_URI === 'string' && env.MONGO_URI.trim().length > 0) {
    candidate.MONGO_URI = env.MONGO_URI.trim();
  }
  if (
    typeof env.CORS_ORIGINS === 'string' &&
    env.CORS_ORIGINS.trim().length > 0
  ) {
    candidate.CORS_ORIGINS = env.CORS_ORIGINS.trim();
  }
  if (
    typeof env.OLLAMA_BASE_URL === 'string' &&
    env.OLLAMA_BASE_URL.trim().length > 0
  ) {
    candidate.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL.trim();
  }
  if (typeof env.OLLAMA_MAX_CONCURRENT_PULLS === 'string') {
    candidate.OLLAMA_MAX_CONCURRENT_PULLS =
      env.OLLAMA_MAX_CONCURRENT_PULLS.trim();
  }
  if (typeof env.OLLAMA_REQUEST_TIMEOUT_MS === 'string') {
    candidate.OLLAMA_REQUEST_TIMEOUT_MS = env.OLLAMA_REQUEST_TIMEOUT_MS.trim();
  }
  if (typeof env.OLLAMA_PULL_TIMEOUT_MS === 'string') {
    candidate.OLLAMA_PULL_TIMEOUT_MS = env.OLLAMA_PULL_TIMEOUT_MS.trim();
  }

  const parsed = envSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StartupError(messageFromZod(parsed.error));
  }

  const nodeEnv = parsed.data.NODE_ENV ?? 'development';
  const host = parsed.data.HOST ?? DEFAULT_HOST;
  const port = resolvePort(parsed.data.PORT);
  const mongoUri = resolveMongoUri(parsed.data.MONGO_URI);
  const corsOrigins = resolveCorsOrigins(parsed.data.CORS_ORIGINS);
  const ollamaBaseUrl = resolveOllamaBaseUrl(parsed.data.OLLAMA_BASE_URL);
  const ollamaMaxConcurrentPulls = resolveOllamaLimit(
    parsed.data.OLLAMA_MAX_CONCURRENT_PULLS,
    DEFAULT_OLLAMA_MAX_CONCURRENT_PULLS,
    1,
    2,
    'OLLAMA_MAX_CONCURRENT_PULLS is invalid',
  );
  const ollamaRequestTimeoutMs = resolveOllamaLimit(
    parsed.data.OLLAMA_REQUEST_TIMEOUT_MS,
    DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
    500,
    30_000,
    'OLLAMA_REQUEST_TIMEOUT_MS is invalid',
  );
  const ollamaPullTimeoutMs = resolveOllamaLimit(
    parsed.data.OLLAMA_PULL_TIMEOUT_MS,
    DEFAULT_OLLAMA_PULL_TIMEOUT_MS,
    1000,
    3_600_000,
    'OLLAMA_PULL_TIMEOUT_MS is invalid',
  );

  return {
    nodeEnv,
    host,
    port,
    mongoUri,
    corsOrigins,
    ollamaBaseUrl,
    ollamaMaxConcurrentPulls,
    ollamaRequestTimeoutMs,
    ollamaPullTimeoutMs,
  };
}
