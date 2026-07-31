import { loadConfig } from '../config.js';
import {
  cleanupCommitMessage,
  finalizeCommitMessage,
  prepareCommitMessage,
} from '../commit-message.js';
import { findRepositoryRoot } from '../git.js';

export function runHookMessage(argumentsList, cwd = process.cwd()) {
  const [mode, messageFile = '', source = '', sourceCommit = ''] = argumentsList;
  const root = findRepositoryRoot(cwd);

  if (mode === 'cleanup') {
    cleanupCommitMessage(root);
    return 0;
  }

  if (!messageFile) {
    throw new Error(`hook-message ${mode || '<missing>'} requires a commit message file`);
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

  throw new Error(`Unsupported hook-message mode: ${mode || '<missing>'}`);
}
