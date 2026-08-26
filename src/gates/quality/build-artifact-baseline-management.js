import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { ensureArtifactBaselineDirectory } from '../../integrations/build-artifacts/project.js';
import {
  buildArtifactBaselineDocument,
  collectBuildArtifactViolations,
  evaluateBuildArtifactBudget,
  inspectBuildArtifactBudget,
} from './build-artifact-budget.js';

function assertBaselineMode(config) {
  if (!config.enabled || config.platform !== 'pc' || config.mode !== 'baseline') {
    throw configurationError(
      'build-artifact/baseline-mode-required',
      '构建产物基线命令要求启用 PC 产物预算并设置 mode=baseline',
    );
  }
}

function writeBaseline(root, config, baseline) {
  const target = ensureArtifactBaselineDirectory(root, config.baselineFile);
  writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

export function initializeBuildArtifactBaseline(root, config) {
  assertBaselineMode(config);
  const target = ensureArtifactBaselineDirectory(root, config.baselineFile);
  if (existsSync(target)) {
    throw configurationError(
      'build-artifact/baseline-already-exists',
      `构建产物历史基线已经存在，初始化命令拒绝覆盖：${config.baselineFile}`,
    );
  }
  const inspection = inspectBuildArtifactBudget(root, config);
  const violations = collectBuildArtifactViolations(inspection, config);
  const baseline = buildArtifactBaselineDocument(config, violations);
  writeBaseline(root, config, baseline);
  return Object.freeze({
    action: 'initialized',
    baselineFile: config.baselineFile,
    debtCount: violations.length,
  });
}

export function pruneBuildArtifactBaseline(root, config) {
  assertBaselineMode(config);
  const evaluation = evaluateBuildArtifactBudget(root, config);
  if (evaluation.violations.length > 0) {
    throw configurationError(
      'build-artifact/baseline-prune-has-regressions',
      `存在 ${evaluation.violations.length} 项新增或增长的产物问题，拒绝裁剪构建产物基线`,
    );
  }
  const target = ensureArtifactBaselineDirectory(root, config.baselineFile);
  const current = JSON.parse(readFileSync(target, 'utf8'));
  const currentViolations = collectBuildArtifactViolations(evaluation.inspection, config);
  const next = buildArtifactBaselineDocument(config, currentViolations);
  for (const [key, value] of Object.entries(next.allowances)) {
    if (current.allowances[key] == null || value > current.allowances[key]) {
      throw configurationError(
        'build-artifact/baseline-prune-would-grow',
        `裁剪操作不得新增或扩大构建产物基线：${key}`,
      );
    }
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) writeBaseline(root, config, next);
  return Object.freeze({
    action: 'pruned',
    before: Object.keys(current.allowances).length,
    after: Object.keys(next.allowances).length,
    changed,
    baselineFile: config.baselineFile,
  });
}
