import { loadConfig } from '../config.js';
import { collectWorkingTreeChanges } from '../git/change-collection.js';
import { classifyChanges, displayPath } from '../policies/change-classification.js';
import { findRepositoryRoot } from '../git/repository.js';
import { assertLocalEnvironmentNotStaged } from '../policies/local-environment.js';
import { createGateResult, gateStatusToExitCode } from '../core/result/gate-result.js';
import { writeGateResultConsole } from '../core/report/console-renderer.js';

export function runCheck(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const changes = collectWorkingTreeChanges(root);
  assertLocalEnvironmentNotStaged(
    changes.filter(({ states }) => states.includes('staged')),
  );
  const protectedChanges = classifyChanges(changes, config);

  if (protectedChanges.length === 0) {
    const result = createGateResult({
      gateId: 'repository.protected-files',
      status: 'passed',
      summary: 'No protected working tree changes',
      diagnostics: [{ level: 'info', message: `Repository: ${root}` }],
    });
    writeGateResultConsole(result, { label: 'check' });
    return gateStatusToExitCode(result.status);
  }
  const result = createGateResult({
    gateId: 'repository.protected-files',
    status: 'violation',
    summary: `Found ${protectedChanges.length} protected working tree change(s)`,
    findings: protectedChanges.map((change) => ({
      ruleId: `repository/protected-${change.category}`,
      severity: 'error',
      message: `${change.status} ${displayPath(change)} is protected`,
      location: { path: change.path },
      evidence: change.states?.length ? `Git states: ${change.states.join('/')}` : null,
      remediation: 'Review the protected change and obtain the required human approval before proceeding.',
    })),
  });
  writeGateResultConsole(result, { label: 'check' });
  return gateStatusToExitCode(result.status);
}
