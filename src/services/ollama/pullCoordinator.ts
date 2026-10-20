import { randomUUID } from 'node:crypto';
import { OllamaRequestError } from './errors.js';
import { parseModelIdentifier } from './modelIdentifier.js';
import { interpretPullEvent } from './normalize.js';
import type { OllamaClient } from './client.js';

export type PullState =
  'queued' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'cancelled';

export interface PullJobView {
  id: string;
  model: string;
  state: PullState;
  message: string;
  bytesCompleted: number | null;
  bytesTotal: number | null;
  progressPercent: number | null;
  errorCode: string | null;
}

export type PullStartResult =
  | { kind: 'created'; job: PullJobView }
  | { kind: 'duplicate'; job: PullJobView }
  | { kind: 'busy' }
  | { kind: 'invalid' };

export type PullCancelResult =
  | { kind: 'cancelled'; job: PullJobView }
  | { kind: 'finished'; job: PullJobView }
  | { kind: 'missing' };

interface JobRecord {
  id: string;
  model: string;
  state: PullState;
  message: string;
  bytesCompleted: number | null;
  bytesTotal: number | null;
  progressPercent: number | null;
  errorCode: string | null;
  order: number;
}

const MAX_TERMINAL_JOBS = 20;
const ACTIVE_STATES = new Set<PullState>([
  'queued',
  'downloading',
  'verifying',
]);

export interface PullCoordinator {
  start(model: string): PullStartResult;
  get(jobId: string): PullJobView | null;
  cancel(jobId: string): PullCancelResult;
  shutdown(): void;
}

function viewOf(job: JobRecord): PullJobView {
  return {
    id: job.id,
    model: job.model,
    state: job.state,
    message: job.message,
    bytesCompleted: job.bytesCompleted,
    bytesTotal: job.bytesTotal,
    progressPercent: job.progressPercent,
    errorCode: job.errorCode,
  };
}

function isTerminal(state: PullState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function createPullCoordinator(options: {
  client: OllamaClient;
  maxConcurrent: number;
  pullTimeoutMs: number;
  createId?: () => string;
}): PullCoordinator {
  const jobs = new Map<string, JobRecord>();
  const controllers = new Map<string, AbortController>();
  const timers = new Map<string, NodeJS.Timeout>();
  let order = 0;
  let closed = false;
  const createId = options.createId ?? randomUUID;

  function retain(): void {
    const terminal = [...jobs.values()].filter((job) => isTerminal(job.state));
    if (terminal.length <= MAX_TERMINAL_JOBS) {
      return;
    }
    terminal.sort((left, right) => left.order - right.order);
    const extra = terminal.length - MAX_TERMINAL_JOBS;
    for (const job of terminal.slice(0, extra)) {
      jobs.delete(job.id);
    }
  }

  function activeJob(model: string): JobRecord | undefined {
    return [...jobs.values()].find(
      (job) => job.model === model && ACTIVE_STATES.has(job.state),
    );
  }

  function activeCount(): number {
    return [...jobs.values()].filter((job) => ACTIVE_STATES.has(job.state))
      .length;
  }

  function fail(job: JobRecord, errorCode: string, message: string): void {
    if (isTerminal(job.state)) {
      return;
    }
    job.state = 'failed';
    job.errorCode = errorCode;
    job.message = message;
    job.progressPercent = null;
    retain();
  }

  function applySuccess(
    job: JobRecord,
    event: Extract<ReturnType<typeof interpretPullEvent>, { kind: 'success' }>,
  ): void {
    job.state = 'completed';
    job.errorCode = null;
    job.message = 'Download complete.';
    if (event.bytesCompleted !== null) {
      job.bytesCompleted = event.bytesCompleted;
    }
    if (event.bytesTotal !== null) {
      job.bytesTotal = event.bytesTotal;
    }
    if (event.progressPercent !== null) {
      job.progressPercent = event.progressPercent;
    }
  }

  async function run(
    job: JobRecord,
    controller: AbortController,
  ): Promise<void> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.pullTimeoutMs);
    timer.unref();
    timers.set(job.id, timer);
    let sawSuccess = false;

    try {
      job.state = 'downloading';
      job.message = 'Download in progress.';
      await options.client.pullModel(job.model, {
        signal: controller.signal,
        onEvent: (event) => {
          if (isTerminal(job.state)) {
            return;
          }
          const interpreted = interpretPullEvent(event);
          if (interpreted.kind === 'invalid') {
            throw new OllamaRequestError('invalid');
          }
          if (interpreted.kind === 'failed') {
            fail(job, 'pull_failed', 'The download failed.');
            controller.abort();
            return;
          }
          if (interpreted.kind === 'success') {
            sawSuccess = true;
            applySuccess(job, interpreted);
            return;
          }
          job.state = interpreted.phase;
          job.message = interpreted.message;
          job.bytesCompleted = interpreted.bytesCompleted;
          job.bytesTotal = interpreted.bytesTotal;
          job.progressPercent = interpreted.progressPercent;
          job.errorCode = null;
        },
      });
      if (!sawSuccess && !isTerminal(job.state)) {
        fail(job, 'pull_failed', 'The download failed.');
      }
    } catch (error) {
      if (isTerminal(job.state)) {
        return;
      }
      if (timedOut) {
        fail(job, 'pull_timeout', 'The download timed out.');
        return;
      }
      if (error instanceof OllamaRequestError) {
        if (error.code === 'invalid') {
          fail(
            job,
            'unexpected_response',
            'Ollama sent a progress update this app could not use.',
          );
          return;
        }
        fail(job, 'ollama_unavailable', 'Ollama is unavailable.');
        return;
      }
      fail(job, 'pull_failed', 'The download failed.');
    } finally {
      clearTimeout(timer);
      timers.delete(job.id);
      controllers.delete(job.id);
      retain();
    }
  }

  return {
    start(model: string): PullStartResult {
      if (closed) {
        return { kind: 'busy' };
      }
      const name = parseModelIdentifier(model);
      if (name === null) {
        return { kind: 'invalid' };
      }
      const existing = activeJob(name);
      if (existing !== undefined) {
        return { kind: 'duplicate', job: viewOf(existing) };
      }
      if (activeCount() >= options.maxConcurrent) {
        return { kind: 'busy' };
      }

      const job: JobRecord = {
        id: createId(),
        model: name,
        state: 'queued',
        message: 'Download queued.',
        bytesCompleted: null,
        bytesTotal: null,
        progressPercent: null,
        errorCode: null,
        order: order,
      };
      order += 1;
      jobs.set(job.id, job);
      const controller = new AbortController();
      controllers.set(job.id, controller);
      const created = viewOf(job);
      void run(job, controller);
      return { kind: 'created', job: created };
    },
    get(jobId: string): PullJobView | null {
      const job = jobs.get(jobId);
      return job === undefined ? null : viewOf(job);
    },
    cancel(jobId: string): PullCancelResult {
      const job = jobs.get(jobId);
      if (job === undefined) {
        return { kind: 'missing' };
      }
      if (isTerminal(job.state)) {
        return { kind: 'finished', job: viewOf(job) };
      }
      job.state = 'cancelled';
      job.errorCode = null;
      job.message = 'Download cancelled.';
      const controller = controllers.get(jobId);
      controller?.abort();
      retain();
      return { kind: 'cancelled', job: viewOf(job) };
    },
    shutdown(): void {
      closed = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    },
  };
}
