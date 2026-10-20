import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../constants/env.js';
import type { DoctorCheck, DoctorReport } from '../types/doctor.type.js';
import { assertLoopbackBind } from '../utils/loopback.js';
import { StartupError } from '../utils/startupError.js';

const execFileAsync = promisify(execFile);
const MINIMUM_NODE_MAJOR = 22;
const MINIMUM_NODE_MINOR = 5;

export interface CommandResult {
  stdout: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult>;

export interface DoctorDependencies {
  env: NodeJS.ProcessEnv;
  nodeVersion?: string;
  runCommand?: CommandRunner;
}

export function isSupportedNodeVersion(version: string): boolean {
  const [majorText, minorText] = version.replace(/^v/, '').split('.');
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }
  if (major > MINIMUM_NODE_MAJOR) {
    return true;
  }
  if (major < MINIMUM_NODE_MAJOR) {
    return false;
  }
  return minor >= MINIMUM_NODE_MINOR;
}

const defaultRunCommand: CommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, [...args], {
    timeout: 3000,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { stdout: String(stdout) };
};

export async function checkNode(version: string): Promise<DoctorCheck> {
  if (!isSupportedNodeVersion(version)) {
    return {
      name: 'node',
      status: 'fail',
      detail: 'Node.js 22.5.0 or newer is required',
    };
  }

  return {
    name: 'node',
    status: 'pass',
    detail: `v${version.replace(/^v/, '')}`,
  };
}

export async function checkGit(
  runCommand: CommandRunner,
): Promise<DoctorCheck> {
  try {
    const { stdout } = await runCommand('git', ['--version']);
    const detail = stdout.trim().split('\n')[0] ?? '';
    if (!detail.startsWith('git version ')) {
      return { name: 'git', status: 'pass', detail: 'git is available' };
    }
    return { name: 'git', status: 'pass', detail };
  } catch {
    return { name: 'git', status: 'fail', detail: 'git is not available' };
  }
}

export function checkConfig(env: NodeJS.ProcessEnv): DoctorCheck {
  try {
    const config = loadConfig(env);
    assertLoopbackBind(config.host);
    return {
      name: 'config',
      status: 'pass',
      detail: 'configuration is valid for local startup',
    };
  } catch (error) {
    const detail =
      error instanceof StartupError
        ? error.message
        : 'configuration is invalid';
    return { name: 'config', status: 'fail', detail };
  }
}

export function isFoundationReady(checks: readonly DoctorCheck[]): boolean {
  return checks.every((check) => check.status === 'pass');
}

export function formatDoctorReport(report: DoctorReport): string {
  return report.checks
    .map((check) => `${check.name}: ${check.status} (${check.detail})`)
    .join('\n');
}

export async function runDoctorChecks(
  dependencies: DoctorDependencies,
): Promise<DoctorReport> {
  const checks = [
    await checkNode(dependencies.nodeVersion ?? process.versions.node),
    await checkGit(dependencies.runCommand ?? defaultRunCommand),
    checkConfig(dependencies.env),
  ];

  return { checks, ok: isFoundationReady(checks) };
}
