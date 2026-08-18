import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCiConfiguration } from '../src/config/ci-validation.js';
import { DEFAULT_CI_CONFIG } from '../src/config/defaults.js';

const CONFIG_PATH = 'repo-guard.config.json';

function externalGate(overrides = {}) {
  return {
    id: 'project.api-contract',
    enabled: true,
    environments: ['manual', 'ci-full'],
    script: 'test:api-contract',
    timeoutMs: 120000,
    report: {
      format: 'repo-guard-json-v1',
      path: 'reports/api-contract.json',
    },
    ...overrides,
  };
}

test('applies platform CI defaults without creating external gates', () => {
  assert.deepEqual(validateCiConfiguration({}, CONFIG_PATH), {
    ci: DEFAULT_CI_CONFIG,
    externalGates: [],
  });
});

test('normalizes CI configuration and copies external gate environments', () => {
  const gate = externalGate();
  const result = validateCiConfiguration({
    ci: {
      enabled: true,
      profile: 'full',
      reportPath: 'reports/custom.json',
      protectedFiles: { action: 'fail' },
    },
    externalGates: [gate],
  }, CONFIG_PATH);

  assert.deepEqual(result.ci, {
    enabled: true,
    profile: 'full',
    reportPath: 'reports/custom.json',
    protectedFiles: { action: 'fail' },
    gatePolicy: { defaultMode: 'inherit', gates: {} },
  });
  assert.deepEqual(result.externalGates, [gate]);
  assert.notEqual(result.externalGates[0].environments, gate.environments);
});

test('validates and normalizes CI-only Gate policies without enumerating Gate ids', () => {
  const result = validateCiConfiguration({
    ci: {
      gatePolicy: {
        defaultMode: 'report',
        gates: {
          'security.dynamic-code': { mode: 'enforce', scope: 'changed-files' },
          'project.future-check': { mode: 'off' },
        },
      },
    },
  }, CONFIG_PATH);

  assert.deepEqual(result.ci.gatePolicy, {
    defaultMode: 'report',
    gates: {
      'security.dynamic-code': { mode: 'enforce', scope: 'changed-files' },
      'project.future-check': { mode: 'off', scope: 'all-files' },
    },
  });
  for (const [gatePolicy, message] of [
    [{ defaultMode: 'warn' }, /defaultMode 必须为/],
    [{ gates: [] }, /gates 必须是对象/],
    [{ gates: { invalid: { mode: 'off' } } }, /点分隔的 kebab-case/],
    [{ gates: { 'security.dynamic-code': {} } }, /mode 为必填项/],
    [{ gates: { 'security.dynamic-code': { mode: 'warn' } } }, /mode 必须为/],
    [{ gates: { 'security.dynamic-code': { mode: 'off', scope: 'staged' } } }, /scope 必须为/],
  ]) {
    assert.throws(
      () => validateCiConfiguration({ ci: { gatePolicy } }, CONFIG_PATH),
      message,
    );
  }
});

test('rejects duplicate and conflicting external report paths case-insensitively', () => {
  const gate = externalGate();
  assert.throws(
    () => validateCiConfiguration({
      externalGates: [
        gate,
        externalGate({
          id: 'project.browser',
          report: { ...gate.report, path: 'reports/API-CONTRACT.json' },
        }),
      ],
    }, CONFIG_PATH),
    /外部门禁报告路径重复/,
  );
  assert.throws(
    () => validateCiConfiguration({
      ci: { reportPath: 'reports/API-CONTRACT.json' },
      externalGates: [gate],
    }, CONFIG_PATH),
    /不能与 ci\.reportPath 相同/,
  );
});

test('preserves strict external gate field and environment validation', () => {
  assert.throws(
    () => validateCiConfiguration({
      externalGates: [externalGate({ environments: ['manual', 'manual'] })],
    }, CONFIG_PATH),
    /不重复的 manual、ci-full 或 release-ready 值/,
  );
  assert.throws(
    () => validateCiConfiguration({
      externalGates: [externalGate({ command: 'npm test' })],
    }, CONFIG_PATH),
    /包含不支持的属性： command/,
  );
});
