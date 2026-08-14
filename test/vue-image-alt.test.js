import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  findVueImageAltIssues,
  inspectVueImageAlts,
  VUE_IMAGE_ALT_RULE,
} from '../src/vue-image-alt.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = fileURLToPath(new URL('../bin/repo-guard.js', import.meta.url));
mkdirSync(TEST_ROOT, { recursive: true });

function dateText(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function registry(entries = []) {
  return { warningDays: 14, maxDays: 90, entries };
}

function exceptionFor(finding, extra = {}) {
  return {
    id: 'reviewed-legacy-image',
    rule: VUE_IMAGE_ALT_RULE,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Legacy image semantics are pending an approved redesign.',
    owner: 'frontend-team',
    approvedBy: 'accessibility-team',
    ticket: 'A11Y-3100',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
    ...extra,
  };
}

function createFixture(source, entries = []) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'image-alt-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Gallery.vue'), source);
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry(entries),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('requires an appropriate statically verifiable alt for native Vue images', () => {
  const source = [
    '<script setup>',
    'const sample = `<img src="not-scanned.png">`;',
    '</script>',
    '<template>',
    '  <!-- <img src="commented.png"> -->',
    '  <img src="hero.jpg" alt="研发团队在白板前讨论发布计划">',
    '  <img src="divider.svg" alt="" role="presentation">',
    '  <img src="shape.svg" :alt="\'\'" :role="\'none\'">',
    '  <img src="literal.jpg" :alt="\'产品订单趋势折线图\'">',
    '  <MyImage src="component.jpg">',
    '  <Img src="pascal-native.jpg">',
    '  <IMG src="uppercase-native.jpg">',
    '  <img src="missing.jpg">',
    '  <img src="dynamic.jpg" :alt="description">',
    '  <img src="empty.jpg" alt="">',
    '  <img src="dynamic-role.jpg" alt="" :role="imageRole">',
    '  <img src="generic.jpg" alt="图片">',
    '  <img src="filename.jpg" alt="filename.jpg">',
    '  <img src="conflict.jpg" alt="销售趋势图" role="none">',
    '  <img src="template.jpg" :alt="`用户 ${name} 的头像`">',
    '  <img v-bind="imageAttrs" alt="产品发布趋势图">',
    '  <img alt="产品图" :alt="description">',
    '  <img alt="" role="none" :role="imageRole">',
    '  <img src="blank.jpg" alt="&nbsp;">',
    '  <img src="status.jpg" alt="✅">',
    '  <img src="dynamic-content-role.jpg" alt="服务运行正常" :role="imageRole">',
    '</template>',
    '',
  ].join('\n');

  const findings = findVueImageAltIssues(source, 'src/Gallery.vue');
  assert.deepEqual(findings.map(({ line, column, issue }) => ({ line, column, issue })), [
    { line: 11, column: 4, issue: 'missing-alt' },
    { line: 12, column: 4, issue: 'missing-alt' },
    { line: 13, column: 4, issue: 'missing-alt' },
    { line: 14, column: 4, issue: 'dynamic-alt' },
    { line: 15, column: 4, issue: 'unmarked-decorative-image' },
    { line: 16, column: 4, issue: 'dynamic-decorative-role' },
    { line: 17, column: 4, issue: 'generic-alt' },
    { line: 18, column: 4, issue: 'filename-alt' },
    { line: 19, column: 4, issue: 'conflicting-decorative-role' },
    { line: 20, column: 4, issue: 'dynamic-alt' },
    { line: 21, column: 4, issue: 'dynamic-attribute-spread' },
    { line: 22, column: 4, issue: 'duplicate-alt' },
    { line: 23, column: 4, issue: 'duplicate-role' },
    { line: 24, column: 4, issue: 'meaningless-alt' },
    { line: 26, column: 4, issue: 'dynamic-image-role' },
  ]);
});

test('requires an exact active structured exception for an invalid image alt', (context) => {
  const source = '<template>\n  <img src="legacy.jpg">\n</template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const [finding] = findVueImageAltIssues(source, 'src/Gallery.vue');

  const denied = inspectVueImageAlts({
    root,
    files: ['src/Gallery.vue'],
    exceptions: registry([exceptionFor(finding, { line: finding.line + 1 })]),
  });
  assert.equal(denied.violations.length, 1);
  assert.equal(denied.approved.length, 0);

  const approved = inspectVueImageAlts({
    root,
    files: ['src/Gallery.vue'],
    exceptions: registry([exceptionFor(finding)]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'reviewed-legacy-image');
});

test('exposes a full-project image-alt CLI with unified reporting', (context) => {
  const source = '<template><img src="legacy.jpg"></template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'image-alt'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /vue\/img-alt/);
  assert.match(result.stderr, /Remediation:/);
  assert.match(result.stderr, /alt=""/);
  assert.match(result.stderr, /role="presentation"/);

  const [finding] = findVueImageAltIssues(source, 'src/Gallery.vue');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry([exceptionFor(finding)]),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  const approved = spawnSync(process.execPath, [CLI_PATH, 'image-alt'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /approved exception.*reviewed-legacy-image/);
  assert.match(approved.stdout, /1 approved exception/);
});
