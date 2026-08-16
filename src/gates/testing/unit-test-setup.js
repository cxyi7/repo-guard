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
      '仓库根目录中未找到 package.json',
    );
  }
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'unit-test/missing-script',
      `单元测试门禁要求 package.json 提供脚本“${config.script}”`,
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
