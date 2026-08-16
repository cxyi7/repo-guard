import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runProjectScript } from './run-script.js';

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError(
      'build/missing-package-json',
      '仓库根目录中找不到 package.json',
    );
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateBuildSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'build/missing-script',
      `构建门禁要求 package.json 提供脚本“${config.script}”`,
    );
  }
  return { command: command.trim() };
}

export async function executeProjectBuild({ root, config, signal = null, output = null }) {
  const setup = validateBuildSetup(root, config);
  const execution = await runProjectScript({
    root,
    script: config.script,
    timeoutMs: config.timeoutMs,
    signal,
    output,
  });
  return Object.freeze({ setup, execution });
}
