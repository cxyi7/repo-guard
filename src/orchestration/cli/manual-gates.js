import { loadConfig } from '../../config.js';
import { gateResultToExitCode } from '../../core/result/gate-result.js';
import { collectProjectFiles } from '../../file-placement.js';
import { gateRegistry } from '../../gates/registry.js';
import { findRepositoryRoot } from '../../git.js';

export function runRegisteredManualGate(command, cwd = process.cwd()) {
  const gate = gateRegistry.findByManualCommand(command);
  if (!gate) return null;
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const plan = gate.plan({ root, config, files: collectProjectFiles(root) });
  const result = gate.run({ root, config, plan });
  for (const line of gate.renderConsole?.(result) ?? []) {
    if (line.stream === 'stderr') console.error(line.message);
    else console.log(line.message);
  }
  if (result.status === 'execution-error') throw new Error(result.error.message);
  const exitCode = gateResultToExitCode(result);
  return result.status === 'violation' && exitCode === 2 ? 1 : exitCode;
}
