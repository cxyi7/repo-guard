import { loadApiPerformanceConfiguration } from '../../integrations/api-performance/configuration.js';
import { executeApiPerformanceScenarios, summarizeApiPerformanceExecution } from '../../integrations/api-performance/execution.js';
import { prepareApiPerformanceReports, writeApiPerformanceReports } from '../../integrations/api-performance/project.js';
import { renderChineseApiPerformanceReport } from '../../integrations/api-performance/report.js';
import { toRepoGuardError } from '../../core/error/repo-guard-error.js';

function scenarioViolations(scenario) {
  const { statistics, thresholds } = scenario;
  const location = { path: scenario.modulePath };
  return [
    ...(statistics.p95Ms > thresholds.p95Ms ? [{
      ruleId: 'api-performance/p95-exceeded',
      severity: 'error',
      message: `场景“${scenario.name}”的 p95 耗时超过阈值`,
      location,
      evidence: `请求：${scenario.method} ${scenario.pathLabel}；实测 ${statistics.p95Ms.toFixed(2)}ms；阈值 ${thresholds.p95Ms.toFixed(2)}ms`,
      remediation: '检查服务端耗时、网络链路、Axios 拦截器和重试行为后重新手动测试。',
    }] : []),
    ...(statistics.p99Ms > thresholds.p99Ms ? [{
      ruleId: 'api-performance/p99-exceeded',
      severity: 'error',
      message: `场景“${scenario.name}”的 p99 耗时超过阈值`,
      location,
      evidence: `请求：${scenario.method} ${scenario.pathLabel}；实测 ${statistics.p99Ms.toFixed(2)}ms；阈值 ${thresholds.p99Ms.toFixed(2)}ms`,
      remediation: '定位长尾请求、超时、重试或后端慢调用后重新手动测试。',
    }] : []),
    ...(statistics.errorRate > thresholds.errorRate ? [{
      ruleId: 'api-performance/error-rate-exceeded',
      severity: 'error',
      message: `场景“${scenario.name}”的请求错误率超过阈值`,
      location,
      evidence: `请求：${scenario.method} ${scenario.pathLabel}；失败 ${statistics.failedSamples}/${statistics.samples}；实测 ${(statistics.errorRate * 100).toFixed(2)}%；阈值 ${(thresholds.errorRate * 100).toFixed(2)}%`,
      remediation: '检查测试凭据、接口可用性和失败响应后重新手动测试。',
    }] : []),
  ];
}

function externalReport(gateId, reports, execution) {
  const findings = execution.scenarios.flatMap(scenarioViolations);
  const passed = findings.length === 0;
  const metrics = summarizeApiPerformanceExecution(execution);
  return Object.freeze({
    schemaVersion: 1,
    gateId,
    status: passed ? 'passed' : 'violation',
    summary: passed
      ? `接口性能测试已通过，共验证 ${execution.scenarios.length} 个场景`
      : `接口性能测试未通过，共发现 ${findings.length} 项阈值违规`,
    findings,
    metrics,
    artifacts: [{
      path: reports.htmlRelative,
      type: 'api-performance-report-html',
      description: '中文接口性能测试报告',
    }],
  });
}

export async function runApiPerformanceExternalRunner({
  root,
  gateId,
  reportPath,
  configFile,
  environment = process.env,
}) {
  try {
    const reports = prepareApiPerformanceReports(root, reportPath);
    const configuration = await loadApiPerformanceConfiguration(root, configFile, environment);
    const target = configuration.resolvedTarget;
    const execution = await executeApiPerformanceScenarios(configuration, target);
    const report = externalReport(gateId, reports, execution);
    const html = renderChineseApiPerformanceReport({
      target,
      execution,
      passed: report.status === 'passed',
    });
    writeApiPerformanceReports(reports, report, html);
    return report;
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'execution',
      code: 'api-performance/run-failed',
      message: '接口性能测试执行失败',
    });
  }
}
