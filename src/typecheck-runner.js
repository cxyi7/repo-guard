import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, executionError } from './core/error/repo-guard-error.js';
import { createGateResult } from './core/result/gate-result.js';
import { processOutputDiagnostics } from './core/execution/process-output.js';
import { processFailureFinding } from './core/report/guidance-catalog.js';
import { runProjectScript } from './integrations/npm/run-script.js';

export const TYPE_CHECK_GATE_ID = 'quality.typecheck';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError('typecheck/missing-package-json', 'package.json was not found in repository root');
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateTypeCheckSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'typecheck/missing-script',
      `TypeScript gate requires package.json script "${config.script}"`,
    );
  }
  return { command: command.trim() };
}

export function detectProjectTypeCheckSetup(root, config) {
  try {
    return { ready: true, setup: validateTypeCheckSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

export function runTypeCheckGate({ root, config }) {
  const startedAt = Date.now();
  const setup = validateTypeCheckSetup(root, config);
  const diagnostics = [{
    level: 'info',
    message: `repo-guard TypeScript: running npm script "${config.script}" (${setup.command})...`,
  }];
  const execution = runProjectScript({ root, script: config.script, timeoutMs: config.timeoutMs });
  diagnostics.push(...processOutputDiagnostics(execution, { source: 'typescript', root }));
  if (execution.error) {
    const error = executionError(
      execution.timedOut ? 'typecheck/timeout' : 'typecheck/process-start-failed',
      execution.timedOut
        ? `TypeScript type check exceeded ${config.timeoutMs}ms`
        : `Unable to run TypeScript type check: ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: TYPE_CHECK_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
      durationMs: Date.now() - startedAt,
    });
  }
  if (execution.status !== 0) {
    return createGateResult({
      gateId: TYPE_CHECK_GATE_ID,
      status: 'violation',
      summary: 'TypeScript type check failed',
      diagnostics,
      findings: [processFailureFinding(TYPE_CHECK_GATE_ID, {
        exitCode: execution.status ?? 1,
        script: config.script,
      })],
      metrics: { processExitCode: execution.status ?? 1 },
      durationMs: Date.now() - startedAt,
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard TypeScript passed.' });
  return createGateResult({
    gateId: TYPE_CHECK_GATE_ID,
    status: 'passed',
    summary: 'TypeScript type check passed',
    diagnostics,
    durationMs: Date.now() - startedAt,
  });
}
