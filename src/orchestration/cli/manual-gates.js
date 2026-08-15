import { loadConfig } from '../../config.js';
import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { defineExecutionPlan } from '../../core/capability/execution-plan.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { createProjectGateRegistry, gateRegistry } from '../../gates/registry.js';
import { collectWorkingTreeChanges } from '../../git-changes.js';
import { findRepositoryRoot } from '../../git.js';
import { orchestratePlan } from '../orchestrator.js';

function manualContext(root, config) {
  const changes = createChangeSet({
    source: 'manual',
    changes: collectWorkingTreeChanges(root),
  });
  return createGateContext({
    root,
    config,
    files: collectProjectFiles(root),
    changes,
    environment: 'manual',
  });
}

async function runManualGate(gate, {
  argumentsList = [],
  cwd = process.cwd(),
  registry = gateRegistry,
} = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const context = manualContext(root, config);
  const plan = defineExecutionPlan({
    id: `manual:${gate.id}`,
    environment: 'manual',
    steps: [gate.id],
  });
  const execution = await orchestratePlan({
    plan,
    registry,
    context,
    stopOnFailure: true,
    executeStep: async ({ context: executionContext }) => {
      const invocationContext = Object.freeze({ ...executionContext, argumentsList });
      const gatePlan = await gate.plan(invocationContext);
      return await gate.run({ ...invocationContext, plan: gatePlan });
    },
    onResult: ({ result }) => {
      writeGateResultConsole(result, { label: gate.manualCommand ?? gate.id });
    },
  });
  return execution.decisiveResult;
}

export async function runExternalManualGate(gateId, cwd = process.cwd()) {
  if (!gateId.startsWith('project.')) throw configurationError('manual-gate/not-external-gate', `${gateId} is not an external project gate`);
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const registry = createProjectGateRegistry(config);
  const gate = registry.get(gateId);
  if (!gate.environments.includes('manual')) {
    throw configurationError('manual-gate/unsupported-environment', `External gate ${gateId} does not support manual execution`);
  }
  return await runManualGate(gate, { cwd, registry });
}

export async function runRegisteredManualGate(
  command,
  argumentsList = [],
  cwd = process.cwd(),
) {
  const gate = gateRegistry.findByManualCommand(command);
  if (!gate) return null;
  return await runManualGate(gate, { argumentsList, cwd });
}
