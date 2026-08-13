import { loadConfig } from '../config.js';
import { createChangeSet, createGateContext } from '../core/capability/gate-context.js';
import { gateResultToExitCode } from '../core/result/gate-result.js';
import { writeGateResultConsole } from '../core/report/console-renderer.js';
import { collectStagedChanges } from '../git-changes.js';
import { findRepositoryRoot } from '../git.js';
import { protectedFilesGate } from '../gates/repository/native-policy-gates.js';

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
    step: Object.freeze({
      id: protectedFilesGate.id,
      gateId: protectedFilesGate.id,
      mutation: protectedFilesGate.mutation,
    }),
  });
  const plan = protectedFilesGate.plan(invocationContext);
  const result = await protectedFilesGate.run({ ...invocationContext, plan });
  writeGateResultConsole(result, { label: 'protected-files' });
  return gateResultToExitCode(result);
}
