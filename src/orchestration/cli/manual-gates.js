import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { defineExecutionPlan } from '../../core/capability/execution-plan.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { createProjectGateRegistry, gateRegistry } from '../../gates/registry.js';
import { collectWorkingTreeChanges } from '../../git/change-collection.js';
import { orchestratePlan } from '../orchestrator.js';
import { loadExecutionTarget } from '../workspace/project-selection.js';
import { REPOSITORY_GATE_IDS } from '../../gates/project-applicability.js';

function manualContext(root, config, repositoryRoot) {
  const changes = createChangeSet({
    source: 'manual',
    changes: collectWorkingTreeChanges(root),
  });
  return createGateContext({
    root,
    repositoryRoot,
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
  projectId,
} = {}) {
  const { root, config, repositoryRoot } = loadExecutionTarget(cwd, {
    projectId,
    repositoryOnly: gate.id !== 'dependencies.policy' && REPOSITORY_GATE_IDS.has(gate.id),
  });
  const context = manualContext(root, config, repositoryRoot);
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

export async function runExternalManualGate(gateId, cwd = process.cwd(), options = {}) {
  if (!gateId.startsWith('project.')) throw configurationError('manual-gate/not-external-gate', `${gateId} 不是外部项目门禁`);
  const { config } = loadExecutionTarget(cwd, options);
  const registry = createProjectGateRegistry(config);
  const gate = registry.get(gateId);
  if (!gate.environments.includes('manual')) {
    throw configurationError('manual-gate/unsupported-environment', `外部门禁 ${gateId} 不支持手动执行`);
  }
  return await runManualGate(gate, { cwd, registry, ...options });
}

export async function runRegisteredManualGate(
  command,
  argumentsList = [],
  cwd = process.cwd(),
  options = {},
) {
  const gate = gateRegistry.findByManualCommand(command);
  if (!gate) return null;
  return await runManualGate(gate, { argumentsList, cwd, ...options });
}
