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
  buildMaxFileLinesAiInstructions,
  buildMaxFileLinesWarnings,
  countPhysicalLines,
  evaluateMaxFileLines,
  inspectMaxFileLines,
  matchMaxFileLineRule,
  runMaxFileLinesFiles,
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
  assert.equal(runMaxFileLinesFiles({ root, files: [vueFile], config: CONFIG }), 0);
  assert.equal(runMaxFileLinesFiles({ root, files: [jsFile], config: CONFIG }), 1);
});

test('builds standalone AI refactor instructions for Vue and JavaScript files', () => {
  const instructions = buildMaxFileLinesAiInstructions([
    {
      path: 'src/views/OrderDetail.vue',
      lineCount: 735,
      maxLines: 700,
      sections: { template: 286, script: 371, style: 78 },
    },
    { path: 'src/utils/order-handler.js', lineCount: 1086, maxLines: 1000 },
  ]);

  assert.match(instructions, /可按编号分别将完整指令复制给 AI/);
  assert.match(instructions, /1\. 请重构 src\/views\/OrderDetail\.vue/);
  assert.match(instructions, /当前：735 行；限制：700 行；本次至少需要减少 35 行/);
  assert.match(instructions, /Vue 区域：template 286 行；script 371 行；style 78 行/);
  assert.match(instructions, /script 是当前最大的有效代码区域/);
  assert.match(instructions, /props、emits、slots、路由交互、响应式行为和 scoped 样式语义/);
  assert.match(instructions, /2\. 请重构 src\/utils\/order-handler\.js/);
  assert.match(instructions, /现有导出 API、调用顺序、副作用、错误处理、类型约束和运行结果/);
  assert.match(instructions, /不要删除必要注释、压缩代码、合并可读语句、修改行数限制、关闭门禁、改扩展名或加入 exclusions/);
  assert.match(instructions, /只修改完成本次重构所必需的文件/);
  assert.match(instructions, /运行项目已有的 lint、测试和构建命令/);
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
  assert.match(buildMaxFileLinesWarnings(evaluation.warnings), /当前 8\/10 行（80%），剩余 2 行/);
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
  assert.match(
    buildMaxFileLinesAiInstructions(evaluation.violations),
    /noRegression 基线：HEAD 中为 4 行；本次不得超过 4 行/,
  );

  writeFileSync(existingFile, lines(3));
  evaluation = evaluateMaxFileLines({ root, files: [existingFile], config });
  assert.equal(evaluation.violations.length, 0);
  assert.equal(evaluation.warnings[0].baselineLineCount, 4);

  writeFileSync(newFile, lines(3));
  evaluation = evaluateMaxFileLines({ root, files: [newFile], config });
  assert.equal(evaluation.violations.length, 1);
  assert.equal(evaluation.violations[0].passLineCount, 2);
});
