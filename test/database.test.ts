import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertLocalMongoUri,
  DEFAULT_MONGO_URI,
  resolveMongoUri,
} from '../src/configs/mongoUri.js';
import { StartupError } from '../src/utils/startupError.js';

describe('MongoDB connection string', () => {
  it('uses the local default when the variable is missing', () => {
    assert.equal(resolveMongoUri(undefined), DEFAULT_MONGO_URI);
    assert.equal(resolveMongoUri('   '), DEFAULT_MONGO_URI);
  });

  it('accepts loopback hosts and a database name', () => {
    const uri = 'mongodb://127.0.0.1:27017/opendev-orchestrator';
    assert.equal(assertLocalMongoUri(uri), uri);
    assert.equal(
      assertLocalMongoUri('mongodb://localhost:27017/opendev-orchestrator'),
      'mongodb://localhost:27017/opendev-orchestrator',
    );
    assert.equal(
      assertLocalMongoUri('mongodb://[::1]:27017/opendev-orchestrator'),
      'mongodb://[::1]:27017/opendev-orchestrator',
    );
  });

  it('keeps credentials in the returned string and out of the error text', () => {
    const uri =
      'mongodb://operator:sentinel-9f3a2c@127.0.0.1:27017/opendev-orchestrator';
    assert.equal(assertLocalMongoUri(uri), uri);

    assert.throws(
      () =>
        assertLocalMongoUri(
          'mongodb+srv://operator:sentinel-9f3a2c@cluster.example/opendev',
        ),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(
          error.message,
          'MONGO_URI must use the local MongoDB instance',
        );
        assert.equal(error.message.includes('sentinel-9f3a2c'), false);
        return true;
      },
    );
  });

  it('requires a database name', () => {
    assert.throws(
      () => assertLocalMongoUri('mongodb://127.0.0.1:27017'),
      (error: unknown) => {
        assert.ok(error instanceof StartupError);
        assert.equal(error.message, 'MONGO_URI is invalid');
        return true;
      },
    );
  });
});
