import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { ZodError } from 'zod';
import { resolveCorsOrigins } from '../configs/corsOrigins.js';
import { resolveMongoUri } from '../configs/mongoUri.js';
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

  const parsed = envSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StartupError(messageFromZod(parsed.error));
  }

  const nodeEnv = parsed.data.NODE_ENV ?? 'development';
  const host = parsed.data.HOST ?? DEFAULT_HOST;
  const port = resolvePort(parsed.data.PORT);
  const mongoUri = resolveMongoUri(parsed.data.MONGO_URI);
  const corsOrigins = resolveCorsOrigins(parsed.data.CORS_ORIGINS);

  return { nodeEnv, host, port, mongoUri, corsOrigins };
}
