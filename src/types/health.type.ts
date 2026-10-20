export interface DatabaseHealth {
  status: 'connected' | 'disconnected';
}

export interface HealthData {
  status: 'ok' | 'unavailable';
  apiVersion: 'v1';
  schemaVersion: number;
  database: 'connected' | 'disconnected';
  networkedIntegrations: [];
}
