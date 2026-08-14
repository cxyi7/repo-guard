import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { executionError } from './core/error/repo-guard-error.js';
import { processOutputDiagnostics } from './core/execution/process-output.js';
import { processFailureFinding } from './core/result/process-failure-guidance.js';
import { createGateResult } from './core/result/gate-result.js';
import { validateVueLighthouseSetup } from './integrations/lighthouse/project.js';

function runProcess(command, args, { root, timeoutMs }) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });

  return result;
}

function runNpmScript(root, script, timeoutMs) {
  if (process.platform === 'win32') {
    return runProcess(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `npm run ${script}`],
      { root, timeoutMs },
    );
  }
  return runProcess('npm', ['run', script], { root, timeoutMs });
}

function runLhci(root, metadata, configFile, phase, timeoutMs) {
  return runProcess(
    process.execPath,
    [metadata.binPath, phase, `--config=${configFile}`],
    { root, timeoutMs },
  );
}

export function runVueLighthouse({ root, config, skipBuild = false }) {
  const setup = validateVueLighthouseSetup(root, config);
  const diagnostics = [{ level: 'info', message:
    `repo-guard Lighthouse: Vue project, @lhci/cli ${setup.lighthouse.version}, `
    + `config=${setup.configFile}` }];

  const resultForExecutionFailure = (execution, label) => {
    if (!execution.error) return null;
    const error = executionError(
      execution.error.code === 'ETIMEDOUT'
        ? 'lighthouse/process-timeout'
        : 'lighthouse/process-start-failed',
      execution.error.code === 'ETIMEDOUT'
        ? `${label} exceeded ${config.timeoutMs}ms`
        : `Unable to run ${label}: ${execution.error.message}`,
      { cause: execution.error },
    );
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  };

  if (!skipBuild && config.buildScript) {
    diagnostics.push({ level: 'info', message: `repo-guard Lighthouse: running npm script "${config.buildScript}"...` });
    const execution = runNpmScript(root, config.buildScript, config.timeoutMs);
    diagnostics.push(...processOutputDiagnostics(execution, { source: 'lighthouse-build', root }));
    const failedExecution = resultForExecutionFailure(execution, 'Lighthouse build');
    if (failedExecution) return failedExecution;
    const buildExitCode = execution.status ?? 1;
    if (buildExitCode !== 0) {
      return createGateResult({
        gateId: 'quality.lighthouse',
        status: 'violation',
        summary: `Lighthouse build failed with exit code ${buildExitCode}`,
        diagnostics,
        findings: [processFailureFinding('quality.lighthouse', {
          exitCode: buildExitCode,
          phase: 'build',
          script: config.buildScript,
        })],
      });
    }
  }

  diagnostics.push({ level: 'info', message: 'repo-guard Lighthouse: collecting configured Vue page results...' });
  const collectExecution = runLhci(
    root,
    setup.lighthouse,
    setup.configFile,
    'collect',
    config.timeoutMs,
  );
  diagnostics.push(...processOutputDiagnostics(collectExecution, { source: 'lighthouse-collect', root }));
  const failedCollection = resultForExecutionFailure(collectExecution, 'Lighthouse collection');
  if (failedCollection) return failedCollection;
  const collectExitCode = collectExecution.status ?? 1;
  if (collectExitCode !== 0) {
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'execution-error',
      summary: `Lighthouse collection failed with exit code ${collectExitCode}`,
      error: executionError(
        'lighthouse/collect-failed',
        `LHCI collect exited with code ${collectExitCode}`,
      ),
      diagnostics,
      findings: [processFailureFinding('quality.lighthouse', {
        exitCode: collectExitCode,
        phase: 'collect',
      })],
    });
  }

  diagnostics.push({ level: 'info', message: 'repo-guard Lighthouse: checking project assertions...' });
  const assertExecution = runLhci(
    root,
    setup.lighthouse,
    setup.configFile,
    'assert',
    config.timeoutMs,
  );
  diagnostics.push(...processOutputDiagnostics(assertExecution, { source: 'lighthouse-assert', root }));
  const failedAssertion = resultForExecutionFailure(assertExecution, 'Lighthouse assertions');
  if (failedAssertion) return failedAssertion;
  const assertExitCode = assertExecution.status ?? 1;
  if (assertExitCode !== 0) {
    return createGateResult({
      gateId: 'quality.lighthouse',
      status: 'violation',
      summary: `Lighthouse assertions failed with exit code ${assertExitCode}`,
      diagnostics,
      findings: [processFailureFinding('quality.lighthouse', {
        exitCode: assertExitCode,
        phase: 'assert',
      })],
    });
  }

  diagnostics.push({ level: 'info', message: `repo-guard Lighthouse passed. Raw reports: ${path.join(root, '.lighthouseci')}` });
  return createGateResult({
    gateId: 'quality.lighthouse',
    status: 'passed',
    summary: 'Lighthouse assertions passed',
    diagnostics,
    artifacts: [{
      path: path.relative(root, path.join(root, '.lighthouseci')).replace(/\\/g, '/'),
      type: 'lighthouse-report',
      description: 'Local Lighthouse CI reports',
    }],
  });
}
