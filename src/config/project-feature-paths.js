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
