import type { Request, Response } from 'express';
import { HTTP_STATUS, STATUS_MESSAGE } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';

export function notFoundMiddleware(_req: Request, res: Response): void {
  sendError(res, HTTP_STATUS.NOT_FOUND, STATUS_MESSAGE[HTTP_STATUS.NOT_FOUND]);
}
