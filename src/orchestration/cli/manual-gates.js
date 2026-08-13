import { loadConfig } from '../../config.js';
import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { defineExecutionPlan } from '../../core/capability/execution-plan.js';
import { createGateRegistry } from '../../core/capability/gate-registry.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';
import { collectProjectFiles } from '../../file-placement.js';
import { gateRegistry } from '../../gates/registry.js';
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
      if (gate.renderConsole) {
        for (const line of gate.renderConsole(result)) {
          if (line.stream === 'stderr') console.error(line.message);
          else console.log(line.message);
        }
        return;
      }
      writeGateResultConsole(result, { label: gate.manualCommand ?? gate.id });
    },
  });
  return execution.decisiveResult;
}

export async function runNativeManualGate(gate, cwd = process.cwd()) {
  return await runManualGate(gate, {
    cwd,
    registry: createGateRegistry([gate]),
  });
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
