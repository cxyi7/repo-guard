import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { resolveProjectEslintMetadata } from '../eslint-runner.js';
import { findRepositoryRoot, gitValue } from '../git.js';
import {
  isCurrentManagedHook,
  isManagedHook,
  managedHookNames,
} from '../hook-installer.js';
import {
  getLocalEnvironmentGitStatus,
  LOCAL_ENV_FILE,
  resolveNotificationEnvironment,
} from '../local-env.js';
import { loadNotificationConfig } from '../wecom.js';

function nodeVersionIsSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 18 || (major === 18 && minor >= 12);
}

export function runDoctor(cwd = process.cwd()) {
  const errors = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);

  if (nodeVersionIsSupported()) {
    checks.push(`Node.js ${process.versions.node}`);
  } else {
    errors.push(`Node.js ${process.versions.node} is unsupported; expected >=18.12.0`);
  }

  let config;
  try {
    config = loadConfig(root);
    checks.push(`configuration (${config.rules.length} rules, ${config.exclusions.length} exclusions)`);
  } catch (error) {
    errors.push(error.message);
  }

  const hooksPath = gitValue(['config', '--local', '--get', 'core.hooksPath'], '', root);
  if (hooksPath === '.githooks') {
    checks.push('core.hooksPath=.githooks');
  } else {
    errors.push(`core.hooksPath is "${hooksPath || 'not configured'}"`);
  }

  for (const hookName of managedHookNames) {
    const target = path.join(root, '.githooks', hookName);
    if (!existsSync(target)) {
      errors.push(`missing Git hook: .githooks/${hookName}`);
      continue;
    }
    if (!isManagedHook(readFileSync(target, 'utf8'))) {
      errors.push(`Git hook is not managed by repo-guard: .githooks/${hookName}`);
      continue;
    }
    if (!isCurrentManagedHook(readFileSync(target, 'utf8'))) {
      errors.push(`Git hook is outdated: .githooks/${hookName}; run repo-guard install-hooks`);
    }
  }
  if (errors.every((message) => !message.includes('Git hook'))) {
    checks.push(`${managedHookNames.length} managed Git hooks`);
  }

  const localEnvironmentPath = path.join(root, LOCAL_ENV_FILE);
  if (!existsSync(localEnvironmentPath)) {
    errors.push(`missing local notification template: ${LOCAL_ENV_FILE}; run repo-guard init`);
  } else {
    const { ignored, tracked } = getLocalEnvironmentGitStatus(root);
    if (tracked) {
      errors.push(
        `${LOCAL_ENV_FILE} is tracked by Git; run "git rm --cached -- ${LOCAL_ENV_FILE}"`,
      );
    } else if (!ignored) {
      errors.push(`${LOCAL_ENV_FILE} is not ignored by Git; run repo-guard init`);
    } else {
      checks.push(`${LOCAL_ENV_FILE} is local and ignored`);
    }
  }

  if (config?.rules.some(({ level }) => level === 'notify')) {
    try {
      loadNotificationConfig(resolveNotificationEnvironment(root));
      checks.push('WeCom notification configuration');
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (config?.preCommit.eslint.enabled) {
    try {
      const eslint = resolveProjectEslintMetadata(root);
      checks.push(
        `ESLint ${eslint.version} staged gate `
        + `(${config.preCommit.eslint.pattern}, fix=${config.preCommit.eslint.fix})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('ESLint staged gate is disabled');
  }

  console.log(`repo-guard doctor: ${root}`);
  for (const check of checks) {
    console.log(`  OK    ${check}`);
  }
  for (const error of errors) {
    console.error(`  ERROR ${error}`);
  }

  return errors.length === 0 ? 0 : 1;
}
