import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { DatabaseConnection } from '../src/configs/dbConnectionConfig.js';
import { createHttpOllamaClient } from '../src/services/ollama/client.js';
import { OllamaRequestError } from '../src/services/ollama/errors.js';
import type { OllamaClient } from '../src/services/ollama/client.js';
import { interpretPullEvent } from '../src/services/ollama/normalize.js';
import { createPullCoordinator } from '../src/services/ollama/pullCoordinator.js';
import type { ModelAssist } from '../src/services/ollama/modelAssist.js';
import { readLocalInstalledModels } from '../src/services/ollama/localModels.js';
import { selectParameterTags } from '../src/services/ollama/parameterTags.js';
import { startServer, type RunningServer } from '../src/server.js';
import { request } from './helpers.js';

const LOCAL_URI = 'mongodb://127.0.0.1:27017/opendev-orchestrator';
const DIGEST = `sha256:${'ab'.repeat(32)}`;

function connectedDatabase(): DatabaseConnection {
  return {
    getHealth: () => ({ status: 'connected' }),
    close: () => Promise.resolve(),
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function hexId(prefix: string, value: number): string {
  return `${prefix}-${value.toString(16).padStart(12, '0')}`;
}

interface HeldPull {
  client: OllamaClient;
  emit(event: unknown): void;
  finish(): void;
}

function heldPull(base: Partial<OllamaClient> = {}): HeldPull {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  const client: OllamaClient = {
    getVersion: () => Promise.resolve({ version: '0.0.0-test' }),
    getTags: () => Promise.resolve({ models: [] }),
    getRunning: () => Promise.resolve({ models: [] }),
    ...base,
    async pullModel(_name, options) {
      while (!done || queue.length > 0) {
        if (options.signal.aborted) {
          throw new Error('aborted');
        }
        const event = queue.shift();
        if (event !== undefined) {
          options.onEvent(event);
          continue;
        }
        if (done) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          options.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      }
    },
  };
  return {
    client,
    emit(event: unknown) {
      queue.push(event);
      wake?.();
    },
    finish() {
      done = true;
      wake?.();
    },
  };
}

function permissiveAssist(): ModelAssist {
  return {
    listLocal: () => Promise.resolve([]),
    variants: (modelName) =>
      Promise.resolve({
        model: modelName,
        source: 'unavailable',
        variants: [],
      }),
    assess: (model) =>
      Promise.resolve({
        model,
        freeBytes: 50_000_000_000,
        totalBytes: 100_000_000_000,
        memoryFreeBytes: 8_000_000_000,
        memoryTotalBytes: 16_000_000_000,
        modelBytes: null,
        alreadyInstalled: false,
        fit: 'unknown',
      }),
  };
}

async function withServer(
  client: OllamaClient,
  env: NodeJS.ProcessEnv,
  run: (port: number) => Promise<void>,
  assist: ModelAssist = permissiveAssist(),
): Promise<void> {
  let running: RunningServer | undefined;
  try {
    running = await startServer(
      {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '0',
        MONGO_URI: LOCAL_URI,
        ...env,
      },
      {
        connectDatabase: () => Promise.resolve(connectedDatabase()),
        ollamaClient: client,
        modelAssist: assist,
      },
    );
    await run(running.port);
  } finally {
    await running?.close();
  }
}

describe('Ollama model normalization', () => {
  it('normalizes an installed model and an empty list', async () => {
    const installed = {
      models: [
        {
          name: 'llama3.2:latest',
          modified_at: '2024-08-01T00:00:00.000Z',
          size: 1234,
          digest: DIGEST,
          details: {
            format: 'gguf',
            family: 'llama',
            families: ['llama'],
            parameter_size: '3.2B',
            quantization_level: 'Q4_K_M',
          },
        },
      ],
    };
    const held = heldPull({
      getTags: () => Promise.resolve(installed),
    });
    await withServer(held.client, {}, async (port) => {
      const response = await request(port, '/api/v1/models');
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.body), {
        success: true,
        code: 200,
        message: 'Success',
        data: {
          source: 'ollama',
          daemon: 'available',
          models: [
            {
              name: 'llama3.2:latest',
              identifier: DIGEST,
              sizeBytes: 1234,
              family: 'llama',
              families: ['llama'],
              parameterSize: '3.2B',
              quantization: 'Q4_K_M',
              format: 'gguf',
              modifiedAt: '2024-08-01T00:00:00.000Z',
            },
          ],
        },
      });

      const emptyClient = heldPull({
        getTags: () => Promise.resolve({ models: [] }),
      });
      await withServer(emptyClient.client, {}, async (emptyPort) => {
        const empty = await request(emptyPort, '/api/v1/models');
        assert.equal(empty.status, 200);
        assert.deepEqual(JSON.parse(empty.body), {
          success: true,
          code: 200,
          message: 'Success',
          data: { models: [], source: 'ollama', daemon: 'available' },
        });
      });
    });
  });

  it('normalizes models loaded in memory', async () => {
    const held = heldPull({
      getRunning: () =>
        Promise.resolve({
          models: [
            {
              name: 'llama3.2:latest',
              size: 99,
              size_vram: 50,
              digest: DIGEST,
              expires_at: '2024-08-01T01:00:00.000Z',
              details: { family: 'llama', parameter_size: '3.2B' },
            },
          ],
        }),
    });
    await withServer(held.client, {}, async (port) => {
      const response = await request(port, '/api/v1/models/runtime');
      assert.equal(response.status, 200);
      const body = JSON.parse(response.body) as {
        data: { models: Array<{ vramBytes: number; expiresAt: string }> };
      };
      assert.equal(body.data.models[0]?.vramBytes, 50);
      assert.equal(body.data.models[0]?.expiresAt, '2024-08-01T01:00:00.000Z');
    });
  });

  it('reports unavailable and invalid upstream responses without raw details', async () => {
    const down = heldPull({
      getVersion: () => Promise.reject(new OllamaRequestError('unavailable')),
      getTags: () => Promise.reject(new OllamaRequestError('timeout')),
    });
    await withServer(down.client, {}, async (port) => {
      const status = await request(port, '/api/v1/models/status');
      assert.equal(status.status, 200);
      assert.deepEqual(JSON.parse(status.body), {
        success: true,
        code: 200,
        message: 'Ollama is unavailable.',
        data: { status: 'unavailable' },
      });
      assert.equal(status.body.includes('11434'), false);

      const models = await request(port, '/api/v1/models');
      assert.equal(models.status, 200);
      assert.equal(JSON.parse(models.body).data.source, 'local-manifest');
      assert.equal(JSON.parse(models.body).data.daemon, 'unavailable');
      assert.deepEqual(JSON.parse(models.body).data.models, []);
      assert.equal(models.body.includes('11434'), false);
      assert.equal(models.body.includes('Database unavailable'), false);
    });

    const invalid = heldPull({
      getVersion: () => Promise.resolve({ version: 'not a version' }),
      getTags: () => Promise.resolve({ models: [{ name: '' }] }),
    });
    await withServer(invalid.client, {}, async (port) => {
      const status = await request(port, '/api/v1/models/status');
      assert.equal(status.status, 200);
      assert.equal(JSON.parse(status.body).data.status, 'invalid');
      const models = await request(port, '/api/v1/models');
      assert.equal(models.status, 502);
      assert.equal(
        JSON.parse(models.body).message,
        'Ollama returned an unexpected response.',
      );
      assert.notDeepEqual(JSON.parse(models.body).data, { models: [] });
    });
  });

  it('rejects model URLs and malformed identifiers without echoing them', async () => {
    const held = heldPull();
    await withServer(held.client, {}, async (port) => {
      for (const body of [
        { model: 'http://evil.example/llama' },
        { model: '../../etc/passwd' },
        { model: 'llama3.2', url: 'http://evil.example/pull' },
        { model: 'llama3.2', tag: '../latest' },
      ]) {
        const response = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 400);
        assert.equal(
          JSON.parse(response.body).message,
          'The model identifier is invalid.',
        );
        assert.equal(response.body.includes('evil.example'), false);
        assert.equal(response.body.includes('passwd'), false);
      }
    });
  });
});

describe('Ollama downloads', () => {
  it('starts a download, reports real progress, and leaves missing totals indeterminate', async () => {
    const held = heldPull();
    await withServer(held.client, {}, async (port) => {
      const started = await request(port, '/api/v1/models/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2', tag: 'latest' }),
      });
      assert.equal(started.status, 202);
      const created = JSON.parse(started.body) as {
        data: { job: { id: string; model: string; state: string } };
      };
      assert.equal(created.data.job.model, 'llama3.2:latest');
      assert.equal(created.data.job.state, 'queued');
      const jobId = created.data.job.id;

      await settle();
      held.emit({ status: 'downloading' });
      await settle();
      const indeterminate = await request(port, `/api/v1/models/pull/${jobId}`);
      const open = JSON.parse(indeterminate.body) as {
        data: {
          job: {
            progressPercent: number | null;
            bytesTotal: number | null;
            state: string;
          };
        };
      };
      assert.equal(open.data.job.state, 'downloading');
      assert.equal(open.data.job.progressPercent, null);
      assert.equal(open.data.job.bytesTotal, null);

      held.emit({ status: 'downloading', completed: 1, total: 4 });
      await settle();
      const partial = await request(port, `/api/v1/models/pull/${jobId}`);
      assert.equal(JSON.parse(partial.body).data.job.progressPercent, 25);
      assert.equal(JSON.parse(partial.body).data.job.bytesCompleted, 1);
      assert.equal(JSON.parse(partial.body).data.job.bytesTotal, 4);

      held.emit({ status: 'success', completed: 4, total: 4 });
      held.finish();
      await settle();
      const done = await request(port, `/api/v1/models/pull/${jobId}`);
      assert.equal(JSON.parse(done.body).data.job.state, 'completed');
      assert.equal(JSON.parse(done.body).data.job.progressPercent, 100);
    });
  });

  it('does not invent a percentage when success omits the total', () => {
    const event = interpretPullEvent({ status: 'success' });
    assert.equal(event.kind, 'success');
    if (event.kind === 'success') {
      assert.equal(event.progressPercent, null);
    }
  });

  it('fails a download without exposing the upstream error and allows retry', async () => {
    const held = heldPull();
    await withServer(held.client, {}, async (port) => {
      const started = await request(port, '/api/v1/models/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'phi3' }),
      });
      const firstId = JSON.parse(started.body).data.job.id as string;
      await settle();
      held.emit({ error: 'manifest http://evil.example/secret-blob' });
      held.finish();
      await settle();
      const failed = await request(port, `/api/v1/models/pull/${firstId}`);
      assert.equal(JSON.parse(failed.body).data.job.state, 'failed');
      assert.equal(JSON.parse(failed.body).data.job.errorCode, 'pull_failed');
      assert.equal(failed.body.includes('evil.example'), false);
      assert.equal(failed.body.includes('secret-blob'), false);

      const retry = await request(port, '/api/v1/models/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'phi3' }),
      });
      assert.equal(retry.status, 202);
      assert.notEqual(JSON.parse(retry.body).data.job.id, firstId);
    });
  });

  it('prevents duplicate and extra concurrent downloads', async () => {
    const held = heldPull();
    await withServer(
      held.client,
      { OLLAMA_MAX_CONCURRENT_PULLS: '1' },
      async (port) => {
        const first = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'mistral' }),
        });
        assert.equal(first.status, 202);
        const jobId = JSON.parse(first.body).data.job.id as string;

        const duplicate = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'mistral' }),
        });
        assert.equal(duplicate.status, 409);
        assert.equal(JSON.parse(duplicate.body).data.job.id, jobId);

        const second = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'gemma2' }),
        });
        assert.equal(second.status, 429);
        assert.equal(
          JSON.parse(second.body).message,
          'The download limit has been reached.',
        );
      },
    );
  });

  it('hides unknown jobs and cancels an active download', async () => {
    const held = heldPull();
    await withServer(held.client, {}, async (port) => {
      const missing = await request(
        port,
        '/api/v1/models/pull/not-a-job-sentinel',
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.body.includes('not-a-job-sentinel'), false);

      const started = await request(port, '/api/v1/models/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gemma2' }),
      });
      const jobId = JSON.parse(started.body).data.job.id as string;
      const cancelled = await request(port, `/api/v1/models/pull/${jobId}`, {
        method: 'DELETE',
      });
      assert.equal(cancelled.status, 200);
      assert.equal(JSON.parse(cancelled.body).data.job.state, 'cancelled');
      assert.equal(JSON.parse(cancelled.body).message, 'Download cancelled.');
      await settle();
      const current = await request(port, `/api/v1/models/pull/${jobId}`);
      assert.equal(JSON.parse(current.body).data.job.state, 'cancelled');
      const again = await request(port, `/api/v1/models/pull/${jobId}`, {
        method: 'DELETE',
      });
      assert.equal(again.status, 409);
    });
  });

  it('keeps only a bounded number of finished jobs', async () => {
    let count = 0;
    const ids: string[] = [];
    const coordinator = createPullCoordinator({
      maxConcurrent: 1,
      pullTimeoutMs: 1000,
      createId: () => {
        count += 1;
        const id = hexId('00000000-0000-4000-8000', count);
        ids.push(id);
        return id;
      },
      client: {
        getVersion: () => Promise.resolve({ version: '0' }),
        getTags: () => Promise.resolve({ models: [] }),
        getRunning: () => Promise.resolve({ models: [] }),
        pullModel: () => Promise.reject(new OllamaRequestError('unavailable')),
      },
    });

    for (let index = 0; index < 21; index += 1) {
      const started = coordinator.start(`model${String(index)}`);
      assert.equal(started.kind, 'created');
      await settle();
    }

    assert.equal(coordinator.get(ids[0] ?? ''), null);
    const newest = coordinator.get(ids[20] ?? '');
    assert.equal(newest?.state, 'failed');
    assert.equal(newest?.errorCode, 'ollama_unavailable');
    coordinator.shutdown();
  });

  it('serves a curated catalog and rejects a remote query', async () => {
    const held = heldPull();
    await withServer(held.client, {}, async (port) => {
      const catalog = await request(port, '/api/v1/models/catalog');
      const body = JSON.parse(catalog.body) as {
        message: string;
        data: {
          source: string;
          complete: boolean;
          models: Array<Record<string, unknown>>;
        };
      };
      assert.equal(body.data.source, 'curated');
      assert.equal(body.data.complete, false);
      assert.equal(body.message.includes('not a complete'), true);
      assert.ok(body.data.models.some((model) => model.name === 'llama3.2'));
      assert.deepEqual(Object.keys(body.data.models[0] ?? {}).sort(), [
        'name',
        'note',
      ]);

      const filtered = await request(
        port,
        '/api/v1/models/catalog?q=nomic-embed',
      );
      assert.equal(JSON.parse(filtered.body).data.models.length, 1);

      const rejected = await request(
        port,
        '/api/v1/models/catalog?q=http://evil.example',
      );
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.includes('evil.example'), false);
    });
  });
});

describe('Ollama HTTP client', () => {
  it('rejects a non-loopback base URL before fetching', () => {
    assert.throws(
      () => createHttpOllamaClient('http://203.0.113.10:11434', 1000),
      (error: unknown) => error instanceof OllamaRequestError,
    );
  });

  it('reads pull progress from a bounded NDJSON stream', async () => {
    const events: unknown[] = [];
    const client = createHttpOllamaClient(
      'http://127.0.0.1:11434',
      1000,
      () => {
        const encoded = new TextEncoder().encode(
          '{"status":"downloading","completed":1,"total":2}\n{"status":"success"}\n',
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoded);
              controller.close();
            },
          }),
        });
      },
    );

    await client.pullModel('llama3.2', {
      signal: new AbortController().signal,
      onEvent(event) {
        events.push(event);
      },
    });
    assert.equal(events.length, 2);
    assert.equal(interpretPullEvent(events[0]).kind, 'progress');
  });

  it('rejects an oversized pull line and a non-JSON list', async () => {
    const oversized = createHttpOllamaClient(
      'http://127.0.0.1:11434',
      1000,
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(70_000));
              controller.close();
            },
          }),
        }),
    );
    await assert.rejects(
      () =>
        oversized.pullModel('llama3.2', {
          signal: new AbortController().signal,
          onEvent() {
            return undefined;
          },
        }),
      (error: unknown) =>
        error instanceof OllamaRequestError && error.code === 'invalid',
    );

    const invalidJson = createHttpOllamaClient(
      'http://127.0.0.1:11434',
      1000,
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => '4' },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('nope'));
              controller.close();
            },
          }),
        }),
    );
    await assert.rejects(
      () => invalidJson.getTags(new AbortController().signal),
      (error: unknown) =>
        error instanceof OllamaRequestError && error.code === 'invalid',
    );
  });

  it('maps a stalled request to timeout and a connection error to unavailable', async () => {
    const stalled = createHttpOllamaClient(
      'http://127.0.0.1:11434',
      20,
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    await assert.rejects(
      () => stalled.getVersion(new AbortController().signal),
      (error: unknown) =>
        error instanceof OllamaRequestError && error.code === 'timeout',
    );

    const offline = createHttpOllamaClient('http://127.0.0.1:11434', 1000, () =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    await assert.rejects(
      () => offline.getTags(new AbortController().signal),
      (error: unknown) =>
        error instanceof OllamaRequestError && error.code === 'unavailable',
    );
  });
});

describe('local models, parameter sizes, and disk space', () => {
  it('reads a downloaded model manifest without inventing metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ollama-models-'));
    const modelDigest = 'cd'.repeat(32);
    const configDigest = 'ab'.repeat(32);
    const manifestDirectory = path.join(
      root,
      'manifests',
      'registry.ollama.ai',
      'library',
      'qwen2.5-coder',
    );
    await mkdir(path.join(root, 'blobs'), { recursive: true });
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(path.join(root, 'blobs', `sha256-${modelDigest}`), '');
    await writeFile(
      path.join(manifestDirectory, '14b'),
      JSON.stringify({
        schemaVersion: 2,
        config: { digest: `sha256:${'ef'.repeat(32)}`, size: 10 },
        layers: [
          {
            mediaType: 'application/vnd.ollama.image.model',
            digest: `sha256:${'11'.repeat(32)}`,
            size: 9,
          },
        ],
      }),
    );
    await writeFile(
      path.join(root, 'blobs', `sha256-${'22'.repeat(32)}-partial`),
      '',
    );
    await writeFile(
      path.join(manifestDirectory, '7b'),
      JSON.stringify({
        schemaVersion: 2,
        config: { digest: `sha256:${configDigest}`, size: 10 },
        layers: [
          {
            mediaType: 'application/vnd.ollama.image.model',
            digest: `sha256:${modelDigest}`,
            size: 1000,
          },
        ],
      }),
    );

    const models = await readLocalInstalledModels(root);
    assert.equal(models.length, 1);
    assert.equal(models[0]?.name, 'qwen2.5-coder:7b');
    assert.equal(models[0]?.parameterSize, '7B');
    assert.equal(models[0]?.sizeBytes, 1010);
    assert.equal(models[0]?.family, null);
    assert.equal(models[0]?.quantization, null);
  });

  it('offers 7B, 8B, and 9B tags and ignores quantization tags', () => {
    assert.deepEqual(
      selectParameterTags(['latest', '9b', '7b', '7b-q4_K_M', '8b', '1.5b']),
      [
        { tag: '1.5b', parameterSize: '1.5B' },
        { tag: '7b', parameterSize: '7B' },
        { tag: '8b', parameterSize: '8B' },
        { tag: '9b', parameterSize: '9B' },
      ],
    );
  });

  it('returns saved models when the daemon is down and blocks a download that does not fit', async () => {
    const saved = {
      name: 'qwen2.5-coder:7b',
      identifier: `sha256:${'ab'.repeat(32)}`,
      sizeBytes: 1010,
      family: null,
      families: null,
      parameterSize: '7B',
      quantization: null,
      format: null,
      modifiedAt: '2024-08-01T00:00:00.000Z',
    };
    const assist: ModelAssist = {
      listLocal: () => Promise.resolve([saved]),
      variants: (modelName) =>
        Promise.resolve({
          model: modelName,
          source: 'ollama-library',
          variants: [
            { tag: '7b', parameterSize: '7B', installed: true },
            { tag: '8b', parameterSize: '8B', installed: false },
            { tag: '9b', parameterSize: '9B', installed: false },
          ],
        }),
      assess: (model) =>
        Promise.resolve({
          model,
          freeBytes: model === 'gemma2:9b' ? 100 : 50_000,
          totalBytes: 50_000,
          memoryFreeBytes: 1_000,
          memoryTotalBytes: 2_000,
          modelBytes: model === 'gemma2:9b' ? 5_000 : 1010,
          alreadyInstalled: model === 'qwen2.5-coder:7b',
          fit:
            model === 'qwen2.5-coder:7b'
              ? 'already-installed'
              : model === 'gemma2:9b'
                ? 'not-enough'
                : 'enough',
        }),
    };
    const held = heldPull({
      getTags: () => Promise.reject(new OllamaRequestError('unavailable')),
    });
    await withServer(
      held.client,
      {},
      async (port) => {
        const installed = await request(port, '/api/v1/models');
        assert.equal(installed.status, 200);
        assert.equal(
          JSON.parse(installed.body).data.models[0].name,
          saved.name,
        );
        assert.equal(JSON.parse(installed.body).data.source, 'local-manifest');

        const variants = await request(
          port,
          '/api/v1/models/variants?model=qwen2.5-coder',
        );
        assert.deepEqual(
          JSON.parse(variants.body).data.variants.map(
            (variant: { tag: string }) => variant.tag,
          ),
          ['7b', '8b', '9b'],
        );

        const existing = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'qwen2.5-coder', tag: '7b' }),
        });
        assert.equal(existing.status, 409);
        assert.equal(
          JSON.parse(existing.body).message,
          'This model is already downloaded on this machine.',
        );

        const tooLarge = await request(port, '/api/v1/models/pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'gemma2', tag: '9b' }),
        });
        assert.equal(tooLarge.status, 409);
        assert.equal(
          JSON.parse(tooLarge.body).message,
          'There is not enough free disk space for this model.',
        );
        assert.equal(JSON.parse(tooLarge.body).data.modelBytes, 5000);
        assert.equal(tooLarge.body.includes('/Users/'), false);
      },
      assist,
    );
  });
});
