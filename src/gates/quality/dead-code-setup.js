import { readFileSync } from 'node:fs';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { isTrackedPath } from '../../git/revision-content.js';
import { resolveDeadCodeBaselinePath, resolveProjectKnip } from '../../integrations/knip/project.js';
import { parseDeadCodeBaseline } from '../../policies/dead-code-baseline.js';

function assertTrackedBaseline(root, relativePath) {
  if (!isTrackedPath(root, relativePath)) {
    throw configurationError(
      'dead-code/baseline-not-tracked',
      `无效代码基线必须由 Git 跟踪：${relativePath}`,
    );
  }
}

export function validateDeadCodeSetup(root, config, { requireTrackedBaseline = true } = {}) {
  const knip = resolveProjectKnip(root, config);
  let baseline = null;
  if (config.mode === 'noRegression') {
    const baselinePath = resolveDeadCodeBaselinePath(root, config.baselineFile, {
      requireExisting: true,
    });
    if (requireTrackedBaseline) assertTrackedBaseline(root, config.baselineFile);
    try {
      baseline = parseDeadCodeBaseline(
        JSON.parse(readFileSync(baselinePath, 'utf8')),
        config.issueTypes,
      );
    } catch (error) {
      throw configurationError(
        'dead-code/invalid-baseline',
        `无法读取无效代码基线 ${config.baselineFile}：${error.message}`,
        { cause: error },
      );
    }
  }
  return Object.freeze({ baseline, knip });
}
