import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.on('finish', () => {
    const pathOnly = (req.originalUrl.split('?')[0] ?? req.path).trim();
    logger.info(`${req.method} ${pathOnly} ${String(res.statusCode)}`);
  });
  next();
}
