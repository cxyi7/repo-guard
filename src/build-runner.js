import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { createGateResult } from './core/result/gate-result.js';
import { runProjectScript } from './integrations/npm/run-script.js';

export const BUILD_GATE_ID = 'quality.build';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateBuildSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(`Build gate requires package.json script "${config.script}"`);
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
  if (execution.error) {
    const error = execution.timedOut
      ? new Error(`Project build exceeded ${config.timeoutMs}ms`)
      : new Error(`Unable to run project build: ${execution.error.message}`);
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
    diagnostics.push({ level: 'error', message: [
      `项目构建失败（退出码 ${execution.status ?? 1}），推送已停止。`,
      '请根据上方构建输出修复源码、配置、依赖或资源问题。',
      '不得把构建脚本改为空操作、忽略构建错误、关闭生产优化或修改门禁绕过。',
      `修复后重新运行 npm run ${config.script}。`,
    ].join('\n') });
    return createGateResult({
      gateId: BUILD_GATE_ID,
      status: 'violation',
      summary: 'Project build failed',
      diagnostics,
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
