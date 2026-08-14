import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  analyzeVueSections,
  countPhysicalLines,
  evaluateMaxFileLines,
  inspectMaxFileLines,
  matchMaxFileLineRule,
} from '../src/max-file-lines.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

const CONFIG = {
  enabled: true,
  mode: 'strict',
  warnAt: 0.85,
  rules: [
    { pattern: '**/*.vue', maxLines: 700 },
    { pattern: '**/*.js', maxLines: 1000 },
  ],
  exclusions: ['src/generated/**'],
};

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function lines(length, value = 'const value = 1;') {
  return Array.from({ length }, () => value).join('\n');
}

test('counts physical lines consistently with and without a trailing newline', () => {
  assert.equal(countPhysicalLines(''), 0);
  assert.equal(countPhysicalLines('one'), 1);
  assert.equal(countPhysicalLines('one\n'), 1);
  assert.equal(countPhysicalLines('one\r\ntwo\r\n'), 2);
  assert.equal(countPhysicalLines('one\n\ntwo'), 3);
});

test('counts the effective content in each Vue section', () => {
  const sections = analyzeVueSections([
    '<template>',
    '  <main>',
    '    <p>Example</p>',
    '  </main>',
    '</template>',
    '<script setup>',
    '',
    'const value = 1;',
    'const doubled = value * 2;',
    '',
    '</script>',
    '<style scoped>',
    '.example {',
    '  color: red;',
    '}',
    '</style>',
  ].join('\n'));

  assert.deepEqual(sections, { template: 3, script: 2, style: 3 });
});

test('uses the first matching rule and honors exclusions', () => {
  assert.deepEqual(matchMaxFileLineRule('src/App.vue', CONFIG), CONFIG.rules[0]);
  assert.deepEqual(matchMaxFileLineRule('scripts/build.js', CONFIG), CONFIG.rules[1]);
  assert.equal(matchMaxFileLineRule('src/generated/large.js', CONFIG), null);
  assert.equal(matchMaxFileLineRule('README.md', CONFIG), null);

  const overlappingRules = {
    rules: [
      { pattern: 'src/**/*.js', maxLines: 100 },
      { pattern: '**/*.js', maxLines: 1000 },
    ],
    exclusions: [],
  };
  assert.deepEqual(
    matchMaxFileLineRule('src/features/example.js', overlappingRules),
    overlappingRules.rules[0],
  );
});

test('allows the exact limit and reports each file above it', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'max-file-lines-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  const vueFile = path.join(root, 'src', 'Boundary.vue');
  const largeVueFile = path.join(root, 'src', 'TooLarge.vue');
  const jsFile = path.join(root, 'src', 'TooLarge.js');
  writeFileSync(vueFile, lines(700, '<div />'));
  writeFileSync(largeVueFile, lines(701, '<div />'));
  writeFileSync(jsFile, lines(1001));

  assert.deepEqual(inspectMaxFileLines({
    root,
    files: [vueFile, largeVueFile, jsFile],
    config: CONFIG,
  }), [
    {
      path: 'src/TooLarge.vue',
      lineCount: 701,
      maxLines: 700,
      pattern: '**/*.vue',
      sections: { template: 0, script: 0, style: 0 },
      mode: 'strict',
      passLineCount: 700,
    },
    {
      path: 'src/TooLarge.js',
      lineCount: 1001,
      maxLines: 1000,
      pattern: '**/*.js',
      sections: null,
      mode: 'strict',
      passLineCount: 1000,
    },
  ]);
  assert.equal(evaluateMaxFileLines({ root, files: [vueFile], config: CONFIG }).violations.length, 0);
  assert.equal(evaluateMaxFileLines({ root, files: [jsFile], config: CONFIG }).violations.length, 1);
});

test('warns at the configured percentage without blocking', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'max-file-lines-warning-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'example.ts');
  const config = {
    mode: 'strict',
    warnAt: 0.8,
    rules: [{ pattern: '**/*.ts', maxLines: 10 }],
    exclusions: [],
  };

  writeFileSync(file, lines(8));
  const evaluation = evaluateMaxFileLines({ root, files: [file], config });

  assert.deepEqual(evaluation.violations, []);
  assert.equal(evaluation.warnings.length, 1);
  assert.equal(evaluation.warnings[0].kind, 'near-limit');
  assert.equal(evaluation.warnings[0].warningLineCount, 8);
});

test('noRegression blocks growth but allows existing over-limit files to hold or shrink', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'max-file-lines-regression-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'repo-guard test']);
  git(root, ['config', 'user.email', 'repo-guard@example.invalid']);

  const existingFile = path.join(root, 'legacy.ts');
  const newFile = path.join(root, 'new.ts');
  writeFileSync(existingFile, lines(4));
  git(root, ['add', 'legacy.ts']);
  git(root, ['commit', '-m', 'test: baseline']);
  const config = {
    mode: 'noRegression',
    warnAt: 0.85,
    rules: [{ pattern: '**/*.ts', maxLines: 2 }],
    exclusions: [],
  };

  writeFileSync(existingFile, lines(4));
  let evaluation = evaluateMaxFileLines({ root, files: [existingFile], config });
  assert.equal(evaluation.violations.length, 0);
  assert.equal(evaluation.warnings[0].kind, 'legacy-over-limit');

  writeFileSync(existingFile, lines(5));
  evaluation = evaluateMaxFileLines({ root, files: [existingFile], config });
  assert.equal(evaluation.violations.length, 1);
  assert.equal(evaluation.violations[0].baselineLineCount, 4);
  assert.equal(evaluation.violations[0].passLineCount, 4);
  assert.equal(evaluation.violations[0].baselineLineCount, 4);
  assert.equal(evaluation.violations[0].passLineCount, 4);

  writeFileSync(existingFile, lines(3));
  evaluation = evaluateMaxFileLines({ root, files: [existingFile], config });
  assert.equal(evaluation.violations.length, 0);
  assert.equal(evaluation.warnings[0].baselineLineCount, 4);

  writeFileSync(newFile, lines(3));
  evaluation = evaluateMaxFileLines({ root, files: [newFile], config });
  assert.equal(evaluation.violations.length, 1);
  assert.equal(evaluation.violations[0].passLineCount, 2);
});
