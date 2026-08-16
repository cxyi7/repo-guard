import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import {
  nodeVersionIsSupported,
  REQUIRED_NODE_RANGE,
} from '../../core/project/node-version.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import {
  renderExceptionRegistrySummary,
} from '../../core/report/exception-registry-renderer.js';
import { createProjectGateRegistry } from '../../gates/registry.js';
import { gitValue } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { inspectExceptionLifecycle } from '../../config/exception-lifecycle.js';
import {
  getLocalEnvironmentGitStatus,
  LOCAL_ENV_FILE,
  resolveNotificationEnvironment,
} from '../../policies/local-environment.js';
import {
  EXCEPTION_POLICY_FILE,
  isExceptionPolicyCurrent,
} from '../../policies/managed-policies.js';
import { loadNotificationConfig } from '../../policies/wecom-notification.js';
import { inspectGitLabCi } from '../setup/gitlab-ci.js';
import {
  isCurrentManagedHook,
  isManagedHook,
  managedHookNames,
} from '../setup/hook-installer.js';
import { repairRepository } from '../setup/repository-repair.js';

export async function runDoctor(cwd = process.cwd(), { fix = false, ci = false } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);
  if (fix && ci) throw configurationError('doctor/conflicting-options', 'doctor --fix and --ci cannot be combined');
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
    const exceptionResult = inspectExceptionLifecycle(config.exceptions);
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
      errors.push(renderExceptionRegistrySummary(exceptionResult));
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
      warnings.push(renderExceptionRegistrySummary(exceptionResult));
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
    const doctorGates = createProjectGateRegistry(config).all
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
    for (const externalGate of config.externalGates) {
      if (!externalGate.enabled) {
        checks.push(`External gate ${externalGate.id} is disabled`);
        continue;
      }
      try {
        const gate = createProjectGateRegistry(config).get(externalGate.id);
        const requestedEnvironment = ci && config.ci.profile === 'release-ready'
          ? 'release-ready'
          : ci ? `ci-${config.ci.profile}` : 'manual';
        const environment = gate.environments.includes(requestedEnvironment)
          ? requestedEnvironment
          : gate.environments[0];
        const setup = await gate.inspectSetup({ root, config, environment });
        if (setup.status === 'ready') checks.push(setup.summary);
        else errors.push(`${gate.id} setup is ${setup.status}: ${setup.summary}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  writeConsoleMessage(`repo-guard doctor: ${root}`);
  for (const repair of repairResult.repairs) {
    writeConsoleMessage(`  FIX   ${repair}`);
  }
  for (const check of checks) {
    writeConsoleMessage(`  OK    ${check}`);
  }
  for (const warning of warnings) {
    writeConsoleMessage(`  WARN  ${warning}`, 'stderr');
  }
  for (const error of errors) {
    writeConsoleMessage(`  ERROR ${error}`, 'stderr');
  }

  return errors.length === 0 ? 0 : 1;
}
