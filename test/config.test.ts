import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MONGO_URI } from '../src/configs/mongoUri.js';
import { DEFAULT_OLLAMA_BASE_URL } from '../src/configs/ollamaEndpoint.js';
import { DEFAULT_PORT, loadConfig } from '../src/constants/env.js';
import { StartupError } from '../src/utils/startupError.js';

const LOCAL_URI = 'mongodb://127.0.0.1:27017/opendev-orchestrator';

describe('configuration', () => {
  it('defaults to local MongoDB and port 3001', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    assert.equal(config.mongoUri, DEFAULT_MONGO_URI);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.port, 3001);
    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.ollamaBaseUrl, DEFAULT_OLLAMA_BASE_URL);
    assert.equal(config.ollamaMaxConcurrentPulls, 1);
  });

  it('accepts the configured local connection string', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: '3001',
      MONGO_URI: LOCAL_URI,
    });
    assert.equal(config.mongoUri, LOCAL_URI);
    assert.equal(config.port, 3001);
  });

  it('rejects a remote database without echoing the connection string', () => {
    const mongoUri =
      'mongodb://operator:sentinel-9f3a2c@db.example.com:27017/opendev-orchestrator';
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          MONGO_URI: mongoUri,
        }),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(
          error.message,
          'MONGO_URI must use the local MongoDB instance',
        );
        assert.equal(error.message.includes('sentinel-9f3a2c'), false);
        assert.equal(error.message.includes('db.example.com'), false);
        return true;
      },
    );
  });

  it('rejects an invalid connection string without echoing it', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          MONGO_URI: 'http://127.0.0.1:27017/sentinel-9f3a2c',
        }),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'MONGO_URI is invalid');
        assert.equal(error.message.includes('sentinel-9f3a2c'), false);
        return true;
      },
    );
  });

  it('rejects invalid PORT and NODE_ENV without echoing the value', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          PORT: 'not-a-port',
          MONGO_URI: LOCAL_URI,
        }),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'PORT is invalid');
        assert.equal(error.message.includes('not-a-port'), false);
        return true;
      },
    );
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'staging',
          MONGO_URI: LOCAL_URI,
        }),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'NODE_ENV is invalid');
        assert.equal(error.message.includes('staging'), false);
        return true;
      },
    );
  });

  it('rejects a public CORS origin without echoing it', () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'development',
          HOST: '127.0.0.1',
          CORS_ORIGINS: 'https://evil.example',
          MONGO_URI: LOCAL_URI,
        }),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'CORS_ORIGINS must use a loopback origin');
        assert.equal(error.message.includes('evil.example'), false);
        return true;
      },
    );
  });

  it('rejects a non-loopback Ollama URL without echoing it', () => {
    for (const ollamaBaseUrl of [
      'http://db.example:11434',
      'http://192.168.1.20:11434',
      'http://10.0.0.8:11434',
      'http://user:sentinel-9f3a2c@127.0.0.1:11434',
      'http://127.0.0.1:11434/api',
    ]) {
      assert.throws(
        () =>
          loadConfig({
            NODE_ENV: 'development',
            OLLAMA_BASE_URL: ollamaBaseUrl,
          }),
        (error: unknown) => {
          assert.ok(error instanceof StartupError);
          assert.equal(error.message.includes('sentinel-9f3a2c'), false);
          assert.equal(error.message.includes('db.example'), false);
          assert.equal(error.message.includes('192.168.1.20'), false);
          assert.equal(error.message.includes('/api'), false);
          assert.ok(
            error.message === 'OLLAMA_BASE_URL is invalid' ||
              error.message === 'OLLAMA_BASE_URL must use a loopback address',
          );
          return true;
        },
      );
    }
  });
});
