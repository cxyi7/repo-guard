import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_EXCEPTIONS_CONFIG } from '../src/config/defaults.js';
import { validateExceptionConfiguration } from '../src/config/exception-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

function createException(overrides = {}) {
  return {
    id: 'temporary-rule-exception',
    rule: 'security/no-unsafe-html',
    path: 'src/components/LegacyView.vue',
    line: 12,
    column: 5,
    reason: 'Legacy integration requires a temporary exception.',
    owner: 'frontend-owner',
    approvedBy: 'security-reviewer',
    ticket: 'SEC-123',
    createdOn: '2026-08-01',
    expiresOn: '2026-08-31',
    ...overrides,
  };
}

test('uses the immutable exception defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateExceptionConfiguration({}, CONFIG_PATH),
    DEFAULT_EXCEPTIONS_CONFIG,
  );
});

test('normalizes exact exception entries and trims descriptive fields', () => {
  const result = validateExceptionConfiguration({
    exceptions: {
      warningDays: 5,
      maxDays: 31,
      entries: [createException({
        path: 'src\\components\\LegacyView.vue',
        reason: '  Legacy integration requires a temporary exception.  ',
        owner: '  frontend-owner  ',
        approvedBy: '  security-reviewer  ',
        ticket: '  SEC-123  ',
      })],
    },
  }, CONFIG_PATH);

  assert.deepEqual(result, {
    warningDays: 5,
    maxDays: 31,
    entries: [createException()],
  });
});

test('requires independent approval and a bounded exception lifetime', () => {
  assert.throws(
    () => validateExceptionConfiguration({
      exceptions: {
        entries: [createException({ approvedBy: 'FRONTEND-OWNER' })],
      },
    }, CONFIG_PATH),
    /approvedBy must be different from owner/,
  );
  assert.throws(
    () => validateExceptionConfiguration({
      exceptions: {
        maxDays: 30,
        entries: [createException({ expiresOn: '2026-09-01' })],
      },
    }, CONFIG_PATH),
    /lifetime must be between 1 and 30 days/,
  );
});

test('rejects duplicate exception ids and exact finding targets', () => {
  assert.throws(
    () => validateExceptionConfiguration({
      exceptions: {
        entries: [createException(), createException({ line: 13 })],
      },
    }, CONFIG_PATH),
    /exception id is duplicated/,
  );
  assert.throws(
    () => validateExceptionConfiguration({
      exceptions: {
        entries: [
          createException(),
          createException({ id: 'second-temporary-exception' }),
        ],
      },
    }, CONFIG_PATH),
    /exception target is duplicated/,
  );
});
