import { Router } from 'express';
import {
  createModelsController,
  type ModelsControllerDependencies,
} from '../controllers/models.controller.js';

export function createModelsRouter(deps: ModelsControllerDependencies): Router {
  const controller = createModelsController(deps);
  const router = Router();
  router.get('/models/status', (req, res, next) => {
    void controller.status(req, res, next);
  });
  router.get('/models/runtime', (req, res, next) => {
    void controller.runtime(req, res, next);
  });
  router.get('/models/catalog', (req, res) => {
    controller.catalog(req, res);
  });
  router.get('/models/variants', (req, res, next) => {
    controller.variants(req, res, next);
  });
  router.get('/models/capacity', (req, res, next) => {
    controller.capacity(req, res, next);
  });
  router.get('/models/pull/:jobId', (req, res) => {
    controller.getPull(req, res);
  });
  router.delete('/models/pull/:jobId', (req, res) => {
    controller.cancelPull(req, res);
  });
  router.post('/models/pull', (req, res, next) => {
    controller.startPull(req, res, next);
  });
  router.get('/models', (req, res, next) => {
    void controller.installed(req, res, next);
  });
  return router;
}
