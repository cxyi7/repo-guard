import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { terminalProcessOutput } from '../../core/execution/streaming-process.js';
import { processFailureFinding } from '../../core/result/process-failure-guidance.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { executeAccessibilityTests } from '../../integrations/npm/accessibility.js';
import { inspectAccessibilityTestSetup } from './accessibility-test-setup.js';

const ACCESSIBILITY_TEST_GATE_ID = 'quality.accessibility-test';

export async function runAccessibilityTestGate({
  root,
  config,
  signal = null,
  liveOutput = false,
  writeProgress = null,
}) {
  const inspection = inspectAccessibilityTestSetup(root, config);
  if (inspection.problems.length > 0) {
    return createGateResult({
      gateId: ACCESSIBILITY_TEST_GATE_ID,
      status: 'configuration-error',
      summary: `无障碍测试设置存在 ${inspection.problems.length} 个问题`,
      error: configurationError(
        'accessibility-test/invalid-setup',
        '无障碍测试设置无效',
      ),
      findings: inspection.problems.map((problem) => ({
        kind: 'configuration',
        ruleId: `accessibility-test/${problem.code}`,
        code: problem.code,
        severity: 'error',
        message: problem.message,
        location: {
          path: problem.path,
          ...(problem.line ? { line: problem.line } : {}),
        },
        expected: '可访问性测试必须具有可执行的 axe 扫描、零违规断言和完整依赖。',
        remediation: problem.remediation,
        decision: {
          aiAction: 'update-tests-or-configuration',
          humanApprovalRequired: false,
        },
      })),
    });
  }
  const integrations = inspection.integrations
    .map(({ name, version }) => `${name} ${version}`)
    .join(', ');
  const progressMessage = `repo-guard 无障碍测试： ${integrations}; `
    + `${inspection.files.length} 个文件, 正在运行 npm 脚本 "${config.script}"...`;
  if (liveOutput) writeProgress?.(progressMessage);
  const diagnostics = liveOutput ? [] : [{ level: 'info', message: progressMessage }];
  const result = await executeAccessibilityTests({
    root,
    config,
    signal,
    output: terminalProcessOutput(liveOutput),
  });
  if (!liveOutput) {
    diagnostics.push(...processOutputDiagnostics(result, { source: 'axe', root }));
  }
  if (result.error) {
    if (result.timedOut) {
      return createGateResult({
        gateId: ACCESSIBILITY_TEST_GATE_ID,
        status: 'execution-error',
        summary: `无障碍测试超过 ${config.timeoutMs}ms`,
        error: executionError(
          'accessibility-test/timeout',
          `无障碍测试超过 ${config.timeoutMs}ms`,
          { cause: result.error },
        ),
        diagnostics,
      });
    }
    const error = executionError(
      'accessibility-test/process-start-failed',
      `无法运行无障碍测试：${result.error.message}`,
      { cause: result.error },
    );
    return createGateResult({
      gateId: ACCESSIBILITY_TEST_GATE_ID,
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  }
  if (result.status !== 0) {
    return createGateResult({
      gateId: ACCESSIBILITY_TEST_GATE_ID,
      status: 'violation',
      summary: `无障碍测试失败，退出码为 ${result.status ?? 1}`,
      diagnostics,
      findings: [processFailureFinding(ACCESSIBILITY_TEST_GATE_ID, {
        exitCode: result.status ?? 1,
        script: config.script,
      })],
      metrics: { testFiles: inspection.files.length },
    });
  }
  diagnostics.push({ level: 'info', message: 'repo-guard 无障碍测试已通过。' });
  return createGateResult({
    gateId: ACCESSIBILITY_TEST_GATE_ID,
    status: 'passed',
    summary: `无障碍测试已通过（${integrations}; ${inspection.files.length} 个文件)`,
    diagnostics,
    metrics: { testFiles: inspection.files.length },
  });
}
