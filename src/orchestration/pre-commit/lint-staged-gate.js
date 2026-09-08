import { fileURLToPath } from 'node:url';
import lintStaged from 'lint-staged';
import { loadConfig } from '../../config/configuration-loader.js';
import {
  runStreamingProcess,
  terminalProcessOutput,
} from '../../core/execution/streaming-process.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';

const CLI_PATH = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));

function quoteCommandArgument(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

export async function runQualityGate({ cwd = process.cwd(), animation = null } = {}) {
  const root = findRepositoryRoot(cwd);
  loadConfig(root);
  const stagedChanges = collectStagedChanges(root);
  const task = [
    quoteCommandArgument(process.execPath),
    quoteCommandArgument(CLI_PATH),
    'quality-files',
  ].join(' ');

  const animated = Boolean(animation?.active);
  const log = (stream) => (message) => {
    if (stream === 'stderr') animation?.fail();
    else animation?.pause();
    writeConsoleMessage(message, stream);
  };
  const passed = await lintStaged({
    allowEmpty: false,
    concurrent: false,
    config: {
      '{*,.*}': task,
    },
    cwd: root,
    relative: false,
    stash: true,
    verbose: true,
    // 仅替换任务列表渲染；verbose 保留成功和失败任务的完整诊断。
    quiet: animated,
  }, animated ? { log: log('stdout'), warn: log('stderr'), error: log('stderr') } : undefined);

  animation?.pause();

  if (!passed) return 1;
  if (
    stagedChanges.length > 0
    && stagedChanges.every(({ status }) => status.startsWith('D'))
  ) {
    const deletionResult = await runStreamingProcess({
      command: process.execPath,
      argumentsList: [CLI_PATH, 'quality-files'],
      root,
      timeoutMs: 120000,
      output: terminalProcessOutput(true),
    });
    return deletionResult.status === 0 ? 0 : 1;
  }
  return 0;
}
