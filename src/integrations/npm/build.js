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
  let cleanCommand = null;
  if (config.artifactBudget?.enabled && config.artifactBudget.cleanScript) {
    cleanCommand = packageJson.scripts?.[config.artifactBudget.cleanScript];
    if (typeof cleanCommand !== 'string' || !cleanCommand.trim()) {
      throw configurationError(
        'build/missing-clean-script',
        `产物预算要求 package.json 提供清理脚本“${config.artifactBudget.cleanScript}”`,
      );
    }
    cleanCommand = cleanCommand.trim();
  }
  return { command: command.trim(), cleanCommand };
}

export async function executeProjectBuildClean({ root, config, signal = null, output = null }) {
  if (!config.artifactBudget?.enabled || !config.artifactBudget.cleanScript) return null;
  validateBuildSetup(root, config);
  return runProjectScript({
    root,
    script: config.artifactBudget.cleanScript,
    timeoutMs: config.timeoutMs,
    signal,
    output,
  });
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
