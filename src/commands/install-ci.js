import { findRepositoryRoot } from '../git/repository.js';
import { configurationError } from '../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../core/report/console-renderer.js';
import {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  installGitLabCi,
} from '../orchestration/setup/gitlab-ci.js';

export function runInstallCiCommand(cwd = process.cwd(), {
  provider,
  profile,
  stage,
  dryRun,
} = {}) {
  if (provider !== 'gitlab') throw configurationError('install-ci/unsupported-provider', 'Only the gitlab CI provider is supported');
  const root = findRepositoryRoot(cwd);
  const result = installGitLabCi(root, { profile, stage, dryRun });
  writeConsoleMessage(`repo-guard GitLab CI ${dryRun ? 'preview' : 'installation'}:`);
  writeConsoleMessage(`- template: ${GITLAB_TEMPLATE_FILE} (${result.templateChanged ? 'updated' : 'current'})`);
  writeConsoleMessage(`- profile: ${result.profile}`);
  if (result.integrated) {
    writeConsoleMessage(`- ${GITLAB_CI_FILE}: integrated at stage ${result.stage}`);
  } else {
    writeConsoleMessage(`- ${GITLAB_CI_FILE}: not modified because ${result.conflict}`, 'stderr');
    writeConsoleMessage('Add this reviewed snippet to the existing GitLab CI configuration:', 'stderr');
    writeConsoleMessage(result.manualSnippet, 'stderr');
  }
  return 0;
}
