import { loadStagedWorkspace } from '../workspace/configuration-snapshot.js';
import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { runWorkspaceQualityExecution } from './quality-runner.js';

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
  return execution.exitCode === 0 ? 0 : 1;
}
