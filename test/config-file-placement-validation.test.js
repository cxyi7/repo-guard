import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FILE_PLACEMENT_CONFIG } from '../src/config/defaults.js';
import { validateFilePlacementConfiguration } from '../src/config/file-placement-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies file placement defaults when configuration is omitted', () => {
  assert.deepEqual(
    validateFilePlacementConfiguration({}, CONFIG_PATH),
    DEFAULT_FILE_PLACEMENT_CONFIG,
  );
});

test('normalizes file placement modes, rules, patterns, and directories', () => {
  assert.deepEqual(validateFilePlacementConfiguration({
    filePlacement: {
      enabled: false,
      mode: 'changedFiles',
      rules: [{
        name: '  设计文件  ',
        patterns: ['  **/*.{fig,sketch}  '],
        allowedPatterns: ['  design/**  '],
        exceptions: ['  design/examples/**  '],
        suggestedDirectory: '  design/source/  ',
      }],
    },
  }, CONFIG_PATH), {
    enabled: false,
    mode: 'changedFiles',
    rules: [{
      name: '设计文件',
      patterns: ['**/*.{fig,sketch}'],
      allowedPatterns: ['design/**'],
      exceptions: ['design/examples/**'],
      suggestedDirectory: 'design/source',
    }],
  });
});

test('requires a file placement object with valid switches and modes', () => {
  assert.throws(
    () => validateFilePlacementConfiguration({ filePlacement: [] }, CONFIG_PATH),
    /preCommit\.filePlacement must be an object/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: { command: 'check' },
    }, CONFIG_PATH),
    /has unsupported properties: command/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: { enabled: 'yes' },
    }, CONFIG_PATH),
    /filePlacement\.enabled must be a boolean/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: { mode: 'strict' },
    }, CONFIG_PATH),
    /mode must be newFiles or changedFiles/,
  );
});

test('requires structured file placement rules', () => {
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: { rules: [] },
    }, CONFIG_PATH),
    /rules must be a non-empty array/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: { rules: ['invalid'] },
    }, CONFIG_PATH),
    /rule 1 must be an object/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: {
        rules: [{
          name: '  ',
          patterns: ['**/*.fig'],
          allowedPatterns: ['design/**'],
          suggestedDirectory: 'design',
        }],
      },
    }, CONFIG_PATH),
    /rule 1\.name must be a non-empty string/,
  );
});

test('rejects unsafe file placement patterns and suggested directories', () => {
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: {
        rules: [{
          name: 'Secrets',
          patterns: ['**/*.key'],
          allowedPatterns: ['../secrets/**'],
          suggestedDirectory: 'secrets',
        }],
      },
    }, CONFIG_PATH),
    /must stay inside the repository/,
  );
  assert.throws(
    () => validateFilePlacementConfiguration({
      filePlacement: {
        rules: [{
          name: 'Design',
          patterns: ['**/*.fig'],
          allowedPatterns: ['design/**'],
          suggestedDirectory: 'design/*',
        }],
      },
    }, CONFIG_PATH),
    /suggestedDirectory must be a concrete directory/,
  );
});
