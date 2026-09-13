import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runProjectScript } from './run-script.js';
import { inspectTypecheckOptions, executeTypecheckOptions } from './typecheck-options.js';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError(
      'typecheck/missing-package-json',
      '仓库根目录中找不到 package.json',
    );
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateTypeCheckSetup(root, config) {
  if (config.options) return inspectTypecheckOptions(root, config.options);
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'typecheck/missing-script',
      `TypeScript 门禁要求 package.json 提供脚本“${config.script}”`,
    );
  }
  return { command: command.trim() };
}

export async function executeProjectTypeCheck({ root, config, signal = null, output = null }) {
  if (config.options) {
    const result = await executeTypecheckOptions({ root, config, signal, output });
    const script = readProjectPackage(root).scripts?.[config.script];
    if (typeof script === 'string' && script.trim()) result.executions.push(await runProjectScript({ root, script: config.script, timeoutMs: config.timeoutMs, signal, output }));
    return result;
  }
  const setup = validateTypeCheckSetup(root, config);
  const execution = await runProjectScript({
    root,
    script: config.script,
    timeoutMs: config.timeoutMs,
    signal,
    output,
  });
  return Object.freeze({ setup, execution });
}
