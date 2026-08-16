import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';
import { gateRegistry } from '../../gates/registry.js';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../config/configuration-loader.js';
import { DEFAULT_UNIT_TEST_COVERAGE_CONFIG } from '../../config/defaults.js';
import { ensureGitAttributes } from './git-attributes.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { gitValue, runGit } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { ensureLocalEnvironment } from '../../policies/local-environment.js';
import { ensureLighthouseIgnore } from './lighthouse-ignore.js';

const MANAGED_MARKER = '# repo-guard-managed:v4';
const LEGACY_MANAGED_MARKERS = Object.freeze([
  '# repo-guard-managed:v1',
  '# repo-guard-managed:v2',
  '# repo-guard-managed:v3',
]);
const HOOKS_DIRECTORY = '.githooks';
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../../package.json', import.meta.url));

const HOOK_COMMANDS = {
  'pre-commit': ['pre-commit'],
  'pre-push': ['pre-push', '"$@"'],
  'prepare-commit-msg': ['hook-message', 'prepare', '"$@"'],
  'commit-msg': ['hook-message', 'finalize', '"$1"'],
  'post-commit': ['hook-message', 'cleanup'],
};

function loadPackageName() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).name;
}

function packageCliPath(packageName) {
  return `node_modules/${packageName}/bin/repo-guard.js`;
}

function createHookContent(argumentsList, packageName) {
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
    '  echo "repo-guard 失败：未安装 Node.js。" >&2',
    '  exit 1',
    'fi',
    '',
    `repo_guard_cli="$repo_root/${packageCliPath(packageName)}"`,
    'if [ ! -f "$repo_guard_cli" ]; then',
    '  echo "repo-guard 失败：未安装依赖包。请运行 npm install。" >&2',
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
      throw securityError('hooks/non-managed-hook', `拒绝覆盖非托管 Git Hook： ${target}`, {
        decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
      });
    }
  }

  writeFileSync(target, content, 'utf8');
  chmodSync(target, 0o755);
}

function ensurePackageScripts(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError('hooks/missing-package-manifest', '仓库根目录中未找到 package.json', {
      details: { location: { path: 'package.json' } },
    });
  }

  const packageJson = JSON.parse(readFileSync(target, 'utf8'));
  packageJson.scripts ||= {};
  packageJson.scripts['guard:init'] ||= 'repo-guard init';
  packageJson.scripts['guard:migrate'] ||= 'repo-guard migrate';
  packageJson.scripts['guard:enable-dependencies'] ||= 'repo-guard enable dependencies';
  for (const gate of gateRegistry.all) {
    if (gate.packageScript && gate.manualCommand) {
      packageJson.scripts[gate.packageScript] ||= `repo-guard ${gate.manualCommand}`;
    }
  }
  packageJson.scripts['guard:enable-accessibility-test'] ||= 'repo-guard enable accessibilityTest';
  packageJson.scripts['guard:enable-quality'] ||= 'repo-guard enable eslint prettier';
  packageJson.scripts['guard:enable-architecture'] ||= 'repo-guard enable architecture';
  packageJson.scripts['guard:enable-stylelint'] ||= 'repo-guard enable stylelint';
  packageJson.scripts['guard:enable-style-complexity'] ||= 'repo-guard enable styleComplexity';
  packageJson.scripts['guard:enable-style-governance'] ||= 'repo-guard enable styleGovernance';
  packageJson.scripts['guard:enable-build'] ||= 'repo-guard enable build';
  packageJson.scripts['guard:enable-lighthouse'] ||= 'repo-guard enable lighthouse';
  packageJson.scripts['guard:enable-typecheck'] ||= 'repo-guard enable typeCheck';
  packageJson.scripts['guard:enable-unit-test'] ||= 'repo-guard enable unitTest';
  packageJson.scripts['guard:enable-notification'] ||= 'repo-guard enable notification';
  packageJson.scripts['guard:disable-notification'] ||= 'repo-guard disable notification';
  packageJson.scripts['guard:doctor'] ||= 'repo-guard doctor';
  packageJson.scripts['guard:check'] ||= 'repo-guard check';
  packageJson.scripts['guard:dry-run'] ||= 'repo-guard dry-run';
  packageJson.scripts['guard:ci'] ||= 'repo-guard ci';
  packageJson.scripts['guard:doctor-ci'] ||= 'repo-guard doctor --ci';
  packageJson.scripts['guard:install-ci'] ||= 'repo-guard install-ci --provider gitlab';

  if (!packageJson.scripts.prepare) {
    packageJson.scripts.prepare = 'repo-guard install-hooks';
  } else if (!packageJson.scripts.prepare.includes('repo-guard install-hooks')) {
    writeConsoleMessage(
      'repo-guard 警告：package.json 已存在 prepare 脚本；'
      + '请手动向其中添加 "repo-guard install-hooks"。',
      'stderr',
    );
  }

  writeFileSync(target, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

export function installHooks({
  cwd = process.cwd(),
  updatePackageScripts = false,
  allowMissingGit = false,
  env = process.env,
} = {}) {
  if (env.REPO_GUARD_SKIP_HOOKS === '1') {
    writeConsoleMessage('repo-guard：REPO_GUARD_SKIP_HOOKS=1，已跳过 Hook 安装。');
    return { skipped: true, root: null };
  }
  const root = findRepositoryRoot(cwd, { allowMissing: allowMissingGit });
  if (!root) {
    writeConsoleMessage('repo-guard：未检测到 Git 仓库，已跳过 Hook 安装。');
    return { skipped: true, root: null };
  }

  const configuredHooksPath = gitValue(['config', '--local', '--get', 'core.hooksPath'], '', root);
  if (configuredHooksPath && configuredHooksPath !== HOOKS_DIRECTORY) {
    throw securityError(
      'hooks/existing-hooks-path',
      `core.hooksPath 已配置为 "${configuredHooksPath}"; `
      + `拒绝将其替换为 "${HOOKS_DIRECTORY}"`,
      { decision: { aiAction: 'request-human-review', humanApprovalRequired: true } },
    );
  }

  const hooksPath = path.join(root, HOOKS_DIRECTORY);

  for (const hookName of Object.keys(HOOK_COMMANDS)) {
    const target = path.join(hooksPath, hookName);
    if (existsSync(target) && !isManagedHook(readFileSync(target, 'utf8'))) {
      throw securityError('hooks/non-managed-hook', `拒绝覆盖非托管 Git Hook： ${target}`, {
        decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
      });
    }
  }

  const packageName = loadPackageName();
  mkdirSync(hooksPath, { recursive: true });

  for (const [hookName, argumentsList] of Object.entries(HOOK_COMMANDS)) {
    ensureManagedFile(
      path.join(hooksPath, hookName),
      createHookContent(argumentsList, packageName),
    );
  }

  const gitAttributes = ensureGitAttributes(root);
  const localEnvironment = ensureLocalEnvironment(root);
  let coverageDirectory = DEFAULT_UNIT_TEST_COVERAGE_CONFIG.reportsDirectory;
  try {
    const coverage = loadConfig(root).unitTest.coverage;
    if (coverage && typeof coverage === 'object') {
      coverageDirectory = coverage.reportsDirectory;
    }
  } catch {
    // Hook installation also supports repositories before repo-guard config exists.
  }
  const lighthouseIgnore = ensureLighthouseIgnore(root, coverageDirectory);
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
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.trim());
  return lines.includes(MANAGED_MARKER)
    || LEGACY_MANAGED_MARKERS.some((marker) => lines.includes(marker));
}

export function isCurrentManagedHook(content) {
  return String(content).replace(/\r\n?/g, '\n').split('\n')
    .some((line) => line.trim() === MANAGED_MARKER);
}

export const managedHookNames = Object.freeze(Object.keys(HOOK_COMMANDS));
