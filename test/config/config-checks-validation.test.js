import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChecksConfiguration } from '../../src/config/checks-validation.js';
import {
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
} from '../../src/config/defaults.js';
import { PROJECT_CHECK_PATHS } from '../../src/config/project-feature-paths.js';

const CONFIG_PATH = 'repo-guard.config.json';
const PROJECT = {
  id: 'web',
  role: 'frontend',
  stack: 'node',
  preset: 'vue-javascript',
};

test('applies all engineering defaults when checks are omitted', () => {
  const checks = validateChecksConfiguration(undefined, PROJECT, CONFIG_PATH);
  assert.deepEqual(
    Object.keys(checks).sort(),
    Object.keys(PROJECT_CHECK_PATHS).sort(),
  );
  assert.deepEqual(checks.eslint, DEFAULT_ESLINT_CONFIG);
  assert.deepEqual(checks.prettier, DEFAULT_PRETTIER_CONFIG);
  assert.deepEqual(checks.maxFileLines, DEFAULT_MAX_FILE_LINES_CONFIG);
});

test('delegates checks to their domain validators without reintroducing preCommit', () => {
  const checks = validateChecksConfiguration(
    {
      eslint: { enabled: false },
      asyncResourceCleanup: { enabled: true },
      fileHeader: { enabled: true },
      functionDocs: { enabled: true },
      prettier: { enabled: false },
      stylelint: { enabled: true },
      styleComplexity: { enabled: true },
      styleGovernance: { enabled: true },
      maxFileLines: { enabled: false },
      filePlacement: { enabled: false },
      pathNaming: { enabled: true, convention: 'kebab-case' },
    },
    PROJECT,
    CONFIG_PATH,
  );
  for (const name of [
    'asyncResourceCleanup',
    'fileHeader',
    'functionDocs',
    'stylelint',
    'styleComplexity',
    'styleGovernance',
    'pathNaming',
  ]) {
    assert.equal(checks[name].enabled, true);
  }
  for (const name of ['eslint', 'prettier', 'maxFileLines', 'filePlacement'])
    assert.equal(checks[name].enabled, false);
  assert.equal(checks.pathNaming.convention, 'kebab-case');
  assert.equal(Object.hasOwn(checks.stylelint, 'complexity'), false);
});

test('checks reject unknown fields, invalid sections and duplicate nested features', () => {
  assert.throws(
    () => validateChecksConfiguration([], PROJECT, CONFIG_PATH),
    /checks 必须是对象/,
  );
  assert.throws(
    () => validateChecksConfiguration({ invented: {} }, PROJECT, CONFIG_PATH),
    /包含不支持的属性： invented/,
  );
  assert.throws(
    () =>
      validateChecksConfiguration(
        { unitTest: { coverage: {} } },
        PROJECT,
        CONFIG_PATH,
      ),
    /已移动为 checks.coverage/,
  );
  assert.throws(
    () =>
      validateChecksConfiguration(
        { stylelint: { complexity: {} } },
        PROJECT,
        CONFIG_PATH,
      ),
    /已移动为 checks.styleComplexity/,
  );
});
