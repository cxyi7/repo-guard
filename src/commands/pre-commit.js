import { loadConfig } from '../config.js';
import { runEslintFiles } from '../eslint-runner.js';
import { findRepositoryRoot } from '../git.js';
import { runQualityGate } from '../quality-gate.js';
import { runGate } from './gate.js';

export async function runPreCommit(cwd = process.cwd()) {
  const qualityExitCode = await runQualityGate({ cwd });
  if (qualityExitCode !== 0) {
    return qualityExitCode;
  }
  return await runGate({ cwd });
}

export async function runLintFiles(files, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const eslintConfig = config.preCommit.eslint;

  if (!eslintConfig.enabled) {
    throw new Error('ESLint staged-file gate is disabled by project configuration');
  }

  return await runEslintFiles({
    root,
    files,
    fix: eslintConfig.fix,
    maxWarnings: eslintConfig.maxWarnings,
  });
}
