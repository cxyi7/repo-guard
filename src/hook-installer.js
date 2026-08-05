import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitAttributes } from './git-attributes.js';
import { findRepositoryRoot, gitValue, runGit } from './git.js';
import { ensureLocalEnvironment } from './local-env.js';
import { ensureLighthouseIgnore } from './lighthouse-ignore.js';

const MANAGED_MARKER = '# repo-guard-managed:v4';
const LEGACY_MANAGED_MARKERS = Object.freeze([
  '# repo-guard-managed:v1',
  '# repo-guard-managed:v2',
  '# repo-guard-managed:v3',
]);
const HOOKS_DIRECTORY = '.githooks';
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const PACKAGE_NAME = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).name;

const HOOK_COMMANDS = {
  'pre-commit': ['pre-commit'],
  'pre-push': ['pre-push', '"$@"'],
  'prepare-commit-msg': ['hook-message', 'prepare', '"$@"'],
  'commit-msg': ['hook-message', 'finalize', '"$1"'],
  'post-commit': ['hook-message', 'cleanup'],
};

function packageCliPath() {
  return `node_modules/${PACKAGE_NAME}/bin/repo-guard.js`;
}

function createHookContent(argumentsList) {
  return [
    '#!/bin/sh',
    '',
    MANAGED_MARKER,
    'set -eu',
    '',
    'repo_root="$(git rev-parse --show-toplevel)"',
    'cd "$repo_root"',
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "repo-guard failed: Node.js is not installed." >&2',
    '  exit 1',
    'fi',
    '',
    `repo_guard_cli="$repo_root/${packageCliPath()}"`,
    'if [ ! -f "$repo_guard_cli" ]; then',
    '  echo "repo-guard failed: package is not installed. Run npm install." >&2',
    '  exit 1',
    'fi',
    '',
    `exec node "$repo_guard_cli" ${argumentsList.join(' ')}`,
    '',
  ].join('\n');
}

function ensureManagedFile(target, content) {
  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf8');
    if (!isManagedHook(existing)) {
      throw new Error(`Refusing to overwrite non-managed Git hook: ${target}`);
    }
  }

  writeFileSync(target, content, 'utf8');
  chmodSync(target, 0o755);
}

function ensurePackageScripts(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw new Error('package.json was not found in the repository root');
  }

  const packageJson = JSON.parse(readFileSync(target, 'utf8'));
  packageJson.scripts ||= {};
  packageJson.scripts['guard:init'] ||= 'repo-guard init';
  packageJson.scripts['guard:migrate'] ||= 'repo-guard migrate';
  packageJson.scripts['guard:enable-quality'] ||= 'repo-guard enable eslint prettier';
  packageJson.scripts['guard:enable-stylelint'] ||= 'repo-guard enable stylelint';
  packageJson.scripts['guard:enable-lighthouse'] ||= 'repo-guard enable lighthouse';
  packageJson.scripts['guard:lighthouse'] ||= 'repo-guard lighthouse';
  packageJson.scripts['guard:enable-unit-test'] ||= 'repo-guard enable unitTest';
  packageJson.scripts['guard:unit-test'] ||= 'repo-guard unit-test';
  packageJson.scripts['guard:file-placement'] ||= 'repo-guard file-placement';
  packageJson.scripts['guard:enable-notification'] ||= 'repo-guard enable notification';
  packageJson.scripts['guard:disable-notification'] ||= 'repo-guard disable notification';
  packageJson.scripts['guard:doctor'] ||= 'repo-guard doctor';
  packageJson.scripts['guard:check'] ||= 'repo-guard check';
  packageJson.scripts['guard:dry-run'] ||= 'repo-guard dry-run';

  if (!packageJson.scripts.prepare) {
    packageJson.scripts.prepare = 'repo-guard install-hooks';
  } else if (!packageJson.scripts.prepare.includes('repo-guard install-hooks')) {
    console.warn(
      'repo-guard warning: package.json already has a prepare script; '
      + 'add "repo-guard install-hooks" to it manually.',
    );
  }

  writeFileSync(target, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

export function installHooks({
  cwd = process.cwd(),
  updatePackageScripts = false,
  allowMissingGit = false,
} = {}) {
  const root = findRepositoryRoot(cwd, { allowMissing: allowMissingGit });
  if (!root) {
    console.log('repo-guard: no Git repository detected; hook installation skipped.');
    return { skipped: true, root: null };
  }

  const configuredHooksPath = gitValue(['config', '--local', '--get', 'core.hooksPath'], '', root);
  if (configuredHooksPath && configuredHooksPath !== HOOKS_DIRECTORY) {
    throw new Error(
      `core.hooksPath is already configured as "${configuredHooksPath}"; `
      + `refusing to replace it with "${HOOKS_DIRECTORY}"`,
    );
  }

  const hooksPath = path.join(root, HOOKS_DIRECTORY);

  for (const hookName of Object.keys(HOOK_COMMANDS)) {
    const target = path.join(hooksPath, hookName);
    if (existsSync(target) && !isManagedHook(readFileSync(target, 'utf8'))) {
      throw new Error(`Refusing to overwrite non-managed Git hook: ${target}`);
    }
  }

  mkdirSync(hooksPath, { recursive: true });

  for (const [hookName, argumentsList] of Object.entries(HOOK_COMMANDS)) {
    ensureManagedFile(
      path.join(hooksPath, hookName),
      createHookContent(argumentsList),
    );
  }

  const gitAttributes = ensureGitAttributes(root);
  const localEnvironment = ensureLocalEnvironment(root);
  const lighthouseIgnore = ensureLighthouseIgnore(root);
  if (updatePackageScripts) {
    ensurePackageScripts(root);
  }

  if (configuredHooksPath !== HOOKS_DIRECTORY) {
    runGit(['config', '--local', 'core.hooksPath', HOOKS_DIRECTORY], { cwd: root });
  }

  return {
    skipped: false,
    root,
    hooksPath: HOOKS_DIRECTORY,
    hooks: Object.keys(HOOK_COMMANDS),
    gitAttributes,
    localEnvironment,
    lighthouseIgnore,
  };
}

export function isManagedHook(content) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n')
    .map((line) => line.trim());
  return lines.includes(MANAGED_MARKER)
    || LEGACY_MANAGED_MARKERS.some((marker) => lines.includes(marker));
}

export function isCurrentManagedHook(content) {
  return String(content).replace(/\r\n/g, '\n').split('\n')
    .some((line) => line.trim() === MANAGED_MARKER);
}

export const managedHookNames = Object.freeze(Object.keys(HOOK_COMMANDS));
