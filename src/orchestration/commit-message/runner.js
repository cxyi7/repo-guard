import { loadConfig } from '../../config/configuration-loader.js';
import {
  cleanupCommitMessage,
  finalizeCommitMessage,
  prepareCommitMessage,
  readPreparedCommitMessage,
} from '../../policies/commit-message-summary.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gitValue, runGit } from '../../git/execution.js';
import { collectPendingCommitParents } from '../../git/commit-messages.js';
import { createCommitMessageResult } from '../../gates/repository/commit-message-gate.js';
import { gateResultToExitCode } from '../../core/result/gate-result.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { createCommitAnimation } from '../../core/report/commit-animation/presenter.js';

export function runHookMessage(argumentsList, cwd = process.cwd()) {
  const [mode, messageFile = '', source = '', sourceCommit = ''] = argumentsList;
  const root = findRepositoryRoot(cwd);

  if (mode === 'cleanup') {
    cleanupCommitMessage(root);
    return 0;
  }

  if (mode === 'success') {
    // post-commit 的展示失败不得把已经创建的提交报告为失败。
    try {
      cleanupCommitMessage(root);
      const config = loadConfig(root, { repositoryOnly: true });
      if (!config.reporting.commitAnimation.enabled) return 0;
      const committed = runGit(['log', '-1', '--format=%P%n%s'], { allowFailure: true, cwd: root });
      if (committed.status !== 0) return 0;
      const [parentLine = '', ...subject] = committed.stdout.split(/\r?\n/);
      const parents = parentLine.trim().split(/\s+/).filter(Boolean);
      const message = subject.join('\n').trim();
      return createCommitAnimation(config.reporting.commitAnimation).celebrate(message, { parents }).then(() => {
        writeConsoleMessage('提交成功，Git 已创建提交。');
        return 0;
      }).catch(() => 0);
    } catch (error) {
      if (error?.code === 'commit-message/unsupported-state-version') {
        try {
          writeConsoleMessage(`警告：Git 提交已完成，但临时状态清理已拒绝 [${error.code}]：${error.message}`, 'stderr');
        } catch { /* 终端输出异常不影响已经创建的提交。 */ }
      }
      return 0;
    }
  }

  if (!messageFile) {
    throw configurationError('hook-message/missing-file', `hook-message ${mode || '<missing>'} 需要提交消息文件`);
  }

  const config = loadConfig(root, { repositoryOnly: true });
  if (mode === 'prepare') {
    prepareCommitMessage(root, config, messageFile, source, sourceCommit);
    return 0;
  }
  if (mode === 'finalize') {
    if (config.repository.commitMessage.enabled) {
      const candidate = readPreparedCommitMessage(root, messageFile);
      const result = createCommitMessageResult({
        records: [{
          message: candidate.message,
          source: candidate.source,
          parents: collectPendingCommitParents(root),
          commentCharacter: gitValue(['config', '--get', 'core.commentChar'], '#', root),
        }],
        config: config.repository.commitMessage,
        environment: 'local',
      });
      if (result.status !== 'passed') {
        writeGateResultConsole(result, { label: 'commit-message' });
        return gateResultToExitCode(result);
      }
    }
    finalizeCommitMessage(root, config, messageFile);
    return 0;
  }

  throw configurationError('hook-message/unsupported-mode', `不支持的 hook-message 模式： ${mode || '<missing>'}`);
}
