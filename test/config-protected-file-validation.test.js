import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProtectedFileConfiguration,
  SUPPORTED_LEVELS,
  validateProtectedFileConfigurationShape,
} from '../src/config/protected-file-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('preserves the supported protected-file enforcement levels', () => {
  assert.deepEqual([...SUPPORTED_LEVELS], ['notify', 'audit', 'block']);
});

test('requires protected-file rules and structured exclusions', () => {
  assert.throws(
    () => validateProtectedFileConfigurationShape({ rules: [] }, CONFIG_PATH),
    /必须至少定义一条规则/,
  );
  assert.throws(
    () => validateProtectedFileConfigurationShape({
      rules: [{}],
      exclusions: 'generated/**',
    }, CONFIG_PATH),
    /exclusions 必须是数组/,
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
    /规则 1 必须是对象/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit', action: 'fail' }],
    }, CONFIG_PATH),
    /规则 1 包含不支持的属性： action/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: ' ', category: 'Source', level: 'audit' }],
    }, CONFIG_PATH),
    /规则 1 缺少 pattern/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: ' ', level: 'audit' }],
    }, CONFIG_PATH),
    /规则 1 缺少 category/,
  );
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'deny' }],
    }, CONFIG_PATH),
    /规则 1 使用了不支持的级别： deny/,
  );
});

test('accepts block rules for immutable protected files', () => {
  const { rules } = normalizeProtectedFileConfiguration({
    rules: [{
      pattern: 'src/security/permission-map.ts',
      category: '不可变安全文件',
      level: 'block',
    }],
  }, CONFIG_PATH);

  assert.equal(rules[0].level, 'block');
  assert.equal(rules[0].matcher.test('src/security/permission-map.ts'), true);
});

test('requires non-empty protected-file exclusion patterns', () => {
  assert.throws(
    () => normalizeProtectedFileConfiguration({
      rules: [{ pattern: 'src/**', category: 'Source', level: 'audit' }],
      exclusions: [''],
    }, CONFIG_PATH),
    /排除项 1 必须是非空字符串/,
  );
});
