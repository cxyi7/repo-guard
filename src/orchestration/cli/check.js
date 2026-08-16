import { loadConfig } from '../../config/configuration-loader.js';
import { collectWorkingTreeChanges } from '../../git/change-collection.js';
import { classifyChanges, displayPath } from '../../policies/change-classification.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { assertLocalEnvironmentNotStaged } from '../../policies/local-environment.js';
import { createGateResult, gateStatusToExitCode } from '../../core/result/gate-result.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';

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
      summary: '工作树中没有受保护的变更',
      diagnostics: [{ level: 'info', message: `仓库： ${root}` }],
    });
    writeGateResultConsole(result, { label: 'check' });
    return gateStatusToExitCode(result.status);
  }
  const result = createGateResult({
    gateId: 'repository.protected-files',
    status: 'violation',
    summary: `发现 ${protectedChanges.length} 项受保护的工作树变更`,
    findings: protectedChanges.map((change) => ({
      ruleId: `repository/protected-${change.category}`,
      severity: 'error',
      message: `${change.status} ${displayPath(change)} 受保护`,
      location: { path: change.path },
      evidence: change.states?.length ? `Git 状态：${change.states.join('/')}` : null,
      remediation: '审查受保护的变更，并在继续之前取得所需的人工批准。',
    })),
  });
  writeGateResultConsole(result, { label: 'check' });
  return gateStatusToExitCode(result.status);
}
