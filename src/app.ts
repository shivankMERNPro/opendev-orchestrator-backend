import { Router } from 'express';
import type { DatabaseConnection } from './configs/dbConnectionConfig.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createModelsRouter } from './routes/models.routes.js';
import type { ModelsControllerDependencies } from './controllers/models.controller.js';

export function createApiRouter(
  database: DatabaseConnection,
  models: ModelsControllerDependencies,
): Router {
  const apiRouter = Router();
  apiRouter.use(createHealthRouter(database));
  apiRouter.use(createModelsRouter(models));
  return apiRouter;
}
