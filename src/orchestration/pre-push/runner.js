import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import { internalError } from '../../core/error/repo-guard-error.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../../core/report/console-renderer.js';
import { gateStatusToExitCode } from '../../core/result/gate-result.js';
import { gateRegistry } from '../../gates/registry.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { prePushPlan } from '../execution-plans.js';
import { orchestratePlan } from '../orchestrator.js';
import { collectPrePushChanges } from './change-range.js';
import { resolvePushConfig } from './push-configuration.js';

export async function runPrePush(cwd = process.cwd(), {
  input = '',
  remoteName = 'origin',
} = {}) {
  const root = findRepositoryRoot(cwd);
  const resolved = resolvePushConfig(root, input);
  if (resolved.skip) {
    writeConsoleMessage(`repo-guard pre-push: ${resolved.skipMessage}; quality gates skipped.`);
    return gateStatusToExitCode('skipped');
  }
  const { config } = resolved;
  const changeSet = createChangeSet({
    source: 'pre-push',
    changes: collectPrePushChanges({ input, remoteName, root }),
  });
  const context = createGateContext({
    root,
    environment: prePushPlan.environment,
    config,
    changes: changeSet,
  });
  const execution = await orchestratePlan({
    plan: prePushPlan,
    registry: gateRegistry,
    context,
    stopOnFailure: true,
    executeStep: async ({ context: stepContext, gate, step }) => {
      switch (step.id) {
      case 'quality.typecheck':
      case 'quality.unit-test':
      case 'quality.accessibility-test':
      case 'quality.architecture':
      case 'quality.build':
      case 'quality.lighthouse':
        {
          const gatePlan = await gate.plan(stepContext);
          return await gate.run({ ...stepContext, plan: gatePlan });
        }
      default:
        throw internalError(
          'pre-push/unsupported-plan-step',
          `Unsupported pre-push execution step: ${step.id}`,
        );
      }
    },
    onResult: ({ result, step }) => writeGateResultConsole(result, { label: step.id }),
  });
  return execution.exitCode;
}
