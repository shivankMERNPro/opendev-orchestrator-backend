import { Router } from 'express';
import type { DatabaseConnection } from './configs/dbConnectionConfig.js';
import { createHealthRouter } from './routes/health.routes.js';

export function createApiRouter(database: DatabaseConnection): Router {
  const apiRouter = Router();
  apiRouter.use(createHealthRouter(database));
  return apiRouter;
}
