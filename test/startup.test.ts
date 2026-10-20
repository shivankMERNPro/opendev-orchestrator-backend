import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startServer } from '../src/server.js';
import { StartupError } from '../src/utils/startupError.js';

const LOCAL_URI =
  'mongodb://operator:sentinel-9f3a2c@127.0.0.1:27017/opendev-orchestrator';

describe('startup bind guard', () => {
  it('rejects non-loopback hosts before connecting to MongoDB', async () => {
    for (const host of ['0.0.0.0', '::', '192.0.2.1']) {
      let called = false;
      await assert.rejects(
        () =>
          startServer(
            {
              NODE_ENV: 'test',
              HOST: host,
              PORT: '3001',
              MONGO_URI: LOCAL_URI,
            },
            {
              connectDatabase: () => {
                called = true;
                return Promise.reject(new Error('should not connect'));
              },
            },
          ),
        (error: unknown) => {
          assert.ok(error instanceof StartupError);
          assert.equal(error.message, 'HOST must be a loopback address');
          assert.equal(error.message.includes('sentinel-9f3a2c'), false);
          return true;
        },
      );
      assert.equal(called, false);
    }
  });

  it('does not listen when the database connection fails', async () => {
    await assert.rejects(
      () =>
        startServer(
          {
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            PORT: '0',
            MONGO_URI: LOCAL_URI,
          },
          {
            connectDatabase: (uri) => {
              assert.equal(uri, LOCAL_URI);
              return Promise.reject(new Error(`connect failed ${uri}`));
            },
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'Database connection failed');
        assert.equal(error.message.includes('sentinel-9f3a2c'), false);
        assert.equal(error.message.includes('mongodb://'), false);
        return true;
      },
    );
  });

  it('rejects a public CORS origin before connecting', async () => {
    let called = false;
    await assert.rejects(
      () =>
        startServer(
          {
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            PORT: '0',
            MONGO_URI: LOCAL_URI,
            CORS_ORIGINS: 'https://public.example',
          },
          {
            connectDatabase: () => {
              called = true;
              return Promise.reject(new Error('should not connect'));
            },
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'CORS_ORIGINS must use a loopback origin');
        assert.equal(error.message.includes('public.example'), false);
        assert.equal(error.message.includes('sentinel-9f3a2c'), false);
        return true;
      },
    );
    assert.equal(called, false);
  });
});
