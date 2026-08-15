import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArchitectureConfiguration } from '../src/config/architecture-validation.js';
import { DEFAULT_ARCHITECTURE_CONFIG } from '../src/config/defaults.js';

const CONFIG_PATH = 'repo-guard.config.json';

function architectureRule(overrides = {}) {
  return {
    name: 'no-ui-to-api',
    comment: ' Keep the UI independent. ',
    from: { path: '^src/ui/' },
    to: { pathNot: ['^src/contracts/'] },
    ...overrides,
  };
}

test('applies architecture defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateArchitectureConfiguration({}, CONFIG_PATH),
    DEFAULT_ARCHITECTURE_CONFIG,
  );
});

test('normalizes architecture paths and clones rule conditions', () => {
  const rule = architectureRule();
  const result = validateArchitectureConfiguration({
    architecture: {
      enabled: true,
      timeoutMs: 90000,
      sourcePaths: [' src ', 'packages\\ui'],
      tsConfig: ' configs\\tsconfig.app.json ',
      exclude: null,
      rules: [rule],
    },
  }, CONFIG_PATH);

  assert.deepEqual(result, {
    enabled: true,
    timeoutMs: 90000,
    sourcePaths: ['src', 'packages/ui'],
    tsConfig: 'configs/tsconfig.app.json',
    exclude: null,
    rules: [{
      name: 'no-ui-to-api',
      comment: 'Keep the UI independent.',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { pathNot: ['^src/contracts/'] },
    }],
  });
  assert.notEqual(result.rules[0].from, rule.from);
  assert.notEqual(result.rules[0].to, rule.to);
});

test('rejects invalid architecture scalars and exclusion expressions', () => {
  assert.throws(
    () => validateArchitectureConfiguration({
      architecture: { timeoutMs: 0 },
    }, CONFIG_PATH),
    /architecture\.timeoutMs must be a positive integer/,
  );
  assert.throws(
    () => validateArchitectureConfiguration({
      architecture: { exclude: '(' },
    }, CONFIG_PATH),
    /architecture\.exclude must be a valid regex/,
  );
});

test('rejects duplicate rules and invalid condition expressions', () => {
  assert.throws(
    () => validateArchitectureConfiguration({
      architecture: { rules: [architectureRule(), architectureRule()] },
    }, CONFIG_PATH),
    /architecture rule name is duplicated/,
  );
  assert.throws(
    () => validateArchitectureConfiguration({
      architecture: {
        rules: [architectureRule({ from: { path: '(' } })],
      },
    }, CONFIG_PATH),
    /architecture rule 1\.from\.path must be a valid regex/,
  );
});
