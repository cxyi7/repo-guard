import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGateResult } from './core/result/gate-result.js';
import { resolveProjectPackageMetadata } from './project-package.js';

const ARCHITECTURE_GATE_ID = 'quality.architecture';

function resolveDependencyCruiser(root) {
  const metadata = resolveProjectPackageMetadata(
    root,
    'dependency-cruiser',
    'Architecture dependency gate',
    { requireEntry: false },
  );
  const packageJson = JSON.parse(readFileSync(metadata.packagePath, 'utf8'));
  const bin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.['dependency-cruiser']
      ?? packageJson.bin?.['dependency-cruise']
      ?? packageJson.bin?.depcruise;
  if (typeof bin !== 'string' || !bin.trim()) {
    throw new Error('Installed dependency-cruiser does not expose a supported CLI binary');
  }
  const cliPath = path.resolve(path.dirname(metadata.packagePath), bin);
  if (!existsSync(cliPath)) {
    throw new Error(`dependency-cruiser CLI was not found: ${cliPath}`);
  }
  return { ...metadata, cliPath };
}

function resolveTypeScriptConfig(root, configuredPath) {
  if (configuredPath) return configuredPath;
  return existsSync(path.join(root, 'tsconfig.json')) ? 'tsconfig.json' : null;
}

export function validateArchitectureSetup(root, config) {
  const dependencyCruiser = resolveDependencyCruiser(root);
  const optionLikeSource = config.sourcePaths.find((sourcePath) => sourcePath.startsWith('-'));
  if (optionLikeSource) {
    throw new Error(`Architecture source path cannot start with "-": ${optionLikeSource}`);
  }
  const missingSources = config.sourcePaths.filter((sourcePath) => (
    !/[?*{}[\]]/.test(sourcePath) && !existsSync(path.join(root, sourcePath))
  ));
  if (missingSources.length > 0) {
    throw new Error(
      `Architecture source path does not exist: ${missingSources.join(', ')}`,
    );
  }
  const tsConfig = resolveTypeScriptConfig(root, config.tsConfig);
  if (tsConfig && !existsSync(path.join(root, tsConfig))) {
    throw new Error(`Architecture tsConfig does not exist: ${tsConfig}`);
  }
  return { dependencyCruiser, tsConfig };
}

export function detectProjectArchitectureSetup(root, config) {
  try {
    return { ready: true, setup: validateArchitectureSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

export function createDependencyCruiserConfig(config, { tsConfig = null } = {}) {
  return {
    forbidden: config.rules.map((rule) => ({ ...rule })),
    options: {
      doNotFollow: { path: 'node_modules' },
      ...(config.exclude === null ? {} : { exclude: { path: config.exclude } }),
      ...(tsConfig ? { tsConfig: { fileName: tsConfig } } : {}),
    },
  };
}

export function parseArchitectureReport(output) {
  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`dependency-cruiser returned invalid JSON: ${error.message}`);
  }
  const violations = report?.summary?.violations;
  if (!Array.isArray(violations)) {
    throw new Error('dependency-cruiser JSON report is missing summary.violations');
  }
  return {
    modulesCruised: Number.isInteger(report.summary.totalCruised)
      ? report.summary.totalCruised
      : Array.isArray(report.modules) ? report.modules.length : 0,
    violations,
  };
}

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

function formatViolation(violation, index) {
  const severity = violationSeverity(violation);
  const ruleName = violation?.rule?.name ?? violation?.ruleName ?? 'unnamed';
  const from = violation?.from ?? violation?.module ?? '(unknown source)';
  const to = violation?.to ? ` -> ${violation.to}` : '';
  const cycle = Array.isArray(violation?.cycle) && violation.cycle.length > 0
    ? `\n     cycle: ${formatCycle(violation.cycle)}`
    : '';
  return `  ${index + 1}. [${severity}] ${ruleName}: ${from}${to}${cycle}`;
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

export function buildArchitectureAiRepairInstructions({ root, violations }) {
  const blockingViolations = violations.filter((violation) => (
    violationSeverity(violation) === 'error'
  ));
  const normalizedRoot = path.resolve(root).replace(/\\/g, '/');
  const sections = blockingViolations.map((violation, index) => {
    const ruleName = violation?.rule?.name ?? violation?.ruleName ?? 'unnamed';
    const from = violation?.from ?? violation?.module ?? '(unknown source)';
    const to = violation?.to ?? '(unknown target)';
    const cycle = formatCycle(violation?.cycle);
    return [
      `${index + 1}. 请修复依赖架构规则 ${ruleName} 的违规。`,
      `   项目根目录：${normalizedRoot}`,
      `   依赖关系：${from} -> ${to}`,
      ...(cycle ? [`   完整循环链路：${from} -> ${cycle}`] : []),
      `   修复建议：${architectureRepairAdvice(ruleName)}`,
      '   修改范围：只修改解决该依赖问题所必需的源码、测试和合法解析配置，不处理无关问题。',
      '   禁止绕过：不得关闭、删除、降级或忽略架构规则，不得缩小 sourcePaths、扩大 exclude，或伪造 dependency-cruiser 结果。',
      '   验证要求：修复后运行 npm run guard:architecture，并运行受影响模块已有的测试和生产构建。',
    ].join('\n');
  });

  return [
    '依赖架构门禁失败，以下完整指令可按编号分别复制给 AI 修复：',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

export function formatArchitectureReport(result, version = 'unknown') {
  const errors = result.violations.filter((violation) => (
    violationSeverity(violation) === 'error'
  )).length;
  const warnings = result.violations.filter((violation) => (
    violationSeverity(violation) === 'warn'
  )).length;
  return [
    `repo-guard architecture report: dependency-cruiser ${version}, `
      + `${result.modulesCruised} modules, ${result.violations.length} violations `
      + `(${errors} errors, ${warnings} warnings).`,
    ...result.violations.map(formatViolation),
  ].join('\n');
}

export function runArchitectureGate({ root, config }) {
  const setup = validateArchitectureSetup(root, config);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'repo-guard-architecture-'));
  const temporaryConfig = path.join(temporaryRoot, 'dependency-cruiser.config.json');
  try {
    writeFileSync(
      temporaryConfig,
      `${JSON.stringify(createDependencyCruiserConfig(config, setup), null, 2)}\n`,
      'utf8',
    );
    const execution = spawnSync(
      process.execPath,
      [
        setup.dependencyCruiser.cliPath,
        '--output-type',
        'json',
        '--config',
        temporaryConfig,
        '--',
        ...config.sourcePaths,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: config.timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (execution.error) {
      if (execution.error.code === 'ETIMEDOUT') {
        return createGateResult({
          gateId: ARCHITECTURE_GATE_ID,
          status: 'execution-error',
          summary: `Architecture analysis exceeded ${config.timeoutMs}ms`,
          error: execution.error,
        });
      }
      throw new Error(`Unable to run dependency-cruiser: ${execution.error.message}`);
    }
    if (execution.status !== 0) {
      const details = execution.stderr?.trim() || execution.stdout?.trim();
      throw new Error(
        `dependency-cruiser failed with exit code ${execution.status}`
        + `${details ? `:\n${details}` : ''}`,
      );
    }
    const report = parseArchitectureReport(execution.stdout);
    const formatted = formatArchitectureReport(report, setup.dependencyCruiser.version);
    const hasErrors = report.violations.some((violation) => (
      violationSeverity(violation) === 'error'
    ));
    if (hasErrors) {
      return createGateResult({
        gateId: ARCHITECTURE_GATE_ID,
        status: 'violation',
        summary: `Architecture found ${report.violations.length} violation(s)`,
        findings: report.violations.map((violation) => ({
          ruleId: `architecture/${violation.rule?.name || 'dependency'}`,
          severity: violationSeverity(violation) === 'warn' ? 'warning' : 'error',
          message: violation.rule?.name || 'Architecture dependency violation',
          location: violation.from ? { path: violation.from } : null,
          evidence: violation.to ? `${violation.from} -> ${violation.to}` : null,
        })),
        diagnostics: [{
          level: 'error',
          message: [
            formatted,
            '',
            buildArchitectureAiRepairInstructions({ root, violations: report.violations }),
          ].join('\n'),
        }],
        metrics: { modules: report.modulesCruised, violations: report.violations.length },
      });
    }
    return createGateResult({
      gateId: ARCHITECTURE_GATE_ID,
      status: 'passed',
      summary: `Architecture passed across ${report.modulesCruised} module(s)`,
      diagnostics: [{ level: 'info', message: formatted }],
      metrics: { modules: report.modulesCruised, violations: report.violations.length },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
