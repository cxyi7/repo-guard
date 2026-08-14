import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../../integrations/stylelint/project.js';

export function detectProjectStylelintSetup(root) {
  let metadata = null;
  try {
    metadata = resolveProjectStylelintMetadata(root);
  } catch {
    // Initialization reports missing optional tooling without failing the whole setup.
  }

  const configFile = findProjectStylelintConfig(root);
  return {
    configFile,
    installed: Boolean(metadata),
    metadata,
    ready: Boolean(metadata && configFile),
  };
}
