import assert from 'node:assert/strict';
import test from 'node:test';
import {
  globToRegExp,
  matchRule,
  normalizeGitPath,
} from '../src/config/path-matching.js';
import { matchRule as publicMatchRule } from '../src/index.js';

test('preserves the package entry export for rule matching', () => {
  assert.equal(publicMatchRule, matchRule);
});

test('normalizes Git paths without changing repository-relative segments', () => {
  assert.equal(normalizeGitPath('.\\src\\components\\Button.vue'), 'src/components/Button.vue');
  assert.equal(normalizeGitPath('docs/guide.md'), 'docs/guide.md');
});

test('compiles supported glob tokens while escaping regular expression syntax', () => {
  const sourceMatcher = globToRegExp('src/**/*.?s');
  const literalMatcher = globToRegExp('docs/file(1).md');

  assert.equal(sourceMatcher.test('src/index.js'), true);
  assert.equal(sourceMatcher.test('src/core/config.ts'), true);
  assert.equal(sourceMatcher.test('src/core/config.tsx'), false);
  assert.equal(literalMatcher.test('docs/file(1).md'), true);
  assert.equal(literalMatcher.test('docs/file11.md'), false);
});

test('matches the first configured rule after applying exclusions', () => {
  const config = {
    exclusions: [{ matcher: globToRegExp('docs/generated/**') }],
    rules: [
      {
        pattern: 'docs/**',
        matcher: globToRegExp('docs/**'),
        category: 'documentation',
        level: 'notify',
      },
    ],
  };

  assert.deepEqual(matchRule('docs\\guide.md', config), {
    pattern: 'docs/**',
    category: 'documentation',
    level: 'notify',
  });
  assert.equal(matchRule('docs/generated/api.md', config), null);
  assert.equal(matchRule('src/index.js', config), null);
});
