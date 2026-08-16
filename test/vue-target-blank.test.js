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
  findVueTargetBlankIssues,
  inspectVueTargetBlank,
  VUE_TARGET_BLANK_RULE,
} from '../src/policies/vue-target-blank.js';

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
    id: 'reviewed-external-link',
    rule: VUE_TARGET_BLANK_RULE,
    path: finding.path,
    line: finding.line,
    column: finding.column,
    reason: 'Reviewed legacy external link compatibility exception.',
    owner: 'frontend-team',
    approvedBy: 'security-team',
    ticket: 'SEC-3000',
    createdOn: dateText(-1),
    expiresOn: dateText(30),
    ...extra,
  };
}

function createFixture(source, entries = []) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'target-blank-'));
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Links.vue'), source);
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

test('requires noopener and noreferrer for statically provable Vue blank targets', () => {
  const source = [
    '<script setup>',
    'const sample = `<a target="_blank">text</a>`;',
    '</script>',
    '<template>',
    '  <!-- <a target="_blank">commented</a> -->',
    '  <a target="_blank" rel="external NOOPENER noreferrer">safe</a>',
    '  <a target="_blank" rel="opener noopener noreferrer">conflict</a>',
    '  <a target=_blank rel="noopener">missing</a>',
    '  <a :target="\'_blank\'" :rel="\'noreferrer noopener\'">bound safe</a>',
    '  <a v-bind:target="\'_blank\'" :rel="computedRel">dynamic rel</a>',
    '  <a :target="linkTarget">unknown target</a>',
    '</template>',
    '',
  ].join('\n');

  const findings = findVueTargetBlankIssues(source, 'src/Links.vue');
  assert.deepEqual(findings.map(({ line, column, forbidden, missing, relKind }) => ({
    line,
    column,
    forbidden,
    missing,
    relKind,
  })), [
    {
      line: 7,
      column: 6,
      forbidden: ['opener'],
      missing: [],
      relKind: 'static',
    },
    {
      line: 8,
      column: 6,
      forbidden: [],
      missing: ['noreferrer'],
      relKind: 'static',
    },
    {
      line: 10,
      column: 6,
      forbidden: [],
      missing: ['noopener', 'noreferrer'],
      relKind: 'dynamic',
    },
  ]);
});

test('requires an exact active structured exception for an unsafe blank target', (context) => {
  const source = '<template>\n  <a target="_blank">legacy</a>\n</template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const [finding] = findVueTargetBlankIssues(source, 'src/Links.vue');

  const denied = inspectVueTargetBlank({
    root,
    files: ['src/Links.vue'],
    exceptions: registry([exceptionFor(finding, { line: finding.line + 1 })]),
  });
  assert.equal(denied.violations.length, 1);
  assert.equal(denied.approved.length, 0);

  const approved = inspectVueTargetBlank({
    root,
    files: ['src/Links.vue'],
    exceptions: registry([exceptionFor(finding)]),
  });
  assert.equal(approved.violations.length, 0);
  assert.equal(approved.approved[0].exception.id, 'reviewed-external-link');
});

test('exposes a full-project target-blank CLI with unified reporting', (context) => {
  const source = '<template><a target="_blank">docs</a></template>\n';
  const root = createFixture(source);
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [CLI_PATH, 'target-blank'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /vue\/target-blank-security/);
  assert.match(result.stderr, /rel="noopener noreferrer"/);
  assert.match(result.stderr, /rel="noopener noreferrer"/);

  const [finding] = findVueTargetBlankIssues(source, 'src/Links.vue');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      exceptions: registry([exceptionFor(finding)]),
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
    }, null, 2)}\n`,
  );
  const approved = spawnSync(process.execPath, [CLI_PATH, 'target-blank'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stderr, /已批准例外.*reviewed-external-link/);
  assert.match(approved.stdout, /1 条已批准例外/);
});
