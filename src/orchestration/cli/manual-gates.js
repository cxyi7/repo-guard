import { loadConfig } from '../../config.js';
import { gateResultToExitCode } from '../../core/result/gate-result.js';
import { collectProjectFiles } from '../../file-placement.js';
import { gateRegistry } from '../../gates/registry.js';
import { findRepositoryRoot } from '../../git.js';
import { executeRegisteredGate } from '../gate-executor.js';
import { legacyManualBindings } from './manual-bindings.js';

export async function runNativeManualGate(gate, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const result = await executeRegisteredGate({
    gate,
    context: {
      root,
      config,
      files: collectProjectFiles(root),
      changes: null,
      revision: null,
      environment: 'manual',
    },
  });
  for (const line of gate.renderConsole?.(result) ?? []) {
    if (line.stream === 'stderr') console.error(line.message);
    else console.log(line.message);
  }
  if (result.status === 'execution-error') throw new Error(result.error.message);
  const exitCode = gateResultToExitCode(result);
  return result.status === 'violation' && exitCode === 2 ? 1 : exitCode;
}

export async function runRegisteredManualGate(
  command,
  argumentsList = [],
  cwd = process.cwd(),
) {
  const gate = gateRegistry.findByManualCommand(command);
  if (!gate) return null;
  const legacyBinding = legacyManualBindings[gate.id];
  if (legacyBinding) return await legacyBinding({ argumentsList, cwd, gate });
  return await runNativeManualGate(gate, cwd);
}
