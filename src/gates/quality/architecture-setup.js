import { validateArchitectureSetup } from '../../integrations/dependency-cruiser/architecture.js';

export function detectProjectArchitectureSetup(root, config) {
  try {
    return { ready: true, setup: validateArchitectureSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}
