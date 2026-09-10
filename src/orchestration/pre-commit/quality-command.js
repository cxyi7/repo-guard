import { loadStagedWorkspace } from '../workspace/configuration-snapshot.js';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { gateStatusToExitCode } from '../../core/result/exit-code.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { runWorkspaceQualityExecution } from './quality-runner.js';
import { beginQualityResult } from './quality-result-channel.js';

export async function runQualityFileCommand(files, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const workspace = loadStagedWorkspace(root);
  const execution = await runWorkspaceQualityExecution(workspace, files);
  if (execution.status.endsWith('-error')) {
    const decisiveError = execution.decisiveResult?.error;
    throw toRepoGuardError(
      decisiveError?.message ?? '质量门禁无法完成',
      {
      kind: decisiveError?.kind ?? 'execution',
      code: decisiveError?.code ?? 'pre-commit/quality-failed',
      },
    );
  }
  return execution.exitCode;
}

export async function runQualityFileArguments(argumentsList, cwd = process.cwd()) {
  if (argumentsList[0] !== '--result-channel') {
    if (argumentsList.some((value) => value.startsWith('--'))) {
      throw configurationError('pre-commit/quality-option-invalid', 'quality-files 不接受未知选项。');
    }
    return runQualityFileCommand(argumentsList, cwd);
  }
  const [, channelId, delimiter, ...files] = argumentsList;
  if (delimiter !== '--') {
    throw configurationError('pre-commit/quality-channel-arguments-invalid', '内部结果通道必须使用 -- 分隔文件路径。');
  }
  const finish = beginQualityResult(channelId, findRepositoryRoot(cwd));
  let code;
  try {
    code = await runQualityFileCommand(files, cwd);
  } catch (error) {
    finish(gateStatusToExitCode(errorStatus(error)));
    throw toRepoGuardError(error, { code: 'pre-commit/quality-failed' });
  }
  finish(code);
  return code;
}
