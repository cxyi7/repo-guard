import { fileURLToPath } from 'node:url';
import lintStaged from 'lint-staged';
import { loadStagedWorkspace } from '../workspace/configuration-snapshot.js';
import {
  runStreamingProcess,
  terminalProcessOutput,
} from '../../core/execution/streaming-process.js';
import { collectStagedChanges } from '../../git/change-collection.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { executionError } from '../../core/error/repo-guard-error.js';
import { aggregateExitCodes, EXIT_CODES, repoGuardProcessToExitCode } from '../../core/result/exit-code.js';
import { createQualityResultChannel } from './quality-result-channel.js';
import { qualityRestorationState } from './quality-restoration-state.js';

const CLI_PATH = fileURLToPath(new URL('../../../bin/repo-guard.js', import.meta.url));

function quoteCommandArgument(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

export async function runQualityGate({ cwd = process.cwd(), animation = null } = {}) {
  const root = findRepositoryRoot(cwd);
  loadStagedWorkspace(root);
  const stagedChanges = collectStagedChanges(root);
  const originalState = qualityRestorationState(root);
  const channel = createQualityResultChannel(root);
  try {
    const task = [
      quoteCommandArgument(process.execPath),
      quoteCommandArgument(CLI_PATH),
      'quality-files', '--result-channel', channel.id, '--',
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
      config: { '{*,.*}': task },
      cwd: root,
      relative: false,
      stash: true,
      verbose: true,
      // 仅替换任务列表渲染；verbose 保留成功和失败任务的完整诊断。
      quiet: animated,
    }, animated ? { log: log('stdout'), warn: log('stderr'), error: log('stderr') } : undefined);
    animation?.pause();
    const exitCodes = channel.readExitCodes();
    const exitCode = aggregateExitCodes(exitCodes);
    const hasQualityFiles = stagedChanges.some(({ status }) => /^[ACMR]/.test(status));
    if (!passed && qualityRestorationState(root) !== originalState) {
      throw executionError('pre-commit/quality-restore-incomplete', '质量检查失败后，暂存区、工作树或备份状态未完整恢复。请检查 Git 状态及 lint-staged 的恢复提示后重试。');
    }
    if ((!passed && exitCode === EXIT_CODES.success)
      || (passed && exitCode !== EXIT_CODES.success)
      || (hasQualityFiles && exitCodes.length === 0)) {
      throw executionError('pre-commit/quality-result-missing', 'lint-staged 未完成可信的检查流程或未返回完整子任务结果，请检查上方执行诊断后重试。');
    }
    if (passed && stagedChanges.length > 0 && stagedChanges.every(({ status }) => status.startsWith('D'))) {
      const deletionResult = await runStreamingProcess({
        command: process.execPath,
        argumentsList: [CLI_PATH, 'quality-files', '--result-channel', channel.id, '--'],
        root,
        timeoutMs: 120000,
        output: terminalProcessOutput(true),
      });
      const deletionExitCodes = channel.readExitCodes();
      if (deletionExitCodes.length !== 1 || deletionExitCodes[0] !== deletionResult.status) {
        throw executionError('pre-commit/deletion-quality-result-invalid', '仅删除文件的质量检查未返回完整结果，或结果与子进程退出状态不一致，请检查执行诊断后重试。');
      }
      return repoGuardProcessToExitCode(deletionResult);
    }
    return exitCode;
  } finally {
    channel.close();
  }
}
