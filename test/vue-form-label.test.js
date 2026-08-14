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
  findVueFormLabelIssues,
  inspectVueFormLabels,
  VUE_FORM_CONTROL_LABEL_RULE,
} from '../src/vue-form-label.js';

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
    id: 'reviewed-legacy-control',
    rule: VUE_FORM_CONTROL_LABEL_RULE,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Legacy control is pending an approved accessible redesign.',
    owner: 'frontend-team',
    approvedBy: 'accessibility-team',
    ticket: 'A11Y-3000',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
    ...extra,
  };
}

function createFixture(source, entries = []) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'form-label-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Form.vue'), source);
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

test('requires a statically verifiable accessible name for native Vue form controls', () => {
  const source = [
    '<script setup>',
    'const sample = `<input placeholder="not scanned">`;',
    '</script>',
    '<template>',
    '  <!-- <input placeholder="commented"> -->',
    '  <label for="email">Email</label>',
    '  <input id="email">',
    '  <label><span>Name</span><input></label>',
    '  <label><input aria-label="Fallback name"></label>',
    '  <select aria-label="Country"><option>CN</option></select>',
    '  <span id="phone-label">Phone</span>',
    '  <textarea aria-labelledby="phone-label">literal &lt;input&gt;</textarea>',
    '  <input type="hidden">',
    '  <input type="submit" value="Save">',
    '  <MyInput placeholder="custom component">',
    '  <label for="empty"></label>',
    '  <input id="empty">',
    '  <span id="empty-ref"></span>',
    '  <input aria-labelledby="empty-ref">',
    '  <input placeholder="Email">',
    '  <select :aria-label="label"></select>',
    '  <textarea aria-labelledby="missing"></textarea>',
    '  <input id="self" aria-labelledby="self">',
    '  <input :aria-label="\'Search\'">',
    '  <input :id="\'literal-id\'"><label :for="\'literal-id\'">Literal</label>',
    '</template>',
    '',
  ].join('\n');

  const findings = findVueFormLabelIssues(source, 'src/Form.vue');
  assert.deepEqual(findings.map(({ line, column, tagName, issue }) => ({
    line,
    column,
    tagName,
    issue,
  })), [
    {
      line: 17,
      column: 4,
      tagName: 'input',
      issue: 'empty-explicit-label',
    },
    {
      line: 19,
      column: 4,
      tagName: 'input',
      issue: 'invalid-aria-labelledby',
    },
    {
      line: 20,
      column: 4,
      tagName: 'input',
      issue: 'missing-accessible-name',
    },
    {
      line: 21,
      column: 4,
      tagName: 'select',
      issue: 'dynamic-aria-label',
    },
    {
      line: 22,
      column: 4,
      tagName: 'textarea',
      issue: 'invalid-aria-labelledby',
    },
    {
      line: 23,
      column: 4,
      tagName: 'input',
      issue: 'invalid-aria-labelledby',
    },
  ]);
});

test('requires an exact active structured exception for an unlabeled control', (context) => {
  const source = '<template>\n  <input placeholder="Legacy">\n</template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const [finding] = findVueFormLabelIssues(source, 'src/Form.vue');

  const denied = inspectVueFormLabels({
    root,
    files: ['src/Form.vue'],
    exceptions: registry([exceptionFor(finding, { column: finding.column + 1 })]),
  });
  assert.equal(denied.violations.length, 1);
  assert.equal(denied.approved.length, 0);

  const approved = inspectVueFormLabels({
    root,
    files: ['src/Form.vue'],
    exceptions: registry([exceptionFor(finding)]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'reviewed-legacy-control');
});

test('exposes a full-project form-labels CLI with unified reporting', (context) => {
  const source = '<template><select><option>One</option></select></template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'form-labels'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /vue\/form-control-label/);
  assert.match(result.stderr, /<label>/);
  assert.match(result.stderr, /Remediation:/);
  assert.match(result.stderr, /非空静态 aria-label/);

  const [finding] = findVueFormLabelIssues(source, 'src/Form.vue');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry([exceptionFor(finding)]),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  const approved = spawnSync(process.execPath, [CLI_PATH, 'form-labels'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /approved exception.*reviewed-legacy-control/);
  assert.match(approved.stdout, /1 approved exception/);
});
