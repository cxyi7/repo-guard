export function ensureBuildArtifactBaselineRule(rules, build) {
  const next = rules.map((rule) => ({ ...rule }));
  const baseline = build.artifactBudget;
  if (
    baseline?.enabled &&
    baseline.mode === 'baseline' &&
    !next.some(({ pattern }) => pattern === baseline.baselineFile)
  ) {
    next.push({
      pattern: baseline.baselineFile,
      category: '构建产物历史债务基线',
      level: 'notify',
    });
  }
  return next;
}

export function ensureUiTokenManifestRule(rules, uiTokens) {
  const next = rules.map((rule) => ({ ...rule }));
  if (
    uiTokens.enabled &&
    !next.some(({ pattern }) => pattern === uiTokens.manifestFile)
  ) {
    next.push({
      pattern: uiTokens.manifestFile,
      category: 'UI Token 契约',
      level: 'notify',
    });
  }
  return next;
}
