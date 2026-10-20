import { createServer, type Server } from 'node:http';
import express from 'express';
import helmet from 'helmet';
import { createApiRouter } from './app.js';
import {
  connectDatabase,
  type DatabaseConnection,
} from './configs/dbConnectionConfig.js';
import type { AppConfig } from './types/config.type.js';
import { loadConfig, loadLocalEnvFile } from './constants/env.js';
import { createCorsMiddleware } from './middlewares/cors.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { hostGuardMiddleware } from './middlewares/hostGuard.middleware.js';
import { notFoundMiddleware } from './middlewares/notFound.middleware.js';
import { requestLoggerMiddleware } from './middlewares/requestLogger.middleware.js';
import { isDirectExecution } from './utils/isDirectExecution.js';
import { logger } from './utils/logger.js';
import { assertLoopbackBind } from './utils/loopback.js';
import { StartupError } from './utils/startupError.js';

export interface RunningServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface ServerDependencies {
  connectDatabase?: (mongoUri: string) => Promise<DatabaseConnection>;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function createApp(
  database: DatabaseConnection,
  config: Pick<AppConfig, 'corsOrigins'>,
): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(createCorsMiddleware(config.corsOrigins));
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(requestLoggerMiddleware);
  app.use(hostGuardMiddleware);
  app.use('/api/v1', createApiRouter(database));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}

export async function startServer(
  env: NodeJS.ProcessEnv,
  dependencies: ServerDependencies = {},
): Promise<RunningServer> {
  const config = loadConfig(env);
  assertLoopbackBind(config.host);
  const connect = dependencies.connectDatabase ?? connectDatabase;

  let database: DatabaseConnection;
  try {
    database = await connect(config.mongoUri);
  } catch (error) {
    if (error instanceof StartupError) {
      throw error;
    }
    throw new StartupError('Database connection failed');
  }

  const app = createApp(database, config);
  const server = createServer(app);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch {
    await database.close();
    throw new StartupError('Server failed to bind to the loopback address');
  }

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await database.close();
    throw new StartupError('Server failed to bind to the loopback address');
  }

  return {
    host: config.host,
    port: address.port,
    async close(): Promise<void> {
      await closeHttpServer(server);
      await database.close();
    },
  };
}

export async function main(): Promise<void> {
  try {
    loadLocalEnvFile();
  } catch (error) {
    if (error instanceof StartupError) {
      logger.error(error.message);
    } else {
      logger.error('Server failed to start');
    }
    process.exitCode = 1;
    return;
  }

  let running: RunningServer;
  try {
    running = await startServer(process.env);
  } catch (error) {
    if (error instanceof StartupError) {
      logger.error(error.message);
    } else {
      logger.error('Server failed to start');
    }
    process.exitCode = 1;
    return;
  }

  logger.info(`Listening on ${running.host}:${String(running.port)}`);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void running.close().finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
