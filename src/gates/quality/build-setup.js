import { validateBuildSetup } from '../../integrations/npm/build.js';
import { resolveBuildArtifactOutput } from '../../integrations/build-artifacts/project.js';

export function detectProjectBuildSetup(root, config) {
  try {
    const setup = validateBuildSetup(root, config);
    const artifactOutput = config.artifactBudget?.enabled
      ? resolveBuildArtifactOutput(root, config.artifactBudget)
      : null;
    return { ready: true, setup: { ...setup, artifactOutput } };
  } catch (error) {
    return { ready: false, error };
  }
}
