import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS, STATUS_MESSAGE } from '../constants/httpStatus.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../utils/sendResponse.js';

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode;
  }
  return undefined;
}

function isInvalidJson(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { type?: unknown };
  if (candidate.type === 'entity.parse.failed') {
    return true;
  }

  return (
    error instanceof SyntaxError &&
    readStatus(error) === HTTP_STATUS.BAD_REQUEST
  );
}

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { type?: unknown };
  return (
    candidate.type === 'entity.too.large' ||
    readStatus(error) === HTTP_STATUS.PAYLOAD_TOO_LARGE
  );
}

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (isInvalidJson(error)) {
    sendError(
      res,
      HTTP_STATUS.BAD_REQUEST,
      STATUS_MESSAGE[HTTP_STATUS.BAD_REQUEST],
    );
    return;
  }

  if (isPayloadTooLarge(error)) {
    sendError(
      res,
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      STATUS_MESSAGE[HTTP_STATUS.PAYLOAD_TOO_LARGE],
    );
    return;
  }

  logger.error('Unhandled request error');
  sendError(
    res,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    STATUS_MESSAGE[HTTP_STATUS.INTERNAL_SERVER_ERROR],
  );
}
