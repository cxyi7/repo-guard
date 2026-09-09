import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadWorkspace } from '../../config/configuration-loader.js';
import { createChangeSet } from '../../core/capability/gate-context.js';
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
import { gateAppliesToProject } from '../../gates/project-applicability.js';
import { gitValue } from '../../git/execution.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { inspectExceptionLifecycle } from '../../config/exception-lifecycle.js';
import {
  getLocalEnvironmentGitStatus,
  LOCAL_ENV_FILE,
  resolveNotificationEnvironment,
} from '../../policies/local-environment.js';
import {
  AGENT_POLICY_FILE,
  inspectAgentPolicies,
} from '../../policies/agent-policies.js';
import { loadNotificationConfig } from '../../policies/wecom-notification.js';
import { inspectGitLabCi } from '../setup/gitlab-ci.js';
import { validateCiGatePolicy } from '../ci/gate-policy.js';
import {
  isCurrentManagedHook,
  isManagedHook,
  managedHookNames,
  guardedBuildCommand,
} from '../setup/hook-installer.js';
import { repairRepository } from '../setup/repository-repair.js';
import { inspectDeliverySkills } from '../setup/delivery-skills.js';
import { createWorkspaceTargets, selectProjects, workspaceAgentPolicyTargets, workspaceStepTargets } from '../workspace/targets.js';
import { loadOperationsConfig } from '../../operations/config/configuration.js';
import { inspectOperationsGitLabPipeline } from '../../operations/gitlab/installation.js';

function renderDoctorResult(root, repairResult, { checks, errors, warnings }) {
  writeConsoleMessage(`repo-guard doctor 检查目录：${root}`);
  for (const repair of repairResult.repairs) writeConsoleMessage(`  已修复 ${repair}`);
  for (const check of checks) writeConsoleMessage(`  正常   ${check}`);
  for (const warning of warnings) writeConsoleMessage(`  警告   ${warning}`, 'stderr');
  for (const error of errors) writeConsoleMessage(`  错误 ${error}`, 'stderr');
  return errors.length === 0 ? 0 : 1;
}

function inspectBaseConfiguration(root, { checks, errors, warnings }, projectId) {
  if (nodeVersionIsSupported()) {
    checks.push(`Node.js 版本：${process.versions.node}`);
  } else {
    errors.push(`Node.js 版本：${process.versions.node} 不受支持；要求 ${REQUIRED_NODE_RANGE}`);
  }

  let workspace;
  try {
    workspace = loadWorkspace(root, { allowExpiredExceptions: true });
    selectProjects(workspace, projectId);
    checks.push(`配置（${workspace.projects.length} 个显式应用，${workspace.repositoryConfig.rules.length} 条仓库规则）`);
  } catch (error) {
    errors.push(error.message);
    return null;
  }
  if (!workspace) return null;
  const config = workspace.repositoryConfig;

  const exceptionResult = inspectExceptionLifecycle(config.exceptions);
  const policyTargets = workspaceAgentPolicyTargets(workspace, projectId);
  for (const target of policyTargets) {
    try {
      const agentPolicy = inspectAgentPolicies(target.root, target.config);
      if (agentPolicy.changed) {
        errors.push(`${target.label} ${AGENT_POLICY_FILE} 托管规范与配置不一致；请运行 repo-guard doctor --fix`);
      } else checks.push(`${target.label} ${AGENT_POLICY_FILE} 托管规范`);
    } catch (error) {
      errors.push(`${target.label}：${error.message}`);
    }
  }
  const deliverySkills = inspectDeliverySkills(root, config.deliveryContract.enabled);
  if (deliverySkills.issues.length > 0) {
    errors.push(...deliverySkills.issues.map((message) => `${message}；请运行 repo-guard doctor --fix`));
  } else if (config.deliveryContract.enabled) {
    checks.push(`${deliverySkills.skills.length} 个交付流程 Skills`);
  } else {
    checks.push('交付流程 Skills 在功能禁用时未安装');
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
  if (
    exceptionResult.expiring.length > 0
    && exceptionResult.expired.length === 0
    && exceptionResult.future.length === 0
  ) {
    warnings.push(renderExceptionRegistrySummary(exceptionResult));
  }
  return workspace;
}

function inspectManagedHooks(root, { checks, errors }) {
  const initialErrors = errors.length;
  const hooksPath = gitValue(['config', '--local', '--get', 'core.hooksPath'], '', root);
  if (hooksPath === '.githooks') checks.push('Git Hook 路径：core.hooksPath=.githooks');
  else errors.push(`core.hooksPath 当前为“${hooksPath || '未配置'}”`);

  for (const hookName of managedHookNames) {
    const target = path.join(root, '.githooks', hookName);
    if (!existsSync(target)) {
      errors.push(`缺少 Git Hook： .githooks/${hookName}`);
      continue;
    }
    const source = readFileSync(target, 'utf8');
    if (!isManagedHook(source)) {
      errors.push(`Git Hook 未由 repo-guard 托管： .githooks/${hookName}`);
      continue;
    }
    if (!isCurrentManagedHook(source)) {
      errors.push(`Git Hook 已过期： .githooks/${hookName}；请运行 repo-guard install-hooks`);
    }
  }
  if (errors.length === initialErrors) {
    checks.push(`${managedHookNames.length} 个托管 Git Hook`);
  }
}

export async function runDoctor(cwd = process.cwd(), { fix = false, ci = false, projectId } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);
  if (fix && ci) throw configurationError('doctor/conflicting-options', 'doctor --fix 与 --ci 不能同时使用');
  const repairResult = fix
    ? repairRepository(root, { projectId })
    : { repairErrors: [], repairs: [] };

  errors.push(...repairResult.repairErrors);

  const workspace = inspectBaseConfiguration(root, { checks, errors, warnings }, projectId);
  const config = workspace?.repositoryConfig;

  if (!ci) inspectManagedHooks(root, { checks, errors });

  const hasNotifyRules = config?.rules.some(({ level }) => level === 'notify') ?? false;
  const hasMutationFailureNotification = workspace?.projects.some(({ config: appConfig }) => appConfig.mutationTest.enabled
    && appConfig.mutationTest.guardedBuilds.some(({ notifyOnFailure }) => notifyOnFailure));
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
    try {
      const operations = loadOperationsConfig(root);
      const ciInspection = operations.enabled
        ? inspectOperationsGitLabPipeline(root, operations, workspace.projects.map((application) => ({
          ...application.project, root: application.relativeRoot,
        }))) : inspectGitLabCi(root, config);
      if (ciInspection.problems.length > 0) errors.push(...ciInspection.problems);
      else checks.push(operations.enabled ? 'GitLab 独立运维集成' : `GitLab CI 集成（${config.ci.profile} 配置档）`);
    } catch (error) {
      errors.push(error.message);
    }
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

  if (workspace) {
    for (const application of selectProjects(workspace, projectId)) {
      inspectGuardedBuilds(application, root, { checks, errors });
    }
    const environment = ci && config.ci.profile === 'release-ready'
      ? 'release-ready' : ci ? `ci-${config.ci.profile}` : 'manual';
    const targets = createWorkspaceTargets({
      workspace, projectId, environment,
      changes: createChangeSet({ source: 'doctor', changes: [] }),
    });
    const doctorGates = createProjectGateRegistry(config).all
      .filter(({ doctorOrder }) => doctorOrder != null)
      .sort((left, right) => left.doctorOrder - right.doctorOrder);
    for (const gate of doctorGates) {
      for (const context of workspaceStepTargets(targets, { gateId: gate.id })) {
        if (gateAppliesToProject(gate.id, context.project)) {
          await inspectGate(gate, context, { checks, errors });
        }
      }
    }
    for (const context of targets.projects) {
      for (const externalGate of context.config.externalGates) {
        if (!externalGate.enabled) {
          checks.push(`应用 ${context.project.id} 外部门禁 ${externalGate.id} 已禁用`);
          continue;
        }
        const gate = createProjectGateRegistry(context.config).get(externalGate.id);
        await inspectGate(gate, {
          ...context,
          environment: gate.environments.includes(environment) ? environment : gate.environments[0],
        }, { checks, errors });
      }
    }
  }

  return renderDoctorResult(root, repairResult, { checks, errors, warnings });
}

async function inspectGate(gate, context, { checks, errors }) {
  const label = context.project?.id ? `应用 ${context.project.id}` : '仓库';
  try {
    const setup = await gate.inspectSetup(context);
    if (setup == null) return;
    if (setup.status === 'ready') checks.push(`${label}：${setup.summary}`);
    else errors.push(`${label} ${gate.id} 设置状态为 ${setup.status}：${setup.summary}`);
  } catch (error) {
    errors.push(`${label}：${error.message}`);
  }
}

function inspectGuardedBuilds(application, repositoryRoot, { checks, errors }) {
  if (application.config.mutationTest.guardedBuilds.length === 0) return;
  try {
    const packageJson = JSON.parse(readFileSync(path.join(application.root, 'package.json'), 'utf8'));
    for (const guardedBuild of application.config.mutationTest.guardedBuilds) {
      const expected = guardedBuildCommand(guardedBuild.script, application, repositoryRoot);
      if (typeof packageJson.scripts?.[guardedBuild.script] !== 'string') {
        errors.push(`应用 ${application.id} 受保护构建找不到原始 npm 脚本：${guardedBuild.script}`);
      }
      if (packageJson.scripts?.[guardedBuild.packageScript] !== expected) {
        errors.push(`应用 ${application.id} 受保护构建脚本 ${guardedBuild.packageScript} 必须为 "${expected}"；请运行 repo-guard doctor --fix`);
      } else checks.push(`应用 ${application.id} 受保护构建：${guardedBuild.packageScript} → ${guardedBuild.script}`);
    }
  } catch (error) {
    errors.push(`应用 ${application.id} 无法检查受保护构建脚本：${error.message}`);
  }
}
