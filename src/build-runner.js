import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, executionError } from './core/error/repo-guard-error.js';
import { createGateResult } from './core/result/gate-result.js';
import { processOutputDiagnostics } from './core/execution/process-output.js';
import { processFailureFinding } from './core/result/process-failure-guidance.js';
import { runProjectScript } from './integrations/npm/run-script.js';

export const BUILD_GATE_ID = 'quality.build';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError('build/missing-package-json', 'package.json was not found in repository root');
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateBuildSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'build/missing-script',
      `Build gate requires package.json script "${config.script}"`,
    );
  }
  return { command: command.trim() };
}

export function detectProjectBuildSetup(root, config) {
  try {
    return { ready: true, setup: validateBuildSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

export function runBuildGate({ root, config }) {
  const startedAt = Date.now();
  const setup = validateBuildSetup(root, config);
  const diagnostics = [{
    level: 'info',
    message: `repo-guard build: running npm script "${config.script}" (${setup.command})...`,
  }];
  const execution = runProjectScript({ root, script: config.script, timeoutMs: config.timeoutMs });
  diagnostics.push(...processOutputDiagnostics(execution, { source: 'build', root }));
  if (execution.error) {
    const error = executionError(
      execution.timedOut ? 'build/timeout' : 'build/process-start-failed',
      execution.timedOut
        ? `Project build exceeded ${config.timeoutMs}ms`
        : `Unable to run project build: ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      durationMs: Date.now() - startedAt,
    });
  }
  if (execution.status !== 0) {
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'violation',
      summary: 'Project build failed',
      diagnostics,
      findings: [processFailureFinding(BUILD_GATE_ID, {
        exitCode: execution.status ?? 1,
        script: config.script,
      })],
      metrics: { processExitCode: execution.status ?? 1 },
      durationMs: Date.now() - startedAt,
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard build passed.' });
  return createGateResult({
    gateId: BUILD_GATE_ID,
    status: 'passed',
    summary: 'Project build passed',
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}
