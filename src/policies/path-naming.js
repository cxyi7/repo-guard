import path from 'node:path';
import micromatch from 'micromatch';

export const PATH_NAMING_RULE = 'repository/path-naming';

const CONVENTION_PATTERNS = Object.freeze({
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  'kebab-case': /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
});

function relativePath(candidate) {
  return (typeof candidate === 'string' ? candidate : candidate.relative)
    .replaceAll('\\', '/');
}

function matches(pathname, patterns) {
  return micromatch.isMatch(pathname, patterns, { dot: true });
}

function isSelected(pathname, config) {
  return matches(pathname, config.include) && !matches(pathname, config.exclude);
}

export function selectPathNamingFiles(files, config) {
  return files
    .map(relativePath)
    .filter((pathname) => isSelected(pathname, config));
}

function directoryPaths(filePath) {
  const segments = filePath.split('/').slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function fileNameSegments(filePath) {
  const basename = path.posix.basename(filePath);
  if (basename.startsWith('.')) return [basename];
  const segments = basename.split('.');
  if (segments.length > 1) segments.pop();
  return segments.filter(Boolean);
}

function namingViolation(pathname, name, kind, convention) {
  const type = kind === 'directory' ? '目录' : '文件';
  const example = convention === 'camelCase' ? 'committeeInfo' : 'committee-info';
  return {
    rule: PATH_NAMING_RULE,
    issue: `path-naming/invalid-${kind}`,
    path: pathname,
    name,
    kind,
    message: `${type}名 ${name} 不符合项目统一的 ${convention} 规范`,
    evidence: `项目配置只允许 ${convention}；当前名称为 ${name}`,
    expected: `${type}名使用 ${convention}，例如 ${example}`,
    remediation: `重命名该${type}并同步更新所有引用，使名称符合 ${convention}；不得通过同时允许第二种命名风格绕过检查。`,
  };
}

export function inspectPathNaming({ files, config, skipFiles = [] }) {
  const skipped = new Set(skipFiles.map(relativePath));
  const allSelectedFiles = selectPathNamingFiles(files, config);
  const selectedFiles = allSelectedFiles
    .filter((filePath) => !skipped.has(filePath));
  const selectedDirectories = [...new Set(allSelectedFiles.flatMap(directoryPaths))]
    .filter((directory) => isSelected(directory, config));
  const pattern = CONVENTION_PATTERNS[config.convention];
  const violations = [];

  for (const file of selectedFiles) {
    for (const name of fileNameSegments(file)) {
      if (!pattern.test(name)) {
        violations.push(namingViolation(file, name, 'file', config.convention));
      }
    }
  }
  for (const directory of selectedDirectories) {
    const name = path.posix.basename(directory);
    if (!pattern.test(name)) {
      violations.push(namingViolation(
        directory,
        name,
        'directory',
        config.convention,
      ));
    }
  }

  return {
    checkedDirectories: selectedDirectories.length,
    checkedFiles: selectedFiles.length,
    violations: violations.sort((left, right) => (
      left.path.localeCompare(right.path) || left.name.localeCompare(right.name)
    )),
  };
}
