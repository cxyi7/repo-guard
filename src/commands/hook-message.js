import { loadConfig } from '../config/configuration-loader.js';
import {
  cleanupCommitMessage,
  finalizeCommitMessage,
  prepareCommitMessage,
} from '../policies/commit-message-summary.js';
import { findRepositoryRoot } from '../git/repository.js';
import { configurationError } from '../core/error/repo-guard-error.js';

export function runHookMessage(argumentsList, cwd = process.cwd()) {
  const [mode, messageFile = '', source = '', sourceCommit = ''] = argumentsList;
  const root = findRepositoryRoot(cwd);

  if (mode === 'cleanup') {
    cleanupCommitMessage(root);
    return 0;
  }

  if (!messageFile) {
    throw configurationError('hook-message/missing-file', `hook-message ${mode || '<missing>'} requires a commit message file`);
  }

  const config = loadConfig(root);
  if (mode === 'prepare') {
    prepareCommitMessage(root, config, messageFile, source, sourceCommit);
    return 0;
  }
  if (mode === 'finalize') {
    finalizeCommitMessage(root, config, messageFile);
    return 0;
  }

  throw configurationError('hook-message/unsupported-mode', `Unsupported hook-message mode: ${mode || '<missing>'}`);
}
