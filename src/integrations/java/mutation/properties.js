// 来自 PIT 1.17.3 mutationCoverage 原生 descriptor 的外部属性；升级协议时同步原生回归。
const externalProperties = new Set([
  'additionalClasspathElements', 'argLine', 'avoidCallsTo', 'classpathDependencyExcludes',
  'coverageThreshold', 'crossModule', 'detectInlinedCode', 'excludedClasses', 'excludedGroups',
  'excludedMethods', 'excludedRunners', 'excludedTestClasses', 'exportLineCoverage', 'extraFeatures',
  'failWhenNoMutations', 'features', 'fullMutationMatrix', 'historyInputFile', 'historyOutputFile',
  'includedGroups', 'includedTestMethods', 'jvmArgs', 'maxMutationsPerClass', 'maxSurviving',
  'mutationEngine', 'mutationThreshold', 'mutationUnitSize', 'mutators', 'outputFormats',
  'projectBase', 'reportsDirectory', 'skipPitest', 'skipTests', 'targetClasses', 'targetTests',
  'testStrengthThreshold', 'threads', 'timeoutConstant', 'timeoutFactor', 'timestampedReports',
  'useClasspathJar', 'useSlf4j', 'verbose', 'verbosity', 'withHistory', 'configDirectory',
  // Maven Help 的 artifact 属性会把有效 POM 重定向到其他项目，不能参与本次证据采集。
  'artifact', 'output', 'plugin.artifactMap', 'project',
].map((name) => name.toLowerCase()));

export function isPitExternalProperty(name) {
  return /^pit\./i.test(name) || externalProperties.has(name.toLowerCase());
}
