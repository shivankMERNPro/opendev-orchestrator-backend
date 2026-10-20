export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  mongoUri: string;
  corsOrigins: readonly string[];
}
