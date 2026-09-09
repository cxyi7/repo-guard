import {
  createChangeSet,
} from '../../core/capability/gate-context.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../../core/report/console-renderer.js';
import { gateStatusToExitCode } from '../../core/result/gate-result.js';
import { gateRegistry } from '../../gates/registry.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { prePushPlan } from '../execution-plans.js';
import { orchestratePlan } from '../orchestrator.js';
import {
  collectPrePushChanges,
  resolvePrePushRevision,
} from './change-range.js';
import { resolvePushConfig } from './push-configuration.js';
import { createWorkspaceTargets, workspaceStepTargets, projectStepLabel } from '../workspace/targets.js';

export async function runPrePush(cwd = process.cwd(), {
  input = '',
  remoteName = 'origin',
} = {}) {
  const root = findRepositoryRoot(cwd);
  const resolved = resolvePushConfig(root, input);
  if (resolved.skip) {
    writeConsoleMessage(`repo-guard pre-push： ${resolved.skipMessage}；已跳过质量门禁。`);
    return gateStatusToExitCode('skipped');
  }
  const { workspace } = resolved;
  const changeSet = createChangeSet({
    source: 'pre-push',
    changes: collectPrePushChanges({ input, remoteName, root }),
    revision: resolvePrePushRevision({ input, remoteName, root }),
  });
  const targets = createWorkspaceTargets({
    workspace,
    environment: prePushPlan.environment,
    changes: changeSet,
  });
  const execution = await orchestratePlan({
    plan: prePushPlan,
    registry: gateRegistry,
    context: targets.repository,
    contextsForStep: ({ step }) => workspaceStepTargets(targets, step),
    stopOnFailure: true,
    onResult: ({ context, result, step }) => writeGateResultConsole(result, { label: projectStepLabel(context, step) }),
  });
  return execution.exitCode;
}
