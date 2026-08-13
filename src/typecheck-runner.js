import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { createGateResult } from './core/result/gate-result.js';
import { runProjectScript } from './integrations/npm/run-script.js';

export const TYPE_CHECK_GATE_ID = 'quality.typecheck';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw new Error(`package.json was not found in repository root: ${root}`);
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateTypeCheckSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(
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
  if (execution.error) {
    const error = execution.timedOut
      ? new Error(`TypeScript type check exceeded ${config.timeoutMs}ms`)
      : new Error(`Unable to run TypeScript type check: ${execution.error.message}`);
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
    diagnostics.push({ level: 'error', message: [
      `TypeScript 类型检查失败（退出码 ${execution.status ?? 1}），推送已停止。`,
      '请根据上方 tsc/vue-tsc 输出修复类型根因和相关调用方。',
      '不得使用 any、@ts-ignore、@ts-nocheck、关闭 strict 选项或修改门禁绕过。',
      `修复后重新运行 npm run ${config.script}。`,
    ].join('\n') });
    return createGateResult({
      gateId: TYPE_CHECK_GATE_ID,
      status: 'violation',
      summary: 'TypeScript type check failed',
      diagnostics,
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
