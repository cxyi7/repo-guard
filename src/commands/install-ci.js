import { findRepositoryRoot } from '../git.js';
import {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  installGitLabCi,
} from '../gitlab-ci.js';

export function runInstallCiCommand(cwd = process.cwd(), {
  provider,
  profile,
  stage,
  dryRun,
} = {}) {
  if (provider !== 'gitlab') throw new Error('Only the gitlab CI provider is supported');
  const root = findRepositoryRoot(cwd);
  const result = installGitLabCi(root, { profile, stage, dryRun });
  console.log(`repo-guard GitLab CI ${dryRun ? 'preview' : 'installation'}:`);
  console.log(`- template: ${GITLAB_TEMPLATE_FILE} (${result.templateChanged ? 'updated' : 'current'})`);
  console.log(`- profile: ${result.profile}`);
  if (result.integrated) {
    console.log(`- ${GITLAB_CI_FILE}: integrated at stage ${result.stage}`);
  } else {
    console.warn(`- ${GITLAB_CI_FILE}: not modified because ${result.conflict}`);
    console.warn('Add this reviewed snippet to the existing GitLab CI configuration:');
    console.warn(result.manualSnippet);
  }
  return 0;
}
