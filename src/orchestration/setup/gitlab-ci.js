import { loadWorkspace } from '../../config/configuration-loader.js';
import { installGitLabCiFiles } from '../../operations/gitlab/gitlab-ci.js';
import { configureCi } from './config-management.js';
import { assertManagedDocumentFormats } from './managed-format-preflight.js';

export {
  GITLAB_CI_FILE,
  GITLAB_TEMPLATE_FILE,
  inspectGitLabCi,
} from '../../operations/gitlab/gitlab-ci.js';

export function installGitLabCi(root, options = {}) {
  const workspace = loadWorkspace(root);
  assertManagedDocumentFormats(root, { workspace });
  const config = workspace.repositoryConfig;
  const preview = installGitLabCiFiles(root, config, options);
  if (!options.dryRun && preview.integrated) configureCi(root, { profile: preview.profile });
  return preview;
}
