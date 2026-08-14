import { validateTypeCheckSetup } from '../../integrations/npm/typecheck.js';

export function detectProjectTypeCheckSetup(root, config) {
  try {
    return { ready: true, setup: validateTypeCheckSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}
