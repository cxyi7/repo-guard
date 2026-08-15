import { loadConfig } from '../config/configuration-loader.js';
import { createChangeSet, createGateContext } from '../core/capability/gate-context.js';
import { defineExecutionPlan, validateExecutionPlan } from '../core/capability/execution-plan.js';
import { toRepoGuardError } from '../core/error/repo-guard-error.js';
import { writeGateResultConsole } from '../core/report/console-renderer.js';
import { collectStagedChanges } from '../git/change-collection.js';
import { findRepositoryRoot } from '../git/repository.js';
import { gateRegistry } from '../gates/registry.js';
import { orchestratePlan } from '../orchestration/orchestrator.js';

const protectedFilesManualPlan = validateExecutionPlan(defineExecutionPlan({
  id: 'manual:protected-files',
  environment: 'pre-commit',
  steps: [{
    id: 'repository.protected-files',
    gateId: 'repository.protected-files',
    mutation: 'external-write',
  }],
}), gateRegistry);

export async function runGate({
  cwd = process.cwd(),
  dryRun = false,
  forceNotify = false,
  context = null,
} = {}) {
  const root = context?.root ?? findRepositoryRoot(cwd);
  const config = context?.config ?? loadConfig(root);
  const changes = context?.changes ?? createChangeSet({
    source: 'manual',
    changes: collectStagedChanges(root),
  });
  const gateContext = context ?? createGateContext({
    root,
    environment: 'pre-commit',
    config,
    changes,
  });
  const invocationContext = Object.freeze({
    ...gateContext,
    dryRun,
    forceNotify,
  });
  const execution = await orchestratePlan({
    plan: protectedFilesManualPlan,
    registry: gateRegistry,
    context: invocationContext,
    stopOnFailure: true,
    onResult: ({ result }) => writeGateResultConsole(result, { label: 'protected-files' }),
  });
  if (execution.status.endsWith('-error')) {
    const decisiveError = execution.decisiveResult?.error;
    throw toRepoGuardError(decisiveError?.message ?? 'Protected-file gate could not complete', {
      kind: decisiveError?.kind ?? 'execution',
      code: decisiveError?.code ?? 'protected-files/execution-failed',
    });
  }
  return execution.exitCode;
}
