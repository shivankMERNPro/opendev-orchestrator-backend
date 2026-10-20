import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS, STATUS_MESSAGE } from '../constants/httpStatus.js';
import type { HealthService } from '../services/health.service.js';
import { sendFailure, sendSuccess } from '../utils/sendResponse.js';

export function createHealthController(healthService: HealthService) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const health = healthService.getHealth();
      if (health.status !== 'ok' || health.database !== 'connected') {
        sendFailure(
          res,
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          health,
          STATUS_MESSAGE[HTTP_STATUS.SERVICE_UNAVAILABLE],
        );
        return;
      }

      sendSuccess(res, HTTP_STATUS.OK, health, STATUS_MESSAGE[HTTP_STATUS.OK]);
    } catch (error) {
      next(error);
    }
  };
}
