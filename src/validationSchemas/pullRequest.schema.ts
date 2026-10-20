import { z } from 'zod';

export const pullRequestSchema = z
  .object({
    model: z.string(),
    tag: z.string().optional(),
  })
  .strict();

export type PullRequestInput = z.infer<typeof pullRequestSchema>;
