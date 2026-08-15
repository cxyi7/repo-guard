import { loadConfig } from '../../config/configuration-loader.js';
import { validateConfig } from '../../config/configuration-validation.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import {
  configurationError,
  internalError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { gateRegistry } from '../../gates/registry.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { runGit } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { orchestratePlan } from '../orchestrator.js';
import { runQualityGate } from './lint-staged-gate.js';
import { preCommitPolicyPlan } from './protected-plan.js';

function loadStagedConfig(root) {
  const result = runGit(['show', `:${CONFIG_FILE}`], {
    allowFailure: true,
    cwd: root,
  });
  if (result.status !== 0) return loadConfig(root);
  try {
    return validateConfig(JSON.parse(result.stdout), `${CONFIG_FILE} (staged)`);
  } catch (error) {
    throw configurationError(
      'pre-commit/invalid-staged-config',
      `Invalid staged ${CONFIG_FILE}: ${error.message}`,
      { cause: error },
    );
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
    executeStep: async ({ context: stepContext, gate, step }) => {
      switch (step.id) {
        case 'dependencies.policy':
          {
            const gatePlan = await gate.plan(stepContext);
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        case 'repository.protected-files':
          {
            const gatePlan = await gate.plan(stepContext);
            return await gate.run({ ...stepContext, plan: gatePlan });
          }
        default:
          throw internalError(
            'pre-commit/unsupported-plan-step',
            `Unsupported protected pre-commit policy step: ${step.id}`,
          );
      }
    },
    onResult: ({ result, step }) => writeGateResultConsole(result, { label: step.id }),
  });
  if (execution.status.endsWith('-error')) {
    const decisiveError = execution.decisiveResult?.error;
    throw toRepoGuardError(
      decisiveError?.message ?? 'Pre-commit policy could not complete',
      {
      kind: decisiveError?.kind ?? 'execution',
      code: decisiveError?.code ?? 'pre-commit/policy-failed',
      },
    );
  }
  return execution.exitCode === 0 ? 0 : 1;
}
