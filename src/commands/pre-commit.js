import {
  CONFIG_FILE,
  loadConfig,
  validateConfig,
} from '../config.js';
import { runStagedDependencyPolicy } from '../dependency-policy.js';
import { runEslintFiles } from '../eslint-runner.js';
import { findRepositoryRoot, runGit } from '../git.js';
import { collectStagedChanges } from '../git-changes.js';
import { runQualityGate } from '../quality-gate.js';
import { runQualityExecution } from '../quality-runner.js';
import {
  createChangeSet,
  createGateContext,
} from '../core/capability/gate-context.js';
import { createGateResult } from '../core/result/gate-result.js';
import { adaptNumericRunner } from '../core/result/numeric-runner-adapter.js';
import { gateRegistry } from '../gates/registry.js';
import { orchestratePlan } from '../orchestration/orchestrator.js';
import { preCommitPolicyPlan } from '../orchestration/pre-commit/protected-plan.js';
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
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: collectStagedChanges(root),
  });
  const context = createGateContext({
    root,
    environment: preCommitPolicyPlan.environment,
    config,
    changes,
  });
  const execution = await orchestratePlan({
    plan: preCommitPolicyPlan,
    registry: gateRegistry,
    context,
    stopOnFailure: true,
    executeStep: async ({ step }) => {
      let task;
      switch (step.id) {
        case 'dependencies.policy':
          if (!config.dependencyPolicy.enabled) {
            return createGateResult({
              gateId: step.gateId,
              status: 'skipped',
              summary: 'Staged dependency policy is disabled',
            });
          }
          task = () => runStagedDependencyPolicy({
            root,
            config: config.dependencyPolicy,
            exceptions: config.exceptions,
          });
          break;
        case 'repository.protected-files':
          task = () => runGate({ cwd, context });
          break;
        default:
          throw new Error(`Unsupported protected pre-commit policy step: ${step.id}`);
      }
      return await adaptNumericRunner({
        gateId: step.gateId,
        task,
        captureDiagnostics: false,
      });
    },
  });
  if (execution.status.endsWith('-error')) {
    const error = new Error(
      execution.decisiveResult?.error?.message ?? 'Pre-commit policy could not complete',
    );
    if (execution.decisiveResult?.error?.code) {
      error.code = execution.decisiveResult.error.code;
    }
    throw error;
  }
  return execution.exitCode === 0 ? 0 : 1;
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
  const execution = await runQualityExecution({ root, files, config });
  if (execution.status.endsWith('-error')) {
    const error = new Error(
      execution.decisiveResult?.error?.message ?? 'Quality gate could not complete',
    );
    if (execution.decisiveResult?.error?.code) {
      error.code = execution.decisiveResult.error.code;
    }
    throw error;
  }
  return execution.exitCode === 0 ? 0 : 1;
}
