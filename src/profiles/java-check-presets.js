export const JAVA_DEFAULT_ENABLED_CHECKS = Object.freeze([
  'javaFormat', 'javaNaming', 'javaLayout', 'javaImports', 'javaSize',
  'javaDocs', 'javaLint', 'javaDuplication', 'javaArchitecture',
  'javaDependencies', 'javaFiles', 'javaCompile', 'javaBuild', 'javaTest',
  'javaCoverage', 'javaPathNaming', 'javaSpotbugs', 'javaMutationTest',
]);

/** 新建模板表达启用意图；工具和证据缺项仍须经过严格运行配置校验。 */
export function javaCheckPresets(document) {
  if (document.project.preset !== 'java-maven') return {};
  return Object.fromEntries(JAVA_DEFAULT_ENABLED_CHECKS.map((feature) => [
    feature, { ...document.checks[feature], enabled: true },
  ]));
}
