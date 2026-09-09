import {
  normalizeProjectDocument,
  serializeProjectConfig,
} from '../../src/config/project-configuration.js';
import { configValidationError } from '../../src/config/validation-primitives.js';

export const FRONTEND_PROJECT = Object.freeze({
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-javascript',
});

/** 测试直接使用 v2 项目契约，只在写入时剥离运行时编译的路径匹配器。 */
export function projectFixtureDocument(config, project = FRONTEND_PROJECT) {
  if (config.version !== 2)
    throw configValidationError('常规项目测试必须直接提供 version: 2 配置。');
  const document = {
    ...config,
    project: config.project ?? project,
    ...(config.repository
      ? {
          repository: {
            ...config.repository,
            ...(config.repository.rules
              ? {
                  rules: config.repository.rules.map(
                    ({ matcher: ignored, ...rule }) => {
                      void ignored;
                      return rule;
                    },
                  ),
                }
              : {}),
            ...(config.repository.exclusions
              ? {
                  exclusions: config.repository.exclusions.map((entry) =>
                    typeof entry === 'string' ? entry : entry.pattern,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
  return serializeProjectConfig(normalizeProjectDocument(document));
}

export function stringifyProjectFixture(config, replacer = null, space = 2) {
  return JSON.stringify(projectFixtureDocument(config), replacer, space);
}

/** 磁盘断言直接读取实际 v2 文档，不再转换为旧运行时结构。 */
export function parseProjectFixture(content) {
  return JSON.parse(content);
}
