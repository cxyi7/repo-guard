import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { executeKnipAnalysis } from '../../integrations/knip/execution.js';
import { resolveDeadCodeBaselinePath } from '../../integrations/knip/project.js';
import {
  compareDeadCodeDebt,
  createDeadCodeBaseline,
  parseDeadCodeBaseline,
} from '../../policies/dead-code-baseline.js';
import { validateDeadCodeSetup } from './dead-code-setup.js';

function assertBaselineMode(config) {
  if (config.mode !== 'noRegression') {
    throw configurationError(
      'dead-code/baseline-mode-required',
      '无效代码基线命令要求 deadCode.mode 为 noRegression',
    );
  }
}

function assertNoConfigurationHints(config, analysis) {
  if (config.treatConfigHintsAsErrors && analysis.configurationHintCount > 0) {
    throw configurationError(
      'dead-code/configuration-hints',
      'Knip 报告了配置提示，不能基于不可信的项目图更新历史债务基线',
      { details: { evidence: [{
        type: 'knip-configuration-hints',
        message: `Knip 配置提示数量：${analysis.configurationHintCount}`,
      }] } },
    );
  }
}

function writeBaseline(target, baseline) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

export async function initializeDeadCodeBaseline(root, config) {
  assertBaselineMode(config);
  const target = resolveDeadCodeBaselinePath(root, config.baselineFile);
  if (existsSync(target)) {
    throw configurationError(
      'dead-code/baseline-already-exists',
      `无效代码基线已经存在，初始化命令拒绝覆盖：${config.baselineFile}`,
    );
  }
  const analysis = await executeKnipAnalysis({ root, config });
  assertNoConfigurationHints(config, analysis);
  const baseline = createDeadCodeBaseline(analysis.issues, config.issueTypes);
  writeBaseline(target, baseline);
  return Object.freeze({
    action: 'initialized',
    baselineFile: config.baselineFile,
    debtCount: baseline.debtCount,
  });
}

export async function pruneDeadCodeBaseline(root, config) {
  assertBaselineMode(config);
  const setup = validateDeadCodeSetup(root, config);
  const analysis = await executeKnipAnalysis({ root, config });
  assertNoConfigurationHints(config, analysis);
  const comparison = compareDeadCodeDebt(analysis.issues, setup.baseline);
  if (comparison.additions.length > 0) {
    throw configurationError(
      'dead-code/baseline-prune-has-additions',
      `存在 ${comparison.additions.length} 类新增问题，拒绝裁剪无效代码基线`,
    );
  }
  const target = resolveDeadCodeBaselinePath(root, config.baselineFile, {
    requireExisting: true,
  });
  const current = parseDeadCodeBaseline(
    JSON.parse(readFileSync(target, 'utf8')),
    config.issueTypes,
  );
  const next = createDeadCodeBaseline(analysis.issues, config.issueTypes);
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) writeBaseline(target, next);
  return Object.freeze({
    action: 'pruned',
    after: next.debtCount,
    baselineFile: config.baselineFile,
    before: current.debtCount,
    changed,
  });
}
