import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().trim().min(1).optional(),
  PORT: z
    .string()
    .regex(/^\d{1,5}$/)
    .optional(),
  MONGO_URI: z.string().trim().min(1).optional(),
  CORS_ORIGINS: z.string().trim().min(1).optional(),
  OLLAMA_BASE_URL: z.string().trim().min(1).optional(),
  OLLAMA_MAX_CONCURRENT_PULLS: z.string().regex(/^\d+$/).optional(),
  OLLAMA_REQUEST_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
  OLLAMA_PULL_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
});

export type EnvInput = z.infer<typeof envSchema>;
