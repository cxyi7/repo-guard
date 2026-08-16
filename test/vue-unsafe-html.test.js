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
  findVueVHtml,
  inspectUnsafeVueHtml,
  VUE_NO_V_HTML_RULE,
} from '../src/policies/vue-unsafe-html.js';

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
    id: 'reviewed-rich-text',
    rule: VUE_NO_V_HTML_RULE,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Reviewed trusted rich-text rendering boundary.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'SEC-2000',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
    ...extra,
  };
}

function createFixture(source, entries = []) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'unsafe-html-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Panel.vue'), source);
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

test('detects v-html attributes only inside the Vue template block', () => {
  const source = [
    '<script setup>',
    'const example = `<div v-html="notMarkup" />`;',
    '</script>',
    '<template>',
    '  <!-- <div v-html="commented" /> -->',
    '  <div',
    '    class="content"',
    '    v-html="trustedHtml"',
    '  />',
    '  <p>{{ `<span v-html="interpolation" />` }}</p>',
    '  <template v-if="visible">',
    '    <section v-html.trim="legacyHtml" />',
    '  </template>',
    '</template>',
    '',
  ].join('\n');

  const findings = findVueVHtml(source, 'src/Panel.vue');
  assert.deepEqual(findings.map(({ rule, path, line, column }) => ({
    rule,
    path,
    line,
    column,
  })), [
    { rule: VUE_NO_V_HTML_RULE, path: 'src/Panel.vue', line: 8, column: 5 },
    { rule: VUE_NO_V_HTML_RULE, path: 'src/Panel.vue', line: 12, column: 14 },
  ]);
});

test('requires an exact active structured exception for v-html', (context) => {
  const source = '<template>\n  <main v-html="trustedHtml" />\n</template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const [finding] = findVueVHtml(source, 'src/Panel.vue');

  const denied = inspectUnsafeVueHtml({
    root,
    files: ['src/Panel.vue'],
    exceptions: registry([exceptionFor(finding, { column: finding.column + 1 })]),
  });
  assert.equal(denied.violations.length, 1);
  assert.equal(denied.approved.length, 0);

  const approved = inspectUnsafeVueHtml({
    root,
    files: ['src/Panel.vue'],
    exceptions: registry([exceptionFor(finding)]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'reviewed-rich-text');
});

test('exposes a full-project unsafe-html CLI with unified failure reporting', (context) => {
  const source = '<template><div v-html="payload" /></template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'unsafe-html'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[vue\/no-v-html\] src\/Panel\.vue:1:16/);
  assert.match(result.stderr, /修复目标:/);

  const [finding] = findVueVHtml(source, 'src/Panel.vue');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry([exceptionFor(finding)]),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  const approved = spawnSync(process.execPath, [CLI_PATH, 'unsafe-html'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /已批准例外.*reviewed-rich-text/);
  assert.match(approved.stdout, /1 条已批准例外/);
});
