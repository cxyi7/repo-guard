// 用户配置能力，执行层继续接收同一份内部门禁契约。
export const PROJECT_CHECK_PATHS = Object.freeze({
  eslint: ['preCommit', 'eslint'],
  prettier: ['preCommit', 'prettier'],
  stylelint: ['preCommit', 'stylelint'],
  styleComplexity: ['preCommit', 'stylelint', 'complexity'],
  styleGovernance: ['preCommit', 'stylelint', 'governance'],
  maxFileLines: ['preCommit', 'maxFileLines'],
  filePlacement: ['preCommit', 'filePlacement'],
  fileHeader: ['preCommit', 'fileHeader'],
  functionDocs: ['preCommit', 'functionDocs'],
  asyncResourceCleanup: ['preCommit', 'asyncResourceCleanup'],
  pathNaming: ['preCommit', 'pathNaming'],
  deadCode: ['deadCode'],
  imageAssets: ['imageAssets'],
  unusedImageAssets: ['imageAssets', 'unused'],
  uiTokens: ['uiTokens'],
  architecture: ['architecture'],
  accessibilityTest: ['accessibilityTest'],
  build: ['build'],
  lighthouse: ['lighthouse'],
  typeCheck: ['typeCheck'],
  unitTest: ['unitTest'],
  coverage: ['unitTest', 'coverage'],
  componentInteraction: ['unitTest', 'componentInteraction'],
  mutationTest: ['mutationTest'],
});

export const REPOSITORY_FIELDS = Object.freeze([
  'rules', 'exclusions', 'exceptions', 'dependencyPolicy', 'commitMessage',
  'deliveryContract', 'codePlacement',
]);

export function valueAtPath(value, segments) {
  return segments.reduce((current, segment) => current?.[segment], value);
}

export function setValueAtPath(value, segments, item) {
  const [first, ...remaining] = segments;
  return {
    ...value,
    [first]: remaining.length > 0
      ? setValueAtPath(value[first] ?? {}, remaining, item)
      : structuredClone(item),
  };
}
