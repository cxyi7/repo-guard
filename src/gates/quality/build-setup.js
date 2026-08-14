import { validateBuildSetup } from '../../integrations/npm/build.js';

export function detectProjectBuildSetup(root, config) {
  try {
    return { ready: true, setup: validateBuildSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}
