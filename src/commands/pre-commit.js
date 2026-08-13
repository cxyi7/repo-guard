import {
  CONFIG_FILE,
  loadConfig,
  validateConfig,
} from '../config.js';
import { runStagedDependencyPolicy } from '../dependency-policy.js';
import { runEslintFiles } from '../eslint-runner.js';
import { findRepositoryRoot, runGit } from '../git.js';
import { runQualityGate } from '../quality-gate.js';
import { runQualityFiles } from '../quality-runner.js';
import { preCommitPlan } from '../orchestration/execution-plans.js';
import { runGate } from './gate.js';

function loadStagedConfig(root) {
  const result = runGit(['show', `:${CONFIG_FILE}`], {
    allowFailure: true,
    cwd: root,
  });
  if (result.status !== 0) return loadConfig(root);
  try {
    return validateConfig(JSON.parse(result.stdout), `${CONFIG_FILE} (staged)`);
  } catch (error) {
    throw new Error(`Invalid staged ${CONFIG_FILE}: ${error.message}`);
  }
}

export async function runPreCommit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const qualityExitCode = await runQualityGate({ cwd });
  if (qualityExitCode !== 0) {
    return qualityExitCode;
  }
  const config = loadStagedConfig(root);
  for (const step of preCommitPlan.steps.slice(-2)) {
    if (step.id === 'dependencies.policy' && config.dependencyPolicy.enabled) {
      const dependencyExitCode = runStagedDependencyPolicy({
        root,
        config: config.dependencyPolicy,
        exceptions: config.exceptions,
      });
      if (dependencyExitCode !== 0) return dependencyExitCode;
    }
    if (step.id === 'repository.protected-files') return await runGate({ cwd });
  }
  return 0;
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
    preset: eslintConfig.preset,
  });
}

export async function runQualityFileCommand(files, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  return await runQualityFiles({ root, files, config });
}
