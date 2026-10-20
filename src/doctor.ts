import { loadLocalEnvFile } from './constants/env.js';
import {
  formatDoctorReport,
  runDoctorChecks,
} from './services/doctor.service.js';
import { isDirectExecution } from './utils/isDirectExecution.js';
import { StartupError } from './utils/startupError.js';

export async function main(): Promise<void> {
  try {
    loadLocalEnvFile();
    const report = await runDoctorChecks({ env: process.env });
    process.stdout.write(`${formatDoctorReport(report)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof StartupError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write('Doctor failed to complete checks\n');
    }
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
