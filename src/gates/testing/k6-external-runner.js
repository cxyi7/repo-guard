import {
  configurationError,
  executionError,
  securityError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { k6Options, loadK6Configuration } from '../../integrations/k6/configuration.js';
import { executeK6LoadTest } from '../../integrations/k6/execution.js';
import {
  prepareK6ReportFiles,
  readK6RawSummary,
  removeK6ControlledEntry,
  writeK6ControlledEntry,
  writeK6FinalReports,
} from '../../integrations/k6/project.js';
import { normalizeK6Summary, renderChineseK6Report } from '../../integrations/k6/report.js';
import { validateK6Script } from '../../integrations/k6/script-validation.js';

const K6_THRESHOLD_FAILURE_EXIT_CODE = 99;
const LIFECYCLE_ALLOWANCE_MS = 2 * 60 * 1000;
const PROCESS_ALLOWANCE_MS = 30 * 1000;

function thresholdFindings(configuration, metrics) {
  const { thresholds, script } = configuration;
  const location = { path: script.relative };
  return [
    ...(metrics.p95Ms > thresholds.p95Ms ? [{
      ruleId: 'k6-load/p95-exceeded',
      severity: 'error',
      message: 'k6 压测的 p95 耗时超过阈值',
      location,
      evidence: `实测 ${metrics.p95Ms.toFixed(2)}ms；阈值 ${thresholds.p95Ms.toFixed(2)}ms`,
      remediation: '检查服务端耗时、网络链路和负载模型后重新手动压测。',
    }] : []),
    ...(metrics.p99Ms > thresholds.p99Ms ? [{
      ruleId: 'k6-load/p99-exceeded',
      severity: 'error',
      message: 'k6 压测的 p99 长尾耗时超过阈值',
      location,
      evidence: `实测 ${metrics.p99Ms.toFixed(2)}ms；阈值 ${thresholds.p99Ms.toFixed(2)}ms`,
      remediation: '定位慢请求、资源争用、超时和服务端长尾调用后重新手动压测。',
    }] : []),
    ...(metrics.failedRequestRate > thresholds.errorRate ? [{
      ruleId: 'k6-load/error-rate-exceeded',
      severity: 'error',
      message: 'k6 压测的请求错误率超过阈值',
      location,
      evidence: `实测 ${(metrics.failedRequestRate * 100).toFixed(2)}%；阈值 ${(thresholds.errorRate * 100).toFixed(2)}%`,
      remediation: '检查测试凭据、接口容量、限流和失败响应后重新手动压测。',
    }] : []),
    ...(metrics.checkRate < thresholds.checkRate ? [{
      ruleId: 'k6-load/check-rate-below-threshold',
      severity: 'error',
      message: 'k6 压测的检查成功率低于阈值',
      location,
      evidence: `实测 ${(metrics.checkRate * 100).toFixed(2)}%；阈值 ${(thresholds.checkRate * 100).toFixed(2)}%`,
      remediation: '检查状态码、响应断言和测试数据后重新手动压测。',
    }] : []),
    ...(metrics.droppedIterations > thresholds.maxDroppedIterations ? [{
      ruleId: 'k6-load/dropped-iterations-exceeded',
      severity: 'error',
      message: 'k6 压测的丢弃迭代数超过阈值',
      location,
      evidence: `实测 ${metrics.droppedIterations}；阈值 ${thresholds.maxDroppedIterations}`,
      remediation: '检查负载发生器容量、预分配 VU 和目标系统吞吐能力后重新手动压测。',
    }] : []),
  ];
}

function externalMetrics(metrics) {
  return Object.freeze({
    httpRequests: metrics.httpRequests,
    iterations: metrics.iterations,
    failedRequestRate: metrics.failedRequestRate,
    checkRate: metrics.checkRate,
    totalChecks: metrics.totalChecks,
    passedChecks: metrics.passedChecks,
    droppedIterations: metrics.droppedIterations,
    maximumVUs: metrics.maximumVUs,
    requestsPerSecond: metrics.requestsPerSecond,
    averageMs: metrics.averageMs,
    minimumMs: metrics.minimumMs,
    medianMs: metrics.medianMs,
    p90Ms: metrics.p90Ms,
    p95Ms: metrics.p95Ms,
    p99Ms: metrics.p99Ms,
    maximumMs: metrics.maximumMs,
  });
}

function createExternalReport(gateId, reports, configuration, metrics) {
  const findings = thresholdFindings(configuration, metrics);
  const passed = findings.length === 0;
  return Object.freeze({
    schemaVersion: 1,
    gateId,
    status: passed ? 'passed' : 'violation',
    summary: passed
      ? `k6 压测已通过，配置档“${configuration.profile.name}”共执行 ${metrics.httpRequests} 个 HTTP 请求`
      : `k6 压测未通过，共发现 ${findings.length} 项阈值违规`,
    findings,
    metrics: externalMetrics(metrics),
    artifacts: Object.freeze([
      Object.freeze({
        path: reports.rawRelative,
        type: 'k6-machine-summary-json',
        description: 'k6 原始机器摘要',
      }),
      Object.freeze({
        path: reports.htmlRelative,
        type: 'k6-load-report-html',
        description: '中文 k6 接口压测报告',
      }),
    ]),
  });
}

function assertGateTimeout(configuration, timeoutMs) {
  const required = configuration.profile.expectedMaxDurationMs
    + LIFECYCLE_ALLOWANCE_MS
    + PROCESS_ALLOWANCE_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < required) {
    throw configurationError(
      'k6-load/external-gate-timeout-too-small',
      `k6 外部门禁 timeoutMs 至少需要 ${required}，当前为 ${String(timeoutMs)}`,
      {
        expected: '外部门禁超时必须覆盖压测阶段、gracefulStop、setup、teardown 和报告生成。',
      },
    );
  }
}

export async function runK6ExternalRunner({
  root,
  gateId,
  reportPath,
  configFile,
  timeoutMs,
  environment = process.env,
  runtime,
  output = null,
}) {
  let reports;
  try {
    reports = prepareK6ReportFiles(root, reportPath);
    const configuration = loadK6Configuration(root, configFile, environment);
    assertGateTimeout(configuration, timeoutMs);
    validateK6Script(root, configuration);
    writeK6ControlledEntry(reports, configuration, k6Options(configuration));
    const execution = await executeK6LoadTest({
      root,
      configuration,
      reports,
      timeoutMs: timeoutMs - 5000,
      environment,
      runtime,
      output,
    });
    const metrics = normalizeK6Summary(readK6RawSummary(reports), {
      scenarioName: configuration.profile.name,
    });
    if (metrics.maximumVUs > configuration.profile.maxVUs) {
      throw securityError(
        'k6-load/executed-vus-exceeded',
        `k6 实际最大 VU ${metrics.maximumVUs} 超过受控配置 ${configuration.profile.maxVUs}`,
      );
    }
    const report = createExternalReport(gateId, reports, configuration, metrics);
    const expectedProcessStatus = report.status === 'passed' ? 0 : K6_THRESHOLD_FAILURE_EXIT_CODE;
    if (execution.process.status !== expectedProcessStatus) {
      throw executionError(
        'k6-load/process-status-mismatch',
        `k6 指标判定为 ${report.status} 时进程退出码应为 ${expectedProcessStatus}；实际为 ${String(execution.process.status)}`,
        {
          expected: 'k6 只有在全部阈值通过时返回 0，阈值违规时返回 99；其他退出码表示执行错误。',
        },
      );
    }
    const html = renderChineseK6Report({
      configuration,
      metrics,
      passed: report.status === 'passed',
      k6Version: execution.k6Version,
    });
    writeK6FinalReports(reports, report, html);
    return report;
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'k6-load/run-failed',
      message: 'k6 接口压测执行失败',
    });
  } finally {
    if (reports) removeK6ControlledEntry(reports);
  }
}
