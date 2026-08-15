import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_LEVELS as configSupportedLevels } from '../src/config.js';
import {
  normalizeProtectedFileConfiguration,
  SUPPORTED_LEVELS,
  validateProtectedFileConfigurationShape,
} from '../src/config/protected-file-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('preserves the supported protected-file enforcement levels', () => {
  assert.equal(configSupportedLevels, SUPPORTED_LEVELS);
  assert.deepEqual([...SUPPORTED_LEVELS], ['notify', 'audit']);
});

test('requires protected-file rules and structured exclusions', () => {
  assert.throws(
    () => validateProtectedFileConfigurationShape({ rules: [] }, CONFIG_PATH),
    /must define at least one rule/,
  );
  assert.throws(
    () => validateProtectedFileConfigurationShape({
      rules: [{}],
      exclusions: 'generated/**',
    }, CONFIG_PATH),
    /exclusions must be an array/,
  );
});

test('normalizes protected-file rules and exclusions with compiled matchers', () => {
  const config = {
    rules: [{
      pattern: ' src\\** ',
      category: ' Source ',
      level: 'audit',
    }],
    exclusions: [' src/generated/** '],
  };
  validateProtectedFileConfigurationShape(config, CONFIG_PATH);

  const { rules, exclusions } = normalizeProtectedFileConfiguration(config, CONFIG_PATH);

  assert.deepEqual(rules.map(({ pattern, category, level }) => ({
    pattern,
    category,
    level,
  })), [{
    pattern: 'src/**',
    category: 'Source',
    level: 'audit',
  }]);
  assert.equal(rules[0].matcher.test('src/index.js'), true);
  assert.deepEqual(exclusions.map(({ pattern }) => ({ pattern })), [{
    pattern: 'src/generated/**',
  }]);
  assert.equal(exclusions[0].matcher.test('src/generated/api.js'), true);
});

test('requires structured protected-file rules with supported values', () => {
  assert.throws(
    () => normalizeProtectedFileConfiguration({ rules: ['src/**'] }, CONFIG_PATH),
    /rule 1 must be an object/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit', action: 'fail' }],
    }, CONFIG_PATH),
    /rule 1 has unsupported properties: action/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: ' ', category: 'Source', level: 'audit' }],
    }, CONFIG_PATH),
    /rule 1 has no pattern/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: ' ', level: 'audit' }],
    }, CONFIG_PATH),
    /rule 1 has no category/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'block' }],
    }, CONFIG_PATH),
    /rule 1 has unsupported level: block/,
  );
});

test('requires non-empty protected-file exclusion patterns', () => {
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
      exclusions: [''],
    }, CONFIG_PATH),
    /exclusion 1 must be a non-empty string/,
  );
});
