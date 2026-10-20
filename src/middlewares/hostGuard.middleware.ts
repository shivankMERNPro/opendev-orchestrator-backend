import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS, STATUS_MESSAGE } from '../constants/httpStatus.js';
import { isLoopbackRequestHost } from '../utils/loopback.js';
import { sendError } from '../utils/sendResponse.js';

export function hostGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const hostHeader = req.header('host');
  if (hostHeader === undefined || !isLoopbackRequestHost(hostHeader)) {
    sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      STATUS_MESSAGE[HTTP_STATUS.FORBIDDEN],
    );
    return;
  }

  next();
}
