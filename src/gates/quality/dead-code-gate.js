import { configurationError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { readFileAtRevision } from '../../git/revision-content.js';
import { executeKnipAnalysis } from '../../integrations/knip/execution.js';
import {
  compareBaselineExpansion,
  compareDeadCodeDebt,
  parseDeadCodeBaseline,
} from '../../policies/dead-code-baseline.js';
import { passedResult, violationResult } from '../native-result.js';
import { validateDeadCodeSetup } from './dead-code-setup.js';

const GATE_ID = 'quality.dead-code';
const LABELS = Object.freeze({
  files: '未使用文件',
  dependencies: '未使用依赖',
  unlisted: '未声明依赖',
  binaries: '未声明命令依赖',
  unresolved: '无法解析的导入',
  exports: '未使用导出',
  types: '未使用类型导出',
});

function issueFinding(issue) {
  const label = LABELS[issue.type] ?? '无效代码';
  return {
    ruleId: `dead-code/${issue.type}`,
    code: `dead-code/${issue.type}`,
    severity: 'error',
    message: `${label}：${issue.name}`,
    location: {
      path: issue.file,
      ...(issue.line ? { line: issue.line } : {}),
      ...(issue.col ? { column: issue.col } : {}),
    },
    evidence: [{
      type: 'knip-analysis',
      message: `Knip 问题类型：${issue.type}；名称：${issue.name}`,
    }],
    expected: '项目依赖图中不存在未使用或无法解析的代码与依赖。',
    remediation: {
      goal: `消除${label}，同时保持现有公开接口和运行行为兼容`,
      steps: ['确认 Knip 入口和插件配置正确', '删除无效内容或补齐真实引用与依赖声明'],
      constraints: ['不得仅通过扩大 ignore 配置隐藏真实问题'],
      verification: ['重新运行 npm run guard:dead-code'],
    },
  };
}

function baselineFinding(entry, ruleId, message) {
  return {
    ruleId,
    code: ruleId,
    severity: 'error',
    message,
    location: { path: entry.path },
    evidence: [{
      type: 'dead-code-baseline',
      message: `${entry.issueType}：${entry.name}；数量：${entry.count}`,
    }],
    expected: '历史债务基线只允许删除已解决条目，不得接纳新增问题。',
    remediation: {
      goal: '修复新增问题或安全裁剪已经解决的历史债务',
      steps: ['先运行 npm run guard:dead-code 查看完整问题', '修复新增问题后运行 npm run guard:dead-code-baseline-prune'],
      constraints: ['不得手工增加或重新生成基线条目'],
      verification: ['重新运行 npm run guard:dead-code'],
    },
  };
}

function baselineReference(context) {
  if (context.revision?.base) return context.revision.base;
  const bases = [...new Set(context.changes.entries.map(({ baseSha }) => baseSha).filter(Boolean))];
  return bases.length === 1 ? bases[0] : null;
}

function previousBaseline(root, revision, config) {
  if (!revision) return null;
  const result = readFileAtRevision(root, revision, config.baselineFile);
  if (!result.exists) return null;
  try {
    return parseDeadCodeBaseline(JSON.parse(result.content), config.issueTypes);
  } catch (error) {
    throw configurationError(
      'dead-code/invalid-previous-baseline',
      `基准提交中的无效代码基线格式无效：${error.message}`,
      { cause: error },
    );
  }
}

function outputDiagnostics(execution, root) {
  return processOutputDiagnostics({ ...execution, stdout: '' }, {
    source: 'Knip 原始诊断',
    root,
  });
}

export async function runDeadCodeGate(context) {
  const { root, config: projectConfig, signal } = context;
  const config = projectConfig.deadCode;
  const setup = validateDeadCodeSetup(root, config);
  context.logger?.info('repo-guard 无效代码：正在运行消费项目的 Knip 全项目分析...');
  const analysis = await executeKnipAnalysis({ root, config, signal });
  const { configurationHintCount, execution, issues } = analysis;
  const diagnostics = outputDiagnostics(execution, root);
  if (config.treatConfigHintsAsErrors && configurationHintCount > 0) {
    throw configurationError(
      'dead-code/configuration-hints',
      'Knip 报告了配置提示；必须先修正入口、插件或项目范围，才能信任无效代码结果',
      { details: { evidence: [{
        type: 'knip-configuration-hints',
        message: `Knip 配置提示数量：${configurationHintCount}`,
      }] } },
    );
  }
  const metrics = {
    issues: issues.length,
    files: issues.filter(({ type }) => type === 'files').length,
    dependencies: issues.filter(({ type }) => type === 'dependencies').length,
    exports: issues.filter(({ type }) => type === 'exports' || type === 'types').length,
  };
  if (config.mode === 'strict') {
    return issues.length === 0
      ? passedResult(GATE_ID, `无效代码检查已通过，Knip ${setup.knip.version} 未发现问题`, { diagnostics, metrics })
      : violationResult(GATE_ID, `无效代码检查发现 ${issues.length} 项问题`, {
          diagnostics,
          metrics,
          findings: issues.map(issueFinding),
        });
  }

  const comparison = compareDeadCodeDebt(issues, setup.baseline);
  const reference = baselineReference(context);
  if (context.environment && context.environment !== 'manual' && !reference) {
    throw configurationError(
      'dead-code/baseline-reference-missing',
      'noRegression 模式无法确定对比分支的 Git 基准提交，拒绝跳过基线防扩张检查',
    );
  }
  const prior = previousBaseline(root, reference, config);
  const baselineAdditions = prior == null
    ? []
    : compareBaselineExpansion(
        setup.baseline,
        prior,
        context.changes.entries.filter(({ oldPath, path }) => oldPath && path),
      );
  const findings = [
    ...comparison.additions.map((entry) => baselineFinding(
      entry,
      'dead-code/new-debt',
      `发现不在历史基线中的新问题：${entry.name}`,
    )),
    ...comparison.resolved.map((entry) => baselineFinding(
      entry,
      'dead-code/stale-baseline',
      `历史问题已解决但基线尚未裁剪：${entry.name}`,
    )),
    ...baselineAdditions.map((entry) => baselineFinding(
      entry,
      'dead-code/baseline-expanded',
      `当前分支扩大了历史债务基线：${entry.name}`,
    )),
  ];
  if (findings.length > 0) {
    return violationResult(GATE_ID, `无效代码基线检查发现 ${findings.length} 项不一致`, {
      diagnostics,
      findings,
      metrics: {
        ...metrics,
        baselineDebt: setup.baseline.debtCount,
        newDebt: comparison.additions.reduce((total, entry) => total + entry.count, 0),
        resolvedDebt: comparison.resolved.reduce((total, entry) => total + entry.count, 0),
      },
    });
  }
  return passedResult(
    GATE_ID,
    `无效代码检查已通过，保留 ${setup.baseline.debtCount} 项已登记历史问题且没有新增债务`,
    { diagnostics, metrics: { ...metrics, baselineDebt: setup.baseline.debtCount } },
  );
}
