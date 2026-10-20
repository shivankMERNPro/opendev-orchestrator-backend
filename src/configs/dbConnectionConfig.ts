import mongoose from 'mongoose';
import type { DatabaseHealth } from '../types/health.type.js';
import { StartupError } from '../utils/startupError.js';

mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);

export interface DatabaseConnection {
  getHealth(): DatabaseHealth;
  close(): Promise<void>;
}

export async function connectDatabase(
  mongoUri: string,
): Promise<DatabaseConnection> {
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      directConnection: true,
    });
    const database = mongoose.connection.db;
    if (database === undefined) {
      throw new StartupError('Database connection failed');
    }
    await database.command({ ping: 1 });
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    if (error instanceof StartupError) {
      throw error;
    }
    throw new StartupError('Database connection failed');
  }

  return {
    getHealth(): DatabaseHealth {
      return {
        status:
          mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      };
    },
    async close(): Promise<void> {
      await mongoose.disconnect();
    },
  };
}
