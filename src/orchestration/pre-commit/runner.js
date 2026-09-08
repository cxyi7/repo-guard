import { loadConfig } from '../../config/configuration-loader.js';
import { validateConfig } from '../../config/configuration-validation.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import {
  createChangeSet,
  createGateContext,
} from '../../core/capability/gate-context.js';
import {
  configurationError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { createCommitAnimation } from '../../core/report/commit-animation/presenter.js';
import { gateRegistry } from '../../gates/registry.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { runGit } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { orchestratePlan } from '../orchestrator.js';
import { withPreCommitLock } from './lifecycle-lock.js';
import { runQualityGate } from './lint-staged-gate.js';
import { preCommitPolicyPlan } from './protected-plan.js';

function loadStagedConfig(root) {
  const result = runGit(['show', `:${CONFIG_FILE}`], {
    allowFailure: true,
    cwd: root,
  });
  if (result.status !== 0) return loadConfig(root);
  try {
    return validateConfig(JSON.parse(result.stdout), `${CONFIG_FILE} (staged)`);
  } catch (error) {
    throw configurationError(
      'pre-commit/invalid-staged-config',
      `无效的暂存 ${CONFIG_FILE}: ${error.message}`,
      { cause: error },
    );
  }
}

async function runPreCommitLifecycle(root, animation) {
  let completed = 0;
  const total = preCommitPolicyPlan.steps.length + 1;
  animation.start({ label: '暂存文件质量检查 · 格式化与规则验证' });
  const qualityExitCode = await runQualityGate({ cwd: root, animation });
  if (qualityExitCode !== 0) {
    return qualityExitCode;
  }
  completed += 1;
  const config = loadStagedConfig(root);
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: collectStagedChanges(root),
  });
  const context = createGateContext({
    root,
    environment: preCommitPolicyPlan.environment,
    config,
    changes,
  });
  const execution = await orchestratePlan({
    plan: preCommitPolicyPlan,
    registry: gateRegistry,
    context,
    stopOnFailure: true,
    beforeStep: () => {
      animation.start({ completed, total, label: '暂存区策略检查 · 验证仓库规则' });
      return null;
    },
    onResult: ({ result, step }) => {
      completed += 1;
      if (['passed', 'skipped'].includes(result.status)) animation.pause();
      else animation.fail();
      writeGateResultConsole(result, { label: step.id });
    },
  });
  if (execution.status.endsWith('-error')) {
    const decisiveError = execution.decisiveResult?.error;
    throw toRepoGuardError(
      decisiveError?.message ?? '预提交策略无法完成',
      {
      kind: decisiveError?.kind ?? 'execution',
      code: decisiveError?.code ?? 'pre-commit/policy-failed',
      },
    );
  }
  return execution.exitCode === 0 ? 0 : 1;
}

export async function runPreCommit(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  return await withPreCommitLock(root, async () => {
    const config = loadConfig(root);
    const animation = createCommitAnimation(config.commitAnimation);
    try {
      const code = await runPreCommitLifecycle(root, animation);
      animation.close();
      if (config.commitAnimation.enabled) {
        writeConsoleMessage(code === 0
          ? '提交前检查通过；等待提交信息校验和 Git 创建提交。'
          : '提交已阻止。请按上方问题、位置和修复建议处理后重新提交。', code === 0 ? 'stdout' : 'stderr');
      }
      return code;
    } finally { animation.close(); }
  });
}
