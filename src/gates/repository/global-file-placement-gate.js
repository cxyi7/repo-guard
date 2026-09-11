import { validateRepositoryFilePlacementConfiguration } from '../../config/repository-file-placement.js';
import { cancellationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { collectRepositoryFilePaths } from '../../git/repository-file-paths.js';
import { inspectFilePlacement } from '../../policies/file-placement.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';

const GATE_ID = 'repository.global-file-placement';
const SOURCE_LABELS = {
  index: '完整 Git 暂存区',
  revision: '指定提交的完整 Git 文件树',
  worktree: '仓库工作区全部受控与未忽略文件',
};

function placementFinding({ path, rule, suggestedPath }) {
  return {
    ruleId: 'repository/global-file-placement',
    severity: 'error',
    message: `文件不符合仓库级「${rule.name}」归位规则：${path}`,
    location: { path },
    evidence: [{ message: `当前路径：${path}；建议路径：${suggestedPath}` }],
    expected: `匹配此规则的文件应位于：${rule.allowedPatterns.join('、')}。`,
    remediation: {
      goal: '将文件放入团队规定的仓库目录，并保持引用有效。',
      steps: [`根据文件用途将 ${path} 移至允许目录，可参考 ${suggestedPath}。`, '同步更新相关导入、链接和构建配置；提交前将移动与引用修改一起暂存。'],
      constraints: ['不要通过应用筛选、关闭规则或扩大例外绕过仓库公共要求。'],
      verification: ['重新执行仓库级文件归位检查，并运行受影响的检查或测试。'],
    },
  };
}

export function runGlobalFilePlacementGate({
  root, repositoryRoot = root, config, environment, revision = null, plan, signal,
  collect = collectRepositoryFilePaths,
}) {
  const startedAt = Date.now();
  try {
    const configured = validateRepositoryFilePlacementConfiguration(config.repository);
    const check = validateRepositoryFilePlacementConfiguration({
      filePlacement: { ...configured, enabled: plan?.enabled ?? configured.enabled },
    });
    if (!check.enabled) return createGateResult({ gateId: GATE_ID, status: 'skipped', summary: '仓库级文件归位检查已关闭' });
    if (signal?.aborted) throw cancellationError('repository/file-placement-cancelled', '仓库级文件归位检查已取消。');
    const facts = collect({ root: repositoryRoot, environment: environment ?? plan?.environment, revision: revision ?? plan?.revision });
    if (signal?.aborted) throw cancellationError('repository/file-placement-cancelled', '仓库级文件归位检查已取消。');
    const inspected = inspectFilePlacement({
      changes: facts.paths.map((path) => ({ status: 'A', path, oldPath: null })),
      config: { ...check, mode: 'changedFiles' },
    });
    const findings = inspected.violations.map(placementFinding);
    const source = `检查依据：${SOURCE_LABELS[facts.source]}${facts.revision ? `；提交：${facts.revision}` : ''}`;
    return createGateResult({
      gateId: GATE_ID,
      status: findings.length ? 'violation' : 'passed',
      summary: `仓库级文件归位检查${findings.length ? '未通过' : '已通过'}；${source}；覆盖 ${facts.paths.length} 个文件，匹配 ${inspected.checkedCount} 个文件；排除 ${facts.gitlinks} 个 Git 子模块入口，不进入其内部。`,
      findings,
      metrics: { repositoryFiles: facts.paths.length, checkedFiles: inspected.checkedCount, violations: findings.length, excludedGitlinks: facts.gitlinks },
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'repository/file-placement-failed', message: '仓库级文件归位检查无法完成。' });
    return createGateResult({ gateId: GATE_ID, status: errorStatus(error), summary: error.message, error, durationMs: Date.now() - startedAt });
  }
}

export const globalFilePlacementGate = definePlatformGate({
  id: GATE_ID, configKey: 'repository.filePlacement', featureName: 'repositoryFilePlacement',
  featureOrder: 45, manualOrder: 155, doctorOrder: 155,
  manualCommand: 'repository-file-placement', packageScript: 'guard:repository-file-placement',
  defaultTimeoutMs: 30000, ciScopes: ['all-files'],
  environments: ['manual', 'pre-commit', 'pre-push', 'ci-policy', 'ci-full', 'release-ready'],
  rules: ['repository/global-file-placement'], requiredTools: ['git'],
  inspectSetup: ({ config }) => {
    const check = validateRepositoryFilePlacementConfiguration(config.repository);
    return readyGateSetup(check.enabled ? '仓库级文件归位配置已就绪，执行时读取完整文件清单' : '仓库级文件归位检查已关闭');
  },
  plan: ({ config, environment, revision }) => ({ enabled: config.repository?.filePlacement?.enabled ?? false, environment, revision }),
  run: runGlobalFilePlacementGate,
});
