import micromatch from 'micromatch';

function matches(filePath, patterns) {
  return micromatch.isMatch(filePath, patterns, { dot: true });
}

function normalizedContent(content) {
  return content.replace(/\r\n?/g, '\n');
}

function matchLine(content, expected) {
  const index = content.indexOf(expected);
  if (index < 0) return null;
  return content.slice(0, index).split('\n').length;
}

export function selectCodePlacementFiles(paths, config) {
  return paths.filter((filePath) => config.rules.some(({ scanPatterns }) => (
    matches(filePath, scanPatterns)
  )));
}

export function inspectCodePlacement({ files, config }) {
  const violations = [];
  for (const file of files) {
    const content = normalizedContent(file.content);
    for (const rule of config.rules) {
      if (!matches(file.path, rule.scanPatterns)) continue;
      const line = matchLine(content, rule.content);
      if (line == null || matches(file.path, rule.allowedFiles)) continue;
      violations.push({
        line,
        path: file.path,
        rule,
      });
    }
  }
  return {
    checkedCount: files.length,
    violations,
  };
}
