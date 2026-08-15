export function normalizeGitPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegExp(pattern) {
  const normalized = normalizeGitPath(pattern);
  let expression = '';

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '*' && normalized[index + 1] === '*') {
      const followedBySlash = normalized[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
      continue;
    }

    if (character === '*') {
      expression += '[^/]*';
      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += escapeRegExp(character);
  }

  return new RegExp(`^${expression}$`);
}

export function matchRule(filePath, config) {
  const normalized = normalizeGitPath(filePath);
  if (config.exclusions.some(({ matcher }) => matcher.test(normalized))) {
    return null;
  }

  const rule = config.rules.find(({ matcher }) => matcher.test(normalized));
  if (!rule) {
    return null;
  }

  return {
    pattern: rule.pattern,
    category: rule.category,
    level: rule.level,
  };
}
