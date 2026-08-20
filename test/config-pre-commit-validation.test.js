import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ESLINT_CONFIG,
  DEFAULT_FILE_HEADER_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_MAX_FILE_LINES_CONFIG,
  DEFAULT_PRETTIER_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
} from '../src/config/defaults.js';
import { validatePreCommitConfiguration } from '../src/config/pre-commit-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies staged quality defaults when pre-commit configuration is omitted', () => {
  assert.deepEqual(validatePreCommitConfiguration({}, CONFIG_PATH), {
    fileHeader: DEFAULT_FILE_HEADER_CONFIG,
    filePlacement: DEFAULT_FILE_PLACEMENT_CONFIG,
    maxFileLines: DEFAULT_MAX_FILE_LINES_CONFIG,
    stylelint: DEFAULT_STYLELINT_CONFIG,
    prettier: DEFAULT_PRETTIER_CONFIG,
    eslint: DEFAULT_ESLINT_CONFIG,
  });
});

test('delegates staged quality settings to their domain validators', () => {
  const preCommit = validatePreCommitConfiguration({
    preCommit: {
      eslint: { enabled: false },
      fileHeader: { enabled: true },
      prettier: { enabled: false },
      stylelint: { enabled: true },
      maxFileLines: { enabled: false },
      filePlacement: { enabled: false },
    },
  }, CONFIG_PATH);

  assert.equal(preCommit.eslint.enabled, false);
  assert.equal(preCommit.fileHeader.enabled, true);
  assert.equal(preCommit.prettier.enabled, false);
  assert.equal(preCommit.stylelint.enabled, true);
  assert.equal(preCommit.maxFileLines.enabled, false);
  assert.equal(preCommit.filePlacement.enabled, false);
});

test('requires a pre-commit object with only staged quality properties', () => {
  assert.throws(
    () => validatePreCommitConfiguration({ preCommit: [] }, CONFIG_PATH),
    /preCommit 必须是对象/,
  );
  assert.throws(
    () => validatePreCommitConfiguration({
      preCommit: { unitTest: { enabled: true } },
    }, CONFIG_PATH),
    /preCommit 包含不支持的属性： unitTest/,
  );
});
