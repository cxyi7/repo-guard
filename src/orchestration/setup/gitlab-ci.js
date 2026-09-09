import { loadConfig } from '../../config/configuration-loader.js';
import { installGitLabCiFiles } from '../../operations/gitlab/gitlab-ci.js';
import { configureCi } from './config-management.js';

export {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  inspectGitLabCi,
} from '../../operations/gitlab/gitlab-ci.js';

export function installGitLabCi(root, options = {}) {
  const config = loadConfig(root, { repositoryOnly: true });
  const preview = installGitLabCiFiles(root, config, options);
  if (!options.dryRun) configureCi(root, { profile: options.profile ?? 'policy' });
  return preview;
}
