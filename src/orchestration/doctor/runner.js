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
import { validateCiGatePolicy } from '../ci/gate-policy.js';
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
  if (fix && ci) throw configurationError('doctor/conflicting-options', 'doctor --fix 与 --ci 不能同时使用');
  const repairResult = fix
    ? repairRepository(root)
    : { repairErrors: [], repairs: [] };

  errors.push(...repairResult.repairErrors);

  if (nodeVersionIsSupported()) {
    checks.push(`Node.js 版本：${process.versions.node}`);
  } else {
    errors.push(
      `Node.js 版本：${process.versions.node} 不受支持；要求 ${REQUIRED_NODE_RANGE}`,
    );
  }

  let config;
  try {
    config = loadConfig(root, { allowExpiredExceptions: true });
    checks.push(`配置（${config.rules.length} 条规则，${config.exclusions.length} 条排除项）`);
  } catch (error) {
    errors.push(error.message);
  }

  if (config) {
    const exceptionResult = inspectExceptionLifecycle(config.exceptions);
    const policyPath = path.join(root, EXCEPTION_POLICY_FILE);
    if (!existsSync(policyPath)
      || !isExceptionPolicyCurrent(readFileSync(policyPath, 'utf8'), config.exceptions)) {
      errors.push(
        `${EXCEPTION_POLICY_FILE} 缺少 repo-guard 结构化例外策略；`
        + '请运行 repo-guard doctor --fix',
      );
    } else {
      checks.push(`${EXCEPTION_POLICY_FILE} 结构化例外策略`);
    }
    if (exceptionResult.expired.length > 0 || exceptionResult.future.length > 0) {
      errors.push(renderExceptionRegistrySummary(exceptionResult));
    } else {
      checks.push(
        `结构化例外（${exceptionResult.entries.length} 条，共计；`
        + `${exceptionResult.active.length} 条生效；`
        + `${exceptionResult.expiring.length} 条即将到期）`,
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
      checks.push('Git Hook 路径：core.hooksPath=.githooks');
    } else {
      errors.push(`core.hooksPath 当前为“${hooksPath || '未配置'}”`);
    }

    for (const hookName of managedHookNames) {
      const target = path.join(root, '.githooks', hookName);
      if (!existsSync(target)) {
        errors.push(`缺少 Git Hook： .githooks/${hookName}`);
        continue;
      }
      if (!isManagedHook(readFileSync(target, 'utf8'))) {
        errors.push(`Git Hook 未由 repo-guard 托管： .githooks/${hookName}`);
        continue;
      }
      if (!isCurrentManagedHook(readFileSync(target, 'utf8'))) {
        errors.push(`Git Hook 已过期： .githooks/${hookName}；请运行 repo-guard install-hooks`);
      }
    }
    if (errors.every((message) => !message.includes('Git hook'))) {
      checks.push(`${managedHookNames.length} 个托管 Git Hook`);
    }
  }

  const hasNotifyRules = config?.rules.some(({ level }) => level === 'notify') ?? false;
  const hasMutationFailureNotification = config?.mutationTest.enabled
    && config.mutationTest.guardedBuilds.some(({ notifyOnFailure }) => notifyOnFailure);
  const notificationRequired = config?.notification.enabled
    && (hasNotifyRules || hasMutationFailureNotification);
  if (!ci) {
    const localEnvironmentPath = path.join(root, LOCAL_ENV_FILE);
    if (!existsSync(localEnvironmentPath)) {
      if (notificationRequired) {
        errors.push(`缺少本地通知模板： ${LOCAL_ENV_FILE}；请运行 repo-guard init`);
      } else {
        checks.push(`${LOCAL_ENV_FILE} 在当前通知设置下不是必需的`);
      }
    } else {
      const { ignored, tracked } = getLocalEnvironmentGitStatus(root);
      if (tracked) {
        errors.push(
          `${LOCAL_ENV_FILE} 已被 Git 跟踪；请运行 "git rm --cached -- ${LOCAL_ENV_FILE}"`,
        );
      } else if (!ignored) {
        errors.push(`${LOCAL_ENV_FILE} 未被 Git 忽略；请运行 repo-guard init`);
      } else {
        checks.push(`${LOCAL_ENV_FILE} 是本地文件且已被忽略`);
      }
    }

    if (config && !config.notification.enabled) {
      checks.push('企业微信通知已禁用');
    } else if (notificationRequired) {
      try {
        loadNotificationConfig(resolveNotificationEnvironment(root));
        checks.push('企业微信通知配置');
      } catch (error) {
        errors.push(error.message);
      }
    } else if (config) {
      checks.push('未配置 notify 规则或变异测试失败通知，因此不需要企业微信通知');
    }
  } else if (config) {
    checks.push('CI 模式不需要本地 Git Hook 或企业微信凭据');
    const ciInspection = inspectGitLabCi(root, config);
    if (ciInspection.problems.length > 0) errors.push(...ciInspection.problems);
    else checks.push(`GitLab CI 集成（${config.ci.profile} 配置档）`);
    try {
      validateCiGatePolicy(config, createProjectGateRegistry(config));
      checks.push(
        `CI 门禁策略（默认模式=${config.ci.gatePolicy.defaultMode}，`
        + `${Object.keys(config.ci.gatePolicy.gates).length} 项覆盖）`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (config) {
    try {
      const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
      for (const guardedBuild of config.mutationTest.guardedBuilds) {
        const expected = `repo-guard guarded-build ${guardedBuild.script}`;
        if (typeof packageJson.scripts?.[guardedBuild.script] !== 'string') {
          errors.push(`受保护构建找不到原始 npm 脚本：${guardedBuild.script}`);
        }
        if (packageJson.scripts?.[guardedBuild.packageScript] !== expected) {
          errors.push(
            `受保护构建脚本 ${guardedBuild.packageScript} 必须为 "${expected}"；`
            + '请运行 repo-guard init',
          );
        } else {
          checks.push(`受保护构建：${guardedBuild.packageScript} → ${guardedBuild.script}`);
        }
      }
    } catch (error) {
      errors.push(`无法检查受保护构建脚本：${error.message}`);
    }
    const doctorGates = createProjectGateRegistry(config).all
      .filter(({ doctorOrder }) => doctorOrder != null)
      .sort((left, right) => left.doctorOrder - right.doctorOrder);
    for (const gate of doctorGates) {
      try {
        const setup = await gate.inspectSetup({ root, config });
        if (setup == null) continue;
        if (setup.status === 'ready') checks.push(setup.summary);
        else errors.push(`${gate.id} 设置状态为 ${setup.status}: ${setup.summary}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
    for (const externalGate of config.externalGates) {
      if (!externalGate.enabled) {
        checks.push(`外部门禁 ${externalGate.id} 已禁用`);
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
        else errors.push(`${gate.id} 设置状态为 ${setup.status}: ${setup.summary}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  writeConsoleMessage(`repo-guard doctor 检查目录：${root}`);
  for (const repair of repairResult.repairs) {
    writeConsoleMessage(`  已修复 ${repair}`);
  }
  for (const check of checks) {
    writeConsoleMessage(`  正常   ${check}`);
  }
  for (const warning of warnings) {
    writeConsoleMessage(`  警告   ${warning}`, 'stderr');
  }
  for (const error of errors) {
    writeConsoleMessage(`  错误 ${error}`, 'stderr');
  }

  return errors.length === 0 ? 0 : 1;
}
