import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  isCoverageEnabled,
  isStructuredCoverage,
  prepareCoverageReports,
} from '../../integrations/vitest/coverage.js';
import { executeUnitTests } from '../../integrations/vitest/execution.js';
import { coverageFindings, inspectCoverageGate } from './coverage-gate.js';
import { inspectUnitTestPolicy, unitTestPolicyFindings } from './unit-test-policy.js';
import { validateUnitTestSetup } from './unit-test-setup.js';

export function runUnitTestGate({ root, config, changes }) {
  changeSetEntries(changes, '单元测试门禁变更集');
  const setup = validateUnitTestSetup(root, config);
  const policy = inspectUnitTestPolicy({ root, changes, config });
  if (policy.missingTests.length > 0
    || policy.bypasses.length > 0
    || policy.componentInteractions.length > 0) {
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'violation',
      summary: '单元测试策略失败',
      findings: unitTestPolicyFindings(policy),
      metrics: {
        missingTests: policy.missingTests.length,
        bypasses: policy.bypasses.length,
        componentInteractions: policy.componentInteractions.length,
      },
    });
  }

  const diagnostics = [{ level: 'info', message:
    `repo-guard 单元测试：Vitest ${setup.vitest.version}, `
    + `正在运行 npm 脚本 "${config.script}"`
    + `${isCoverageEnabled(config.coverage) ? '（包含覆盖率）' : ''}...` }];
  prepareCoverageReports(root, config.coverage);
  const result = executeUnitTests({ root, config });
  diagnostics.push(...processOutputDiagnostics(result, { source: 'vitest', root }));
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'execution-error',
        summary: `Unit tests 超过 ${config.timeoutMs}ms`,
        error: executionError(
          'unit-test/timeout',
          `Unit tests 超过 ${config.timeoutMs}ms`,
          { cause: result.error },
        ),
        diagnostics,
      });
    }
    const error = executionError(
      'unit-test/process-start-failed',
      `无法运行 unit tests: ${result.error.message}`,
      { cause: result.error },
    );
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  }
  if (result.status !== 0) {
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'violation',
      summary: `单元测试失败，退出码为 ${result.status ?? 1}`,
      diagnostics,
      findings: [processFailureFinding('quality.unit-test', {
        exitCode: result.status ?? 1,
        script: config.script,
      })],
    });
  }
  if (isStructuredCoverage(config.coverage)) {
    let coverageResult;
    try {
      coverageResult = inspectCoverageGate({ root, config, changes });
    } catch (error) {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'execution-error',
        summary: '覆盖率报告检查失败',
        error: toRepoGuardError(error, {
          kind: 'execution',
          code: 'coverage/report-inspection-failed',
        }),
        diagnostics,
        findings: [processFailureFinding('quality.unit-test', {
          phase: 'coverage-report',
          script: config.script,
        })],
      });
    }
    const findings = coverageFindings(coverageResult, root);
    if (!coverageResult.passed) {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'violation',
        summary: '覆盖率阈值未通过',
        diagnostics,
        findings,
      });
    }
  }
  diagnostics.push({ level: 'info', message: 'repo-guard 单元测试已通过。' });
  return createGateResult({
    gateId: 'quality.unit-test',
    status: 'passed',
    summary: `单元测试已通过，Vitest ${setup.vitest.version}`,
    diagnostics,
    metrics: { coverageEnabled: isCoverageEnabled(config.coverage) ? 1 : 0 },
  });
}
