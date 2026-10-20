import { Router } from 'express';
import type { DatabaseConnection } from '../configs/dbConnectionConfig.js';
import { createHealthController } from '../controllers/health.controller.js';
import { createHealthService } from '../services/health.service.js';

export function createHealthRouter(database: DatabaseConnection): Router {
  const router = Router();
  router.get('/health', createHealthController(createHealthService(database)));
  return router;
}
