import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ensureAccessibilityTestPolicy,
} from '../accessibility-test-policy.js';
import {
  ARCHITECTURE_POLICY_FILE,
  ensureArchitecturePolicy,
} from '../architecture-policy.js';
import { loadConfig } from '../config.js';
import {
  ensureExceptionPolicy,
  EXCEPTION_POLICY_FILE,
  isExceptionPolicyCurrent,
} from '../exception-policy.js';
import {
  formatExceptionRegistryReport,
  inspectExceptionRegistry,
} from '../exception-registry.js';
import {
  ensureProjectConfig,
  migrateProjectConfig,
} from '../config-management.js';
import { findRepositoryRoot, gitValue } from '../git.js';
import { inspectGitLabCi } from '../gitlab-ci.js';
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
  ensureUnitTestPolicy,
  UNIT_TEST_POLICY_FILE,
} from '../unit-test-policy.js';
import { gateRegistry } from '../gates/registry.js';

const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
export const REQUIRED_NODE_RANGE = PACKAGE_JSON.engines.node;

function parseNodeVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

export function nodeVersionIsSupported(
  version = process.versions.node,
  requiredRange = REQUIRED_NODE_RANGE,
) {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(String(requiredRange).replace(/^>=/, ''));
  if (!current || !minimum || !String(requiredRange).startsWith('>=')) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] !== minimum[index]) return current[index] > minimum[index];
  }
  return true;
}

function repairRepository(root) {
  const repairs = [];
  const repairErrors = [];

  try {
    const { created } = ensureProjectConfig(root);
    if (created) {
      repairs.push('created repo-guard.config.json');
      const config = loadConfig(root, { allowExpiredExceptions: true });
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
    } else {
      const { changed, config } = migrateProjectConfig(root, {
        allowExpiredExceptions: true,
      });
      repairs.push(
        changed
          ? 'migrated repo-guard.config.json'
          : 'repo-guard.config.json is already current',
      );
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
      if (config.unitTest.enabled) {
        const policy = ensureUnitTestPolicy(root, config.unitTest);
        repairs.push(
          policy.changed
            ? `updated ${UNIT_TEST_POLICY_FILE} unit test policy`
            : `${UNIT_TEST_POLICY_FILE} unit test policy is already current`,
        );
      }
      if (config.accessibilityTest.enabled) {
        const policy = ensureAccessibilityTestPolicy(root, config.accessibilityTest);
        repairs.push(
          policy.changed
            ? `updated ${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy`
            : `${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy is already current`,
        );
      }
      if (config.architecture.enabled) {
        const policy = ensureArchitecturePolicy(root, config.architecture);
        repairs.push(
          policy.changed
            ? `updated ${ARCHITECTURE_POLICY_FILE} architecture policy`
            : `${ARCHITECTURE_POLICY_FILE} architecture policy is already current`,
        );
      }
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

export async function runDoctor(cwd = process.cwd(), { fix = false, ci = false } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);
  if (fix && ci) throw new Error('doctor --fix and --ci cannot be combined');
  const repairResult = fix
    ? repairRepository(root)
    : { repairErrors: [], repairs: [] };

  errors.push(...repairResult.repairErrors);

  if (nodeVersionIsSupported()) {
    checks.push(`Node.js ${process.versions.node}`);
  } else {
    errors.push(
      `Node.js ${process.versions.node} is unsupported; expected ${REQUIRED_NODE_RANGE}`,
    );
  }

  let config;
  try {
    config = loadConfig(root, { allowExpiredExceptions: true });
    checks.push(`configuration (${config.rules.length} rules, ${config.exclusions.length} exclusions)`);
  } catch (error) {
    errors.push(error.message);
  }

  if (config) {
    const exceptionResult = inspectExceptionRegistry(config.exceptions);
    const policyPath = path.join(root, EXCEPTION_POLICY_FILE);
    if (!existsSync(policyPath)
      || !isExceptionPolicyCurrent(readFileSync(policyPath, 'utf8'), config.exceptions)) {
      errors.push(
        `${EXCEPTION_POLICY_FILE} is missing the repo-guard structured exception policy; `
        + 'run repo-guard doctor --fix',
      );
    } else {
      checks.push(`${EXCEPTION_POLICY_FILE} structured exception policy`);
    }
    if (exceptionResult.expired.length > 0 || exceptionResult.future.length > 0) {
      errors.push(formatExceptionRegistryReport(exceptionResult));
    } else {
      checks.push(
        `Structured exceptions (${exceptionResult.entries.length} total, `
        + `${exceptionResult.active.length} active, `
        + `${exceptionResult.expiring.length} expiring)`,
      );
    }
    if (exceptionResult.expiring.length > 0
      && exceptionResult.expired.length === 0
      && exceptionResult.future.length === 0) {
      warnings.push(formatExceptionRegistryReport(exceptionResult));
    }
  }

  if (!ci) {
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
  }

  const hasNotifyRules = config?.rules.some(({ level }) => level === 'notify') ?? false;
  const notificationRequired = config?.notification.enabled && hasNotifyRules;
  if (!ci) {
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
  } else if (config) {
    checks.push('CI mode does not require local Git hooks or WeCom credentials');
    const ciInspection = inspectGitLabCi(root, config);
    if (ciInspection.problems.length > 0) errors.push(...ciInspection.problems);
    else checks.push(`GitLab CI integration (${config.ci.profile} profile)`);
  }

  if (config) {
    const doctorGates = gateRegistry.all
      .filter(({ doctorOrder }) => doctorOrder != null)
      .sort((left, right) => left.doctorOrder - right.doctorOrder);
    for (const gate of doctorGates) {
      try {
        const setup = await gate.inspectSetup({ root, config });
        if (setup == null) continue;
        if (setup.status === 'ready') checks.push(setup.summary);
        else errors.push(`${gate.id} setup is ${setup.status}: ${setup.summary}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  console.log(`repo-guard doctor: ${root}`);
  for (const repair of repairResult.repairs) {
    console.log(`  FIX   ${repair}`);
  }
  for (const check of checks) {
    console.log(`  OK    ${check}`);
  }
  for (const warning of warnings) {
    console.warn(`  WARN  ${warning}`);
  }
  for (const error of errors) {
    console.error(`  ERROR ${error}`);
  }

  return errors.length === 0 ? 0 : 1;
}
