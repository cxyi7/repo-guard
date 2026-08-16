import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DEPENDENCY_POLICY_CONFIG } from '../src/config/defaults.js';
import { validateDependencyPolicyConfiguration } from '../src/config/dependency-policy-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies dependency policy defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateDependencyPolicyConfiguration({}, CONFIG_PATH),
    DEFAULT_DEPENDENCY_POLICY_CONFIG,
  );
});

test('normalizes protocols and banned package guidance', () => {
  const result = validateDependencyPolicyConfiguration({
    dependencyPolicy: {
      enabled: false,
      requireExactVersions: false,
      requireLockfile: false,
      allowedProtocols: [' NPM ', 'workspace', 'npm'],
      bannedPackages: [{
        name: ' request ',
        reason: '  This package is no longer maintained.  ',
        replacement: '  undici  ',
      }, {
        name: 'legacy-client',
        reason: 'Use the maintained platform client instead.',
      }],
    },
  }, CONFIG_PATH);

  assert.deepEqual(result, {
    enabled: false,
    requireExactVersions: false,
    requireLockfile: false,
    allowedProtocols: ['npm', 'workspace'],
    bannedPackages: [{
      name: 'request',
      reason: 'This package is no longer maintained.',
      replacement: 'undici',
    }, {
      name: 'legacy-client',
      reason: 'Use the maintained platform client instead.',
      replacement: null,
    }],
  });
});

test('rejects invalid switches and protocol names', () => {
  assert.throws(
    () => validateDependencyPolicyConfiguration({
      dependencyPolicy: { enabled: 'yes' },
    }, CONFIG_PATH),
    /dependencyPolicy\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateDependencyPolicyConfiguration({
      dependencyPolicy: { allowedProtocols: ['https:'] },
    }, CONFIG_PATH),
    /不含冒号的协议名称/,
  );
});

test('rejects duplicate banned packages and incomplete guidance', () => {
  const bannedPackage = {
    name: 'request',
    reason: 'This package is no longer maintained.',
  };
  assert.throws(
    () => validateDependencyPolicyConfiguration({
      dependencyPolicy: { bannedPackages: [bannedPackage, bannedPackage] },
    }, CONFIG_PATH),
    /禁用包重复/,
  );
  assert.throws(
    () => validateDependencyPolicyConfiguration({
      dependencyPolicy: {
        bannedPackages: [{ ...bannedPackage, replacement: '  ' }],
      },
    }, CONFIG_PATH),
    /replacement 必须为 null 或非空字符串/,
  );
});
