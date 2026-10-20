import type { DatabaseConnection } from '../configs/dbConnectionConfig.js';
import type { HealthData } from '../types/health.type.js';

const FOUNDATION_SCHEMA_VERSION = 0;

export function createHealthService(database: DatabaseConnection) {
  return {
    getHealth(): HealthData {
      const databaseHealth = database.getHealth();
      const networkedIntegrations: [] = [];
      return {
        status: databaseHealth.status === 'connected' ? 'ok' : 'unavailable',
        apiVersion: 'v1',
        schemaVersion: FOUNDATION_SCHEMA_VERSION,
        database: databaseHealth.status,
        networkedIntegrations,
      };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
