import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { repoRoot } from '../src/constants/paths.js';
import {
  formatDoctorReport,
  runDoctorChecks,
} from '../src/services/doctor.service.js';
import { createTempDirectory } from './helpers.js';

const execFileAsync = promisify(execFile);
const LOCAL_URI = 'mongodb://127.0.0.1:27017/opendev-orchestrator';

function gitStatus(): Promise<string> {
  return execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).then(({ stdout }) => stdout);
}

describe('doctor', () => {
  it('passes when Git is present and Ollama is not called', async () => {
    const report = await runDoctorChecks({
      env: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '3001',
        MONGO_URI: LOCAL_URI,
      },
      nodeVersion: '22.20.0',
      runCommand: () => Promise.resolve({ stdout: 'git version 2.50.1\n' }),
    });

    assert.equal(report.ok, true);
    assert.deepEqual(
      report.checks.map((check) => [check.name, check.status]),
      [
        ['node', 'pass'],
        ['git', 'pass'],
        ['config', 'pass'],
      ],
    );
    assert.equal(formatDoctorReport(report).includes(LOCAL_URI), false);
  });

  it('fails closed for an unsupported Node version, missing git, or invalid config', async () => {
    const nodeReport = await runDoctorChecks({
      env: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        MONGO_URI: LOCAL_URI,
      },
      nodeVersion: '18.20.0',
      runCommand: () => Promise.resolve({ stdout: 'git version 2.50.1\n' }),
    });
    assert.equal(nodeReport.ok, false);
    assert.equal(nodeReport.checks[0]?.status, 'fail');

    const gitReport = await runDoctorChecks({
      env: {
        NODE_ENV: 'development',
        HOST: '0.0.0.0',
        MONGO_URI: LOCAL_URI,
      },
      nodeVersion: '22.20.0',
      runCommand: () => Promise.reject(new Error('spawn git ENOENT')),
    });
    assert.equal(gitReport.ok, false);
    assert.equal(
      gitReport.checks.find((check) => check.name === 'git')?.detail,
      'git is not available',
    );
    assert.equal(
      gitReport.checks.find((check) => check.name === 'config')?.detail,
      'HOST must be a loopback address',
    );
  });

  it('does not modify application files when the CLI runs', async () => {
    const fixture = createTempDirectory('opendev-sentinel-9f3a2c-');
    const markerPath = path.join(fixture.directory, 'marker.txt');
    fs.writeFileSync(markerPath, 'unchanged');
    const before = await gitStatus();

    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', path.join(repoRoot, 'src', 'doctor.ts')],
        {
          cwd: repoRoot,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
            NODE_ENV: 'development',
            HOST: '127.0.0.1',
            PORT: '3001',
            MONGO_URI: LOCAL_URI,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
    });

    try {
      assert.equal(result.code, 0);
      assert.match(result.stdout, /node: pass/);
      assert.match(result.stdout, /git: pass/);
      assert.match(result.stdout, /config: pass/);
      assert.equal(result.stdout.includes('sentinel-9f3a2c'), false);
      assert.equal(result.stderr.includes('sentinel-9f3a2c'), false);
      assert.equal(result.stdout.includes('mongodb://'), false);
      assert.equal(result.stderr.includes('mongodb://'), false);
      assert.equal(fs.readFileSync(markerPath, 'utf8'), 'unchanged');
      assert.deepEqual(fs.readdirSync(fixture.directory), ['marker.txt']);
      assert.equal(await gitStatus(), before);
    } finally {
      fixture.cleanup();
    }
  });
});
