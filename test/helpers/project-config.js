import { validateConfig } from '../../src/config/configuration-validation.js';
import { normalizeProjectDocument, serializeProjectConfig } from '../../src/config/project-configuration.js';

export const FRONTEND_PROJECT = Object.freeze({ id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' });

/** 既有门禁测试保留内部执行配置；写入磁盘时必须使用真实的 v2 契约。 */
export function projectFixtureDocument(config, project = FRONTEND_PROJECT) {
  if (config.version === 2) return config;
  const { project: suppliedProject, configVersion: ignoredVersion, ...legacy } = config;
  void ignoredVersion;
  const source = {
    ...legacy,
    rules: legacy.rules.map(({ matcher: ignoredMatcher, ...rule }) => {
      void ignoredMatcher;
      return rule;
    }),
    ...(legacy.exclusions ? { exclusions: legacy.exclusions.map((entry) => typeof entry === 'string' ? entry : entry.pattern) } : {}),
  };
  return serializeProjectConfig({ ...validateConfig(source), project: suppliedProject ?? project });
}

export function stringifyProjectFixture(config, replacer = null, space = 2) {
  return JSON.stringify(projectFixtureDocument(config), replacer, space);
}

/** 断言已有门禁的执行设置时，显式把磁盘 v2 配置还原为稳定的内部契约。 */
export function parseProjectFixture(content) {
  const document = JSON.parse(content);
  if (document.version !== 2) return document;
  const { project: ignoredProject, configVersion: ignoredVersion, ...config } = normalizeProjectDocument(document);
  void ignoredProject;
  void ignoredVersion;
  return {
    ...config,
    rules: config.rules.map(({ pattern, category, level }) => ({ pattern, category, level })),
    exclusions: config.exclusions.map(({ pattern }) => pattern),
  };
}
