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
  });
  assert.deepEqual(result.externalGates, [gate]);
  assert.notEqual(result.externalGates[0].environments, gate.environments);
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
    /external gate report path is duplicated/,
  );
  assert.throws(
    () => validateCiConfiguration({
      ci: { reportPath: 'reports/API-CONTRACT.json' },
      externalGates: [gate],
    }, CONFIG_PATH),
    /must differ from ci\.reportPath/,
  );
});

test('preserves strict external gate field and environment validation', () => {
  assert.throws(
    () => validateCiConfiguration({
      externalGates: [externalGate({ environments: ['manual', 'manual'] })],
    }, CONFIG_PATH),
    /unique manual, ci-full, or release-ready values/,
  );
  assert.throws(
    () => validateCiConfiguration({
      externalGates: [externalGate({ command: 'npm test' })],
    }, CONFIG_PATH),
    /unsupported properties: command/,
  );
});
