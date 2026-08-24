import { loadConfig } from '../../config/configuration-loader.js';
import {
  cleanupCommitMessage,
  finalizeCommitMessage,
  prepareCommitMessage,
  readPreparedCommitMessage,
} from '../../policies/commit-message-summary.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { gitValue } from '../../git/execution.js';
import { collectPendingCommitParents } from '../../git/commit-messages.js';
import { createCommitMessageResult } from '../../gates/repository/commit-message-gate.js';
import { gateResultToExitCode } from '../../core/result/gate-result.js';
import { writeGateResultConsole } from '../../core/report/console-renderer.js';

export function runHookMessage(argumentsList, cwd = process.cwd()) {
  const [mode, messageFile = '', source = '', sourceCommit = ''] = argumentsList;
  const root = findRepositoryRoot(cwd);

  if (mode === 'cleanup') {
    cleanupCommitMessage(root);
    return 0;
  }

  if (!messageFile) {
    throw configurationError('hook-message/missing-file', `hook-message ${mode || '<missing>'} 需要提交消息文件`);
  }

  const config = loadConfig(root);
  if (mode === 'prepare') {
    prepareCommitMessage(root, config, messageFile, source, sourceCommit);
    return 0;
  }
  if (mode === 'finalize') {
    if (config.commitMessage.enabled) {
      const candidate = readPreparedCommitMessage(root, messageFile);
      const result = createCommitMessageResult({
        records: [{
          message: candidate.message,
          source: candidate.source,
          parents: collectPendingCommitParents(root),
          commentCharacter: gitValue(['config', '--get', 'core.commentChar'], '#', root),
        }],
        config: config.commitMessage,
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
