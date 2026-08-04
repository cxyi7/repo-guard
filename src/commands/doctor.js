import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import {
  ensureProjectConfig,
  migrateProjectConfig,
} from '../config-management.js';
import { resolveProjectEslintMetadata } from '../eslint-runner.js';
import {
  resolveProjectPrettierConfigFile,
  resolveProjectPrettierMetadata,
} from '../prettier-runner.js';
import { findRepositoryRoot, gitValue } from '../git.js';
import {
  isCurrentManagedHook,
  isManagedHook,
  installHooks,
  managedHookNames,
} from '../hook-installer.js';
import {
  getLocalEnvironmentGitStatus,
  LOCAL_ENV_FILE,
  resolveNotificationEnvironment,
} from '../local-env.js';
import { loadNotificationConfig } from '../wecom.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../stylelint-project.js';

function nodeVersionIsSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 18 || (major === 18 && minor >= 12);
}

function repairRepository(root) {
  const repairs = [];
  const repairErrors = [];

  try {
    const { created } = ensureProjectConfig(root);
    if (created) {
      repairs.push('created repo-guard.config.json');
    } else {
      const { changed } = migrateProjectConfig(root);
      repairs.push(
        changed
          ? 'migrated repo-guard.config.json'
          : 'repo-guard.config.json is already current',
      );
    }
  } catch (error) {
    repairErrors.push(`configuration repair failed: ${error.message}`);
  }

  try {
    installHooks({ cwd: root, updatePackageScripts: true });
    repairs.push('reconciled managed hooks, repository files, and package scripts');
  } catch (error) {
    repairErrors.push(`installation repair failed: ${error.message}`);
  }

  return { repairErrors, repairs };
}

export async function runDoctor(cwd = process.cwd(), { fix = false } = {}) {
  const errors = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);
  const repairResult = fix
    ? repairRepository(root)
    : { repairErrors: [], repairs: [] };

  errors.push(...repairResult.repairErrors);

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

  const hasNotifyRules = config?.rules.some(({ level }) => level === 'notify') ?? false;
  const notificationRequired = config?.notification.enabled && hasNotifyRules;
  const localEnvironmentPath = path.join(root, LOCAL_ENV_FILE);
  if (!existsSync(localEnvironmentPath)) {
    if (notificationRequired) {
      errors.push(`missing local notification template: ${LOCAL_ENV_FILE}; run repo-guard init`);
    } else {
      checks.push(`${LOCAL_ENV_FILE} is not required by the current notification settings`);
    }
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

  if (config && !config.notification.enabled) {
    checks.push('WeCom notification is disabled');
  } else if (notificationRequired) {
    try {
      loadNotificationConfig(resolveNotificationEnvironment(root));
      checks.push('WeCom notification configuration');
    } catch (error) {
      errors.push(error.message);
    }
  } else if (config) {
    checks.push('WeCom notification is not required because no notify rules are configured');
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

  if (config?.preCommit.stylelint.enabled) {
    try {
      const stylelint = resolveProjectStylelintMetadata(root);
      const stylelintConfigFile = findProjectStylelintConfig(root);
      if (config.preCommit.stylelint.requireConfig && !stylelintConfigFile) {
        throw new Error('Stylelint staged gate requires a project Stylelint configuration file');
      }
      checks.push(
        `Stylelint ${stylelint.version} staged gate `
        + `(${config.preCommit.stylelint.pattern}, fix=${config.preCommit.stylelint.fix}, `
        + `config=${stylelintConfigFile || 'project config optional'})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Stylelint staged gate is disabled');
  }

  if (config?.preCommit.prettier.enabled) {
    try {
      const prettier = resolveProjectPrettierMetadata(root);
      let configDescription = 'project config optional';
      if (config.preCommit.prettier.requireConfig) {
        const prettierConfigFile = await resolveProjectPrettierConfigFile(root);
        if (!prettierConfigFile) {
          throw new Error('Prettier staged gate requires a project Prettier configuration file');
        }
        configDescription = path.relative(root, prettierConfigFile);
      }
      checks.push(
        `Prettier ${prettier.version} staged gate `
        + `(${config.preCommit.prettier.pattern}, fix=${config.preCommit.prettier.fix}, `
        + `config=${configDescription})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Prettier staged gate is disabled');
  }

  console.log(`repo-guard doctor: ${root}`);
  for (const repair of repairResult.repairs) {
    console.log(`  FIX   ${repair}`);
  }
  for (const check of checks) {
    console.log(`  OK    ${check}`);
  }
  for (const error of errors) {
    console.error(`  ERROR ${error}`);
  }

  return errors.length === 0 ? 0 : 1;
}
