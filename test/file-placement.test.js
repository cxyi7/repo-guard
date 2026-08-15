import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_FILE_PLACEMENT_CONFIG } from '../src/config.js';
import { inspectFilePlacement } from '../src/policies/file-placement.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CLI_PATH = path.join(process.cwd(), 'bin', 'repo-guard.js');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function change(filePath, status = 'A') {
  return { status, oldPath: null, path: filePath };
}

test('default rules keep resources in asset folders and Markdown in documentation folders', () => {
  const result = inspectFilePlacement({
    config: DEFAULT_FILE_PLACEMENT_CONFIG,
    changes: [
      change('src/components/UserCard/avatar.png'),
      change('src/assets/images/avatar.png'),
      change('src/assets/images/LOGO.PNG'),
      change('src/Assets/header.PNG'),
      change('src/components/UserCard/design.md'),
      change('docs/components/user-card.md'),
      change('README.md'),
      change('.github/ISSUE_TEMPLATE/bug.md'),
    ],
  });

  assert.equal(result.checkedCount, 8);
  assert.deepEqual(
    result.violations.map(({ path }) => path),
    [
      'src/components/UserCard/avatar.png',
      'src/Assets/header.PNG',
      'src/components/UserCard/design.md',
    ],
  );
  assert.deepEqual(
    result.violations.map(({ suggestedPath }) => suggestedPath),
    ['src/assets/avatar.png', 'src/assets/header.PNG', 'docs/design.md'],
  );
});

test('supports project-defined file types and directories', () => {
  const config = {
    enabled: true,
    mode: 'newFiles',
    rules: [{
      name: '设计源文件',
      patterns: ['**/*.{fig,sketch}'],
      allowedPatterns: ['design/**'],
      exceptions: [],
      suggestedDirectory: 'design',
    }],
  };
  const result = inspectFilePlacement({
    config,
    changes: [
      change('src/components/home.fig'),
      change('design/home.fig'),
      change('src/components/legacy.fig', 'M'),
      {
        status: 'R100',
        oldPath: 'design/renamed.fig',
        path: 'src/components/renamed.fig',
      },
    ],
  });

  assert.deepEqual(
    result.violations.map(({ path }) => path),
    ['src/components/home.fig', 'src/components/renamed.fig'],
  );
});

test('changedFiles mode checks modified legacy files and supplies a suggested target', () => {
  const config = {
    ...DEFAULT_FILE_PLACEMENT_CONFIG,
    mode: 'changedFiles',
  };
  const result = inspectFilePlacement({
    config,
    changes: [change('src/components/legacy.svg', 'M')],
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].path, 'src/components/legacy.svg');
  assert.equal(result.violations[0].suggestedPath, 'src/assets/legacy.svg');
});

test('full-project inspection checks tracked and non-ignored untracked files regardless of mode', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'file-placement-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init']);
  mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'components', 'legacy.md'), '# legacy\n');
  writeFileSync(path.join(root, 'docs', 'guide.md'), '# guide\n');
  writeFileSync(path.join(root, '.gitignore'), 'ignored.md\n');
  writeFileSync(path.join(root, 'ignored.md'), '# ignored\n');
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      notification: { enabled: false },
      preCommit: {
        filePlacement: {
          ...DEFAULT_FILE_PLACEMENT_CONFIG,
          enabled: false,
          mode: 'newFiles',
        },
      },
      rules: [{ pattern: '**', category: 'Fixture', level: 'audit' }],
      exclusions: [],
    }, null, 2)}\n`,
  );
  git(root, ['add', 'src/components/legacy.md', '.gitignore']);

  const failedCliResult = spawnSync(process.execPath, [CLI_PATH, 'file-placement'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(failedCliResult.status, 2);
  assert.match(failedCliResult.stderr, /src\/components\/legacy\.md/);
  assert.doesNotMatch(failedCliResult.stderr, /ignored\.md/);

  renameSync(
    path.join(root, 'src', 'components', 'legacy.md'),
    path.join(root, 'docs', 'legacy.md'),
  );
  const cliResult = spawnSync(process.execPath, [CLI_PATH, 'file-placement'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /File placement project check passed/);
});
