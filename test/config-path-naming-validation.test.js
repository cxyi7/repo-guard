import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePathNamingConfiguration } from '../src/config/path-naming-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies path naming defaults', () => {
  assert.deepEqual(validatePathNamingConfiguration({}, CONFIG_PATH), {
    enabled: false,
    convention: 'camelCase',
    include: ['src/**', 'utils/**'],
    exclude: ['**/.*', '**/.*/**', '**/generated/**'],
  });
});

test('normalizes one business-selected path naming convention and scope', () => {
  assert.deepEqual(validatePathNamingConfiguration({
    pathNaming: {
      enabled: true,
      convention: 'kebab-case',
      include: ['src/**', 'shared-utils/**'],
      exclude: ['src/generated/**'],
    },
  }, CONFIG_PATH), {
    enabled: true,
    convention: 'kebab-case',
    include: ['src/**', 'shared-utils/**'],
    exclude: ['src/generated/**'],
  });
});

test('rejects multiple, unknown or malformed path naming conventions', () => {
  assert.throws(
    () => validatePathNamingConfiguration({ pathNaming: [] }, CONFIG_PATH),
    /preCommit\.pathNaming 必须是对象/,
  );
  assert.throws(
    () => validatePathNamingConfiguration({
      pathNaming: { convention: ['camelCase', 'kebab-case'] },
    }, CONFIG_PATH),
    /convention 必须是 camelCase 或 kebab-case 中的一个字符串值/,
  );
  assert.throws(
    () => validatePathNamingConfiguration({
      pathNaming: { convention: 'PascalCase' },
    }, CONFIG_PATH),
    /convention 必须是 camelCase 或 kebab-case/,
  );
  assert.throws(
    () => validatePathNamingConfiguration({
      pathNaming: { rules: [] },
    }, CONFIG_PATH),
    /不支持的属性： rules/,
  );
});
