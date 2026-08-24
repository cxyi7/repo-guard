import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import {
  initializeDeadCodeBaseline,
  pruneDeadCodeBaseline,
} from '../../gates/quality/dead-code-baseline-management.js';
import { findRepositoryRoot } from '../../git/repository.js';

function renderResult(result) {
  if (result.action === 'initialized') {
    writeConsoleMessage(
      `无效代码基线已初始化：${result.baselineFile}，登记 ${result.debtCount} 项历史问题；`
      + '请审核并提交该文件。',
    );
    return;
  }
  if (!result.changed) {
    writeConsoleMessage(`无效代码基线无需裁剪，仍包含 ${result.before} 项历史问题。`);
    return;
  }
  writeConsoleMessage(
    `无效代码基线已安全裁剪：${result.before} → ${result.after}；请审核并提交该文件。`,
  );
}

export async function runDeadCodeBaseline(action, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root).deadCode;
  let result;
  if (action === 'init') result = await initializeDeadCodeBaseline(root, config);
  else if (action === 'prune') result = await pruneDeadCodeBaseline(root, config);
  else throw configurationError('dead-code/unknown-baseline-action', '基线操作必须为 init 或 prune');
  renderResult(result);
  return 0;
}
