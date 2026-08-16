import { executionError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  executeArchitectureAnalysis,
  parseArchitectureReport,
} from '../../integrations/dependency-cruiser/architecture.js';

const ARCHITECTURE_GATE_ID = 'quality.architecture';

function violationSeverity(violation) {
  return violation?.rule?.severity ?? violation?.severity ?? 'warn';
}

function cycleModuleName(module) {
  if (typeof module === 'string') return module;
  if (typeof module?.name === 'string') return module.name;
  return '(unknown module)';
}

function formatCycle(cycle) {
  return Array.isArray(cycle) ? cycle.map(cycleModuleName).join(' -> ') : '';
}

function architectureRepairAdvice(ruleName) {
  if (ruleName === 'no-circular') {
    return '梳理循环链路和模块职责，提取双方共享的低层模块，建立单向依赖，并保持现有行为与公开接口兼容。';
  }
  if (ruleName === 'no-unresolved') {
    return '检查导入拼写、目标文件、包安装和路径别名；若属于别名解析配置缺失，应正确补全 architecture.tsConfig，不能用排除规则掩盖。';
  }
  if (ruleName === 'no-production-to-tests') {
    return '把生产代码需要复用的实现移到非测试模块，并让生产代码和测试代码分别依赖该共享模块。';
  }
  return '检查规则定义、依赖方向和相关调用方，修复违规根因并保持现有功能不变。';
}

export function runArchitectureGate({ root, config }) {
  const { execution } = executeArchitectureAnalysis({ root, config });
  if (execution.error) {
    if (execution.error.code === 'ETIMEDOUT') {
      return createGateResult({
        gateId: ARCHITECTURE_GATE_ID,
        status: 'execution-error',
        summary: `架构分析超过 ${config.timeoutMs}ms`,
        error: executionError(
          'architecture/timeout',
          `架构分析超过 ${config.timeoutMs}ms`,
          { cause: execution.error },
        ),
      });
    }
    throw executionError(
      'architecture/process-start-failed',
      `无法运行 dependency-cruiser： ${execution.error.message}`,
      { cause: execution.error },
    );
  }
  if (execution.status !== 0) {
    const message = `dependency-cruiser 执行失败，退出码为 ${execution.status}`;
    return createGateResult({
      gateId: ARCHITECTURE_GATE_ID,
      status: 'execution-error',
      summary: message,
      error: executionError('architecture/process-failed', message),
      diagnostics: processOutputDiagnostics(execution, {
        source: 'dependency-cruiser',
        root,
      }),
    });
  }
  const report = parseArchitectureReport(execution.stdout);
  const hasErrors = report.violations.some((violation) => (
    violationSeverity(violation) === 'error'
  ));
  if (hasErrors) {
    return createGateResult({
      gateId: ARCHITECTURE_GATE_ID,
      status: 'violation',
      summary: `架构检查发现 ${report.violations.length} 项违规`,
      findings: report.violations.map((violation) => ({
        ruleId: `architecture/${violation.rule?.name || 'dependency'}`,
        severity: violationSeverity(violation) === 'warn' ? 'warning' : 'error',
        message: violation.rule?.name || '架构依赖违规',
        location: violation.from ? { path: violation.from } : null,
        evidence: [
          violation.to ? `${violation.from} -> ${violation.to}` : null,
          formatCycle(violation.cycle),
        ].filter(Boolean).join('; ') || null,
        remediation: architectureRepairAdvice(violation.rule?.name || 'dependency'),
      })),
      metrics: { modules: report.modulesCruised, violations: report.violations.length },
    });
  }
  return createGateResult({
    gateId: ARCHITECTURE_GATE_ID,
    status: 'passed',
    summary: `架构检查已通过，共检查 ${report.modulesCruised} 个模块`,
    metrics: { modules: report.modulesCruised, violations: report.violations.length },
  });
}
