import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export function createTempDirectory(prefix = 'opendev-'): {
  directory: string;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    directory,
    cleanup(): void {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function request(
  port: number,
  requestPath: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  body: string;
  contentType: string;
  accessControlAllowOrigin: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const headers = { ...(options?.headers ?? {}) };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method: options?.method ?? 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const allowOrigin = res.headers['access-control-allow-origin'];
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: String(res.headers['content-type'] ?? ''),
            accessControlAllowOrigin:
              typeof allowOrigin === 'string' ? allowOrigin : undefined,
          });
        });
      },
    );
    req.on('error', reject);
    if (options?.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
