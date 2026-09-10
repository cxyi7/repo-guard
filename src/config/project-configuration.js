import { validateConfig } from './configuration-validation.js';
import { assertProjectDocumentVersion } from './root-configuration-validation.js';
import { CONFIG_FILE } from './validation-primitives.js';
import { applicationDocument } from './workspace-scopes.js';
import { PROJECT_CHECK_PATHS } from './project-feature-paths.js';

export { assertProjectDocumentVersion };
export const PROJECT_SCHEMA_PATH =
  './node_modules/@cxyi7/repo-guard/config.schema.json';

/** 磁盘、快照与运行时共享 v2 结构；应用仅继承公共流程设置。 */
export function normalizeProjectDocument(document, options = {}) {
  assertProjectDocumentVersion(document);
  return validateConfig(
    options.shared ? applicationDocument(document, options.shared) : document,
    options.configPath ?? CONFIG_FILE,
    { ...options, repositoryOnly: false },
  );
}

/** 写回时只剥离受保护路径的编译结果，不转换配置模型。 */
export function serializeProjectConfig(normalized) {
  const document = structuredClone(normalized);
  return {
    $schema: PROJECT_SCHEMA_PATH,
    ...document,
    repository: {
      ...document.repository,
      rules: document.repository.rules.map(({ pattern, category, level }) => ({
        pattern,
        category,
        level,
      })),
      exclusions: document.repository.exclusions.map((entry) =>
        typeof entry === 'string' ? entry : entry.pattern,
      ),
    },
  };
}

export function createProjectDocument(descriptor) {
  return serializeProjectConfig(
    normalizeProjectDocument({ version: 2, project: descriptor }),
  );
}

/** 仓库执行不选择任意应用身份，但沿用完全相同的执行结构。 */
export function normalizeRepositoryDocument(document, options = {}) {
  return validateConfig(
    {
      version: 2,
      checks: Object.fromEntries(Object.keys(PROJECT_CHECK_PATHS).map((key) => [key, { enabled: false }])),
      repository: {
        ...document.repository,
        dependencyPolicy: { enabled: false },
        codePlacement: { enabled: false },
      },
      reporting: document.reporting,
      ci: document.ci,
    },
    options.configPath ?? CONFIG_FILE,
    { ...options, repositoryOnly: true },
  );
}
