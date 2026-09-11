export const JAVA_PROJECT_CHECKS = Object.freeze([
  'javaFormat', 'javaNaming', 'javaLayout', 'javaImports', 'javaSize',
  'javaDocs', 'javaLint', 'javaDuplication', 'javaArchitecture',
  'javaDependencies', 'javaFiles', 'javaCompile', 'javaBuild', 'javaTest', 'javaCoverage',
  'javaPathNaming', 'javaSpotbugs', 'javaMutationTest',
]);

export const NODE_ONLY_PROJECT_CHECKS = Object.freeze([
  'eslint', 'prettier', 'stylelint', 'styleComplexity', 'styleGovernance',
  'fileHeader', 'functionDocs', 'asyncResourceCleanup', 'deadCode',
  'unusedImageAssets', 'uiTokens', 'architecture', 'accessibilityTest',
  'build', 'lighthouse', 'typeCheck', 'unitTest', 'coverage',
  'componentInteraction', 'mutationTest',
]);

export const PROJECT_CHECK_PATHS = Object.freeze(
  Object.fromEntries(
    [
      'eslint',
      'prettier',
      'stylelint',
      'styleComplexity',
      'styleGovernance',
      'maxFileLines',
      'filePlacement',
      'fileHeader',
      'functionDocs',
      'asyncResourceCleanup',
      'pathNaming',
      'deadCode',
      'imageAssets',
      'unusedImageAssets',
      'uiTokens',
      'architecture',
      'accessibilityTest',
      'build',
      'lighthouse',
      'typeCheck',
      'unitTest',
      'coverage',
      'componentInteraction',
      'mutationTest',
      ...JAVA_PROJECT_CHECKS,
    ].map((feature) => [feature, Object.freeze(['checks', feature])]),
  ),
);

export const REPOSITORY_FIELDS = Object.freeze([
  'rules',
  'exclusions',
  'exceptions',
  'dependencyPolicy',
  'commitMessage',
  'deliveryContract',
  'codePlacement',
  'filePlacement',
]);

export function valueAtPath(value, segments) {
  return segments.reduce((current, segment) => current?.[segment], value);
}

export function setValueAtPath(value, segments, item) {
  const [first, ...remaining] = segments;
  return {
    ...value,
    [first]:
      remaining.length > 0
        ? setValueAtPath(value[first] ?? {}, remaining, item)
        : structuredClone(item),
  };
}
