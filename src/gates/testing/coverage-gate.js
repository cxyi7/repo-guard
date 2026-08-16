import path from 'node:path';
import { normalizeGitPath } from '../../config/path-matching.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import {
  COVERAGE_METRICS,
  inspectCoverageReports,
} from '../../integrations/vitest/coverage.js';

export function inspectCoverageGate({ root, config, changes }) {
  const report = inspectCoverageReports({
    root,
    config,
    changes: changeSetEntries(changes, '覆盖率变更集'),
  });
  if (!report) return null;

  const global = Object.fromEntries(COVERAGE_METRICS.map((name) => {
    const threshold = config.coverage.thresholds[name];
    return [name, {
      ...report.global[name],
      passed: report.global[name].percentage >= threshold,
      threshold,
    }];
  }));
  const threshold = config.coverage.thresholds.changedLines;
  const changed = {
    ...report.changed,
    passed: report.changed.missingFiles.length === 0
      && report.changed.percentage >= threshold,
    threshold,
  };
  return {
    ...report,
    changed,
    global,
    passed: Object.values(global).every(({ passed }) => passed) && changed.passed,
  };
}

function coverageFinding(ruleId, label, metric, evidence = null) {
  return {
    ruleId,
    severity: 'error',
    message: `${label} 覆盖率为 ${metric.percentage.toFixed(2)}%；要求至少 ${metric.threshold}%`,
    evidence: evidence ?? `已覆盖 ${metric.covered}/${metric.total} 个项目。`,
    remediation: (
      '为未覆盖的行为添加有效测试，且不得排除生产代码、'
      + '复用过期报告或降低已配置阈值。'
    ),
  };
}

export function coverageFindings(result, root) {
  const findings = COVERAGE_METRICS
    .filter((name) => !result.global[name].passed)
    .map((name) => coverageFinding(`coverage/${name}`, name, result.global[name]));

  if (!result.changed.passed) {
    const details = [
      result.changed.missingFiles.length > 0
        ? `缺少 LCOV 文件：${result.changed.missingFiles.join(', ')}`
        : null,
      result.changed.uncovered.length > 0
        ? `Uncovered changed lines: ${result.changed.uncovered.slice(0, 30).join(', ')}`
        : null,
      `Reports: ${normalizeGitPath(path.relative(root, result.reports.directory))}`,
    ].filter(Boolean).join('; ');
    findings.push(coverageFinding(
      'coverage/changed-lines',
      'changed-line',
      result.changed,
      details,
    ));
  }
  return findings;
}
