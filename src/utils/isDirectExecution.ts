import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function isDirectExecution(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    return false;
  }

  return pathToFileURL(path.resolve(entry)).href === moduleUrl;
}
