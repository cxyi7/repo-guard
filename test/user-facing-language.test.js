import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectEnglishUserFacingText,
  compareLanguageDebt,
  createLanguageDebtBaseline,
  pruneLanguageDebtBaseline,
} from '../scripts/user-facing-language.js';

function candidate(fingerprint, text = 'English error') {
  return Object.freeze({
    file: 'src/example.js',
    line: 1,
    context: 'property:message',
    text,
    fingerprint,
  });
}

test('finds English primary output while allowing Chinese text and machine identifiers', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-language-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'example.js'), `
    const machineRuleId = 'eslint/no-unused-vars';
    const chinese = { message: '变量未被使用。', ruleId: machineRuleId };
    const machineSteps = { steps: ['quality.build', 'read-only'] };
    const localizedChoice = { summary: ready ? '配置有效' : 'Conditional failure' };
    const english = { summary: 'Validation failed' };
    const fallback = toRepoGuardError(error?.message ?? 'Fallback failure', {});
    nonEmptyString(value, 'Gate label');
    governanceViolation(source, 0, 'Global style violation');
    throw configurationError('config/invalid', 'Configuration is invalid');
  `, 'utf8');

  assert.deepEqual(
    collectEnglishUserFacingText(root).map(({ context: source, text }) => ({ source, text })),
    [
      { source: 'property:summary', text: 'Conditional failure' },
      { source: 'property:summary', text: 'Validation failed' },
      { source: 'call:toRepoGuardError:fallback', text: 'Fallback failure' },
      { source: 'call:nonEmptyString:label', text: 'Gate label' },
      { source: 'call:governanceViolation:message', text: 'Global style violation' },
      { source: 'call:configurationError', text: 'Configuration is invalid' },
    ],
  );
});

test('allows the Chinese migration debt baseline only to stay equal or decrease', () => {
  const baseline = createLanguageDebtBaseline([
    candidate('existing-a'),
    candidate('existing-a'),
    candidate('existing-b'),
  ]);

  assert.deepEqual(compareLanguageDebt([
    candidate('existing-a'),
    candidate('existing-b'),
  ], baseline), {
    additions: [],
    currentDebtCount: 2,
    baselineDebtCount: 3,
    resolvedDebtCount: 1,
  });
});

test('rejects new or increased English user-facing text debt', () => {
  const baseline = createLanguageDebtBaseline([candidate('existing')]);
  const result = compareLanguageDebt([
    candidate('existing'),
    candidate('existing'),
    candidate('new-message', 'New English remediation'),
  ], baseline);

  assert.deepEqual(
    result.additions.map(({ fingerprint }) => fingerprint),
    ['existing', 'new-message'],
  );
});

test('prunes only resolved English debt and refuses additions', () => {
  const baseline = createLanguageDebtBaseline([
    candidate('existing-a'),
    candidate('existing-b'),
  ]);
  const remaining = [candidate('existing-b')];

  assert.deepEqual(
    pruneLanguageDebtBaseline(remaining, baseline),
    createLanguageDebtBaseline(remaining),
  );
  assert.throws(
    () => pruneLanguageDebtBaseline([
      ...remaining,
      candidate('new-message', 'New English remediation'),
    ], baseline),
    /不能裁剪中文迁移基线/,
  );
});
