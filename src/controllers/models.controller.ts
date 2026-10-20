import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { searchCatalog } from '../services/ollama/catalog.js';
import type { OllamaClient } from '../services/ollama/client.js';
import { OllamaRequestError } from '../services/ollama/errors.js';
import {
  readInstalledModels,
  readOllamaStatus,
  readRuntimeModels,
} from '../services/ollama/models.service.js';
import type { PullCoordinator } from '../services/ollama/pullCoordinator.js';
import { sendError, sendFailure, sendSuccess } from '../utils/sendResponse.js';
import type { ModelAssist } from '../services/ollama/modelAssist.js';
import {
  composeModelIdentifier,
  parseModelIdentifier,
} from '../services/ollama/modelIdentifier.js';
import { pullRequestSchema } from '../validationSchemas/pullRequest.schema.js';

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OLLAMA_UNAVAILABLE = 'Ollama is unavailable.';
const OLLAMA_INVALID = 'Ollama returned an unexpected response.';
const INVALID_MODEL = 'The model identifier is invalid.';

export interface ModelsControllerDependencies {
  client: OllamaClient;
  pulls: PullCoordinator;
  requestTimeoutMs: number;
  assist: ModelAssist;
}

function requestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function sendOllamaFailure(res: Response, error: unknown): boolean {
  if (!(error instanceof OllamaRequestError)) {
    return false;
  }
  if (error.code === 'invalid') {
    sendFailure(
      res,
      HTTP_STATUS.BAD_GATEWAY,
      { status: 'invalid' },
      OLLAMA_INVALID,
    );
    return true;
  }
  sendFailure(
    res,
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    { status: 'unavailable' },
    OLLAMA_UNAVAILABLE,
  );
  return true;
}

export function createModelsController(deps: ModelsControllerDependencies) {
  return {
    async status(
      _req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> {
      try {
        const status = await readOllamaStatus(
          deps.client,
          requestSignal(deps.requestTimeoutMs),
        );
        const message =
          status === 'available'
            ? 'Ollama is available.'
            : status === 'invalid'
              ? OLLAMA_INVALID
              : OLLAMA_UNAVAILABLE;
        sendSuccess(res, HTTP_STATUS.OK, { status }, message);
      } catch (error) {
        next(error);
      }
    },

    async installed(
      _req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> {
      try {
        const models = await readInstalledModels(
          deps.client,
          requestSignal(deps.requestTimeoutMs),
        );
        sendSuccess(
          res,
          HTTP_STATUS.OK,
          { models, source: 'ollama', daemon: 'available' },
          'Success',
        );
      } catch (error) {
        if (
          error instanceof OllamaRequestError &&
          (error.code === 'unavailable' || error.code === 'timeout')
        ) {
          try {
            const models = await deps.assist.listLocal();
            sendSuccess(
              res,
              HTTP_STATUS.OK,
              { models, source: 'local-manifest', daemon: 'unavailable' },
              'Installed models were read from local Ollama files.',
            );
          } catch {
            sendFailure(
              res,
              HTTP_STATUS.SERVICE_UNAVAILABLE,
              { status: 'unavailable' },
              OLLAMA_UNAVAILABLE,
            );
          }
          return;
        }
        if (!sendOllamaFailure(res, error)) {
          next(error);
        }
      }
    },

    async runtime(
      _req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> {
      try {
        const models = await readRuntimeModels(
          deps.client,
          requestSignal(deps.requestTimeoutMs),
        );
        sendSuccess(res, HTTP_STATUS.OK, { models }, 'Success');
      } catch (error) {
        if (!sendOllamaFailure(res, error)) {
          next(error);
        }
      }
    },

    catalog(req: Request, res: Response): void {
      const raw = req.query.q;
      if (Array.isArray(raw)) {
        sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          'The catalog query is invalid.',
        );
        return;
      }
      const result = searchCatalog(typeof raw === 'string' ? raw : undefined);
      if (!result.ok) {
        sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          'The catalog query is invalid.',
        );
        return;
      }
      sendSuccess(
        res,
        HTTP_STATUS.OK,
        {
          source: 'curated',
          complete: false,
          models: result.models,
        },
        'Curated model identifiers. This is not a complete or live catalog.',
      );
    },

    variants(req: Request, res: Response, next: NextFunction): void {
      const raw = req.query.model;
      if (typeof raw !== 'string' || raw.includes(':') || raw.includes('/')) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
        return;
      }
      const model = parseModelIdentifier(raw);
      if (model === null) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
        return;
      }
      void deps.assist
        .variants(model, requestSignal(deps.requestTimeoutMs))
        .then((listing) => {
          sendSuccess(
            res,
            HTTP_STATUS.OK,
            listing,
            'Parameter sizes published for this model. This is not every Ollama tag.',
          );
        })
        .catch((error: unknown) => {
          next(error);
        });
    },

    capacity(req: Request, res: Response, next: NextFunction): void {
      const raw = req.query.model;
      if (typeof raw !== 'string') {
        sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
        return;
      }
      const model = parseModelIdentifier(raw);
      if (model === null) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
        return;
      }
      void deps.assist
        .assess(model, requestSignal(deps.requestTimeoutMs))
        .then((assessment) => {
          sendSuccess(
            res,
            HTTP_STATUS.OK,
            assessment,
            'Disk space was measured.',
          );
        })
        .catch((error: unknown) => {
          next(error);
        });
    },

    startPull(req: Request, res: Response, next: NextFunction): void {
      try {
        const parsed = pullRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
          return;
        }
        const model = composeModelIdentifier(
          parsed.data.model,
          parsed.data.tag,
        );
        if (model === null) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
          return;
        }

        void deps.assist
          .assess(model, requestSignal(deps.requestTimeoutMs))
          .then((assessment) => {
            if (assessment.fit === 'already-installed') {
              sendFailure(
                res,
                HTTP_STATUS.CONFLICT,
                assessment,
                'This model is already downloaded on this machine.',
              );
              return;
            }
            if (assessment.fit === 'not-enough') {
              sendFailure(
                res,
                HTTP_STATUS.CONFLICT,
                assessment,
                'There is not enough free disk space for this model.',
              );
              return;
            }
            const started = deps.pulls.start(model);
            if (started.kind === 'invalid') {
              sendError(res, HTTP_STATUS.BAD_REQUEST, INVALID_MODEL);
              return;
            }
            if (started.kind === 'duplicate') {
              sendFailure(
                res,
                HTTP_STATUS.CONFLICT,
                { job: started.job },
                'A download for this model is already active.',
              );
              return;
            }
            if (started.kind === 'busy') {
              sendError(
                res,
                HTTP_STATUS.TOO_MANY_REQUESTS,
                'The download limit has been reached.',
              );
              return;
            }
            sendSuccess(
              res,
              HTTP_STATUS.ACCEPTED,
              { job: started.job },
              'Download started.',
            );
          })
          .catch((error: unknown) => {
            next(error);
          });
      } catch (error) {
        next(error);
      }
    },

    getPull(req: Request, res: Response): void {
      const jobId = req.params.jobId;
      if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
        sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
        return;
      }
      const job = deps.pulls.get(jobId);
      if (job === null) {
        sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
        return;
      }
      sendSuccess(res, HTTP_STATUS.OK, { job }, 'Success');
    },

    cancelPull(req: Request, res: Response): void {
      const jobId = req.params.jobId;
      if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
        sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
        return;
      }
      const result = deps.pulls.cancel(jobId);
      if (result.kind === 'missing') {
        sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
        return;
      }
      if (result.kind === 'finished') {
        sendFailure(
          res,
          HTTP_STATUS.CONFLICT,
          { job: result.job },
          'This download has already finished.',
        );
        return;
      }
      sendSuccess(
        res,
        HTTP_STATUS.OK,
        { job: result.job },
        'Download cancelled.',
      );
    },
  };
}
