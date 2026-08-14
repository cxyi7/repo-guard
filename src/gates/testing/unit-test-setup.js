import { configurationError } from '../../core/error/repo-guard-error.js';
import {
  readUnitTestProjectPackage,
  resolveUnitTestProjectTools,
} from '../../integrations/vitest/project.js';

export function validateUnitTestSetup(root, config) {
  const packageJson = readUnitTestProjectPackage(root);
  if (!packageJson) {
    throw configurationError(
      'unit-test/missing-package-json',
      'package.json was not found in repository root',
    );
  }
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'unit-test/missing-script',
      `Unit test gate requires package.json script "${config.script}"`,
    );
  }
  return {
    command: command.trim(),
    ...resolveUnitTestProjectTools(root, config),
  };
}

export function detectProjectUnitTestSetup(root, config) {
  try {
    return { ready: true, setup: validateUnitTestSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}
