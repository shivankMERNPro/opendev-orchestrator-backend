import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DatabaseConnection } from '../src/configs/dbConnectionConfig.js';
import { startServer, type RunningServer } from '../src/server.js';
import { request } from './helpers.js';

const LOCAL_URI =
  'mongodb://operator:sentinel-9f3a2c@127.0.0.1:27017/opendev-orchestrator';

function connectedDatabase(): DatabaseConnection {
  return {
    getHealth: () => ({ status: 'connected' }),
    close: () => Promise.resolve(),
  };
}

describe('GET /api/v1/health', () => {
  it('returns the shared envelope and consistent errors', async () => {
    let running: RunningServer | undefined;
    try {
      running = await startServer(
        {
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '0',
          MONGO_URI: LOCAL_URI,
        },
        { connectDatabase: () => Promise.resolve(connectedDatabase()) },
      );

      const health = await request(running.port, '/api/v1/health');
      assert.equal(health.status, 200);
      assert.match(health.contentType, /application\/json/);
      const body: unknown = JSON.parse(health.body);
      assert.deepEqual(body, {
        success: true,
        code: 200,
        message: 'Success',
        data: {
          status: 'ok',
          apiVersion: 'v1',
          schemaVersion: 0,
          networkedIntegrations: [],
          database: 'connected',
        },
      });
      assert.equal(health.body.includes('sentinel-9f3a2c'), false);
      assert.equal(health.body.includes('mongodb://'), false);
      assert.equal(health.body.includes('stack'), false);

      const missing = await request(running.port, '/api/v1/missing');
      assert.equal(missing.status, 404);
      assert.deepEqual(JSON.parse(missing.body), {
        success: false,
        code: 404,
        message: 'Resource not found',
      });

      const forbidden = await request(running.port, '/api/v1/health', {
        headers: { Host: 'evil.example' },
      });
      assert.equal(forbidden.status, 403);
      assert.deepEqual(JSON.parse(forbidden.body), {
        success: false,
        code: 403,
        message: 'Forbidden',
      });
      assert.equal(forbidden.body.includes('evil.example'), false);

      const invalidJson = await request(running.port, '/api/v1/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      assert.equal(invalidJson.status, 400);
      assert.deepEqual(JSON.parse(invalidJson.body), {
        success: false,
        code: 400,
        message: 'Invalid JSON body',
      });
      assert.equal(invalidJson.body.includes('Unexpected'), false);
      assert.equal(invalidJson.body.includes('stack'), false);
    } finally {
      if (running !== undefined) {
        await running.close();
      }
    }
  });

  it('reports an unhealthy status when the database is disconnected', async () => {
    let running: RunningServer | undefined;
    try {
      running = await startServer(
        {
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '0',
          MONGO_URI: LOCAL_URI,
        },
        {
          connectDatabase: () =>
            Promise.resolve({
              getHealth: () => ({ status: 'disconnected' }),
              close: () => Promise.resolve(),
            }),
        },
      );

      const health = await request(running.port, '/api/v1/health');
      assert.equal(health.status, 503);
      assert.deepEqual(JSON.parse(health.body), {
        success: false,
        code: 503,
        message: 'Database unavailable',
        data: {
          status: 'unavailable',
          apiVersion: 'v1',
          schemaVersion: 0,
          networkedIntegrations: [],
          database: 'disconnected',
        },
      });
      assert.equal(health.body.includes('sentinel-9f3a2c'), false);
      assert.equal(health.body.includes('mongodb://'), false);
      assert.equal(health.body.includes('stack'), false);
    } finally {
      if (running !== undefined) {
        await running.close();
      }
    }
  });

  it('allows only the configured loopback origin', async () => {
    let running: RunningServer | undefined;
    try {
      running = await startServer(
        {
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: '0',
          MONGO_URI: LOCAL_URI,
          CORS_ORIGINS: 'http://127.0.0.1:5173',
        },
        { connectDatabase: () => Promise.resolve(connectedDatabase()) },
      );

      const allowed = await request(running.port, '/api/v1/health', {
        headers: { Origin: 'http://127.0.0.1:5173' },
      });
      assert.equal(allowed.accessControlAllowOrigin, 'http://127.0.0.1:5173');

      const blocked = await request(running.port, '/api/v1/health', {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(blocked.accessControlAllowOrigin, undefined);
      assert.equal(blocked.body.includes('evil.example'), false);
    } finally {
      if (running !== undefined) {
        await running.close();
      }
    }
  });
});
