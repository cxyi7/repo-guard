import { loadConfig } from '../../config/configuration-loader.js';
import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { runQualityExecution } from './quality-runner.js';

export async function runQualityFileCommand(files, cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const execution = await runQualityExecution({ root, files, config });
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
