import {
  DEFAULT_CI_CONFIG,
  DEFAULT_CI_GATE_POLICY_CONFIG,
  DEFAULT_CI_PIPELINE_CONFIG,
} from './defaults.js';
import {
  CI_GATE_POLICY_MODES,
  CI_GATE_SCOPES,
} from '../core/capability/gate-definition.js';
import {
  assertKnownProperties,
  configValidationError,
  validateCiReportPath,
} from './validation-primitives.js';

function validatePipelineStage(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw configValidationError(`${label} 必须是规范的 GitLab CI stage 名称`);
  }
  return value;
}

function validatePipelineImage(value, label) {
  if (typeof value !== 'string'
    || value.length > 255
    || !/^[A-Za-z0-9](?:[A-Za-z0-9._/:@-]*[A-Za-z0-9])?$/.test(value)) {
    throw configValidationError(`${label} 必须是规范的容器镜像引用`);
  }
  return value;
}

function validatePipelineStringArray(value, label, pattern, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== 'string' || !pattern.test(item))
    || new Set(value).size !== value.length) {
    throw configValidationError(`${label} 必须是不重复的规范字符串数组`);
  }
  return [...value];
}

function validateManagedPipeline(value, configPath) {
  const pipelineValue = value === undefined ? {} : value;
  const label = `${configPath} ci.pipeline`;
  if (!pipelineValue || typeof pipelineValue !== 'object' || Array.isArray(pipelineValue)) {
    throw configValidationError(`${label} 必须是对象`);
  }
  assertKnownProperties(
    pipelineValue,
    new Set([
      'enabled',
      'verifyStage',
      'deployStage',
      'verifyImage',
      'deployImage',
      'testBranches',
      'productionBranches',
      'runnerTags',
      'legacyPeerDeps',
      'quickDeploy',
      'notifications',
    ]),
    label,
  );
  for (const property of ['enabled', 'legacyPeerDeps', 'quickDeploy', 'notifications']) {
    if (pipelineValue[property] != null && typeof pipelineValue[property] !== 'boolean') {
      throw configValidationError(`${label}.${property} 必须是布尔值`);
    }
  }
  const verifyStage = validatePipelineStage(
    pipelineValue.verifyStage ?? DEFAULT_CI_PIPELINE_CONFIG.verifyStage,
    `${label}.verifyStage`,
  );
  const deployStage = validatePipelineStage(
    pipelineValue.deployStage ?? DEFAULT_CI_PIPELINE_CONFIG.deployStage,
    `${label}.deployStage`,
  );
  if (verifyStage === deployStage) {
    throw configValidationError(`${label}.verifyStage 和 deployStage 必须使用不同阶段`);
  }
  const verifyImage = validatePipelineImage(
    pipelineValue.verifyImage ?? DEFAULT_CI_PIPELINE_CONFIG.verifyImage,
    `${label}.verifyImage`,
  );
  const deployImage = validatePipelineImage(
    pipelineValue.deployImage ?? DEFAULT_CI_PIPELINE_CONFIG.deployImage,
    `${label}.deployImage`,
  );
  const branchPattern = /^(?!\/)(?!.*\/\/)(?!.*\*.*\*)[A-Za-z0-9._/*-]+$/;
  const testBranches = validatePipelineStringArray(
    pipelineValue.testBranches ?? DEFAULT_CI_PIPELINE_CONFIG.testBranches,
    `${label}.testBranches`,
    branchPattern,
  );
  const productionBranches = validatePipelineStringArray(
    pipelineValue.productionBranches ?? DEFAULT_CI_PIPELINE_CONFIG.productionBranches,
    `${label}.productionBranches`,
    branchPattern,
    { allowEmpty: true },
  );
  const runnerTags = validatePipelineStringArray(
    pipelineValue.runnerTags ?? DEFAULT_CI_PIPELINE_CONFIG.runnerTags,
    `${label}.runnerTags`,
    /^[A-Za-z0-9_.:-]+$/,
    { allowEmpty: true },
  );
  return {
    enabled: pipelineValue.enabled ?? DEFAULT_CI_PIPELINE_CONFIG.enabled,
    verifyStage,
    deployStage,
    verifyImage,
    deployImage,
    testBranches,
    productionBranches,
    runnerTags,
    legacyPeerDeps: pipelineValue.legacyPeerDeps ?? DEFAULT_CI_PIPELINE_CONFIG.legacyPeerDeps,
    quickDeploy: pipelineValue.quickDeploy ?? DEFAULT_CI_PIPELINE_CONFIG.quickDeploy,
    notifications: pipelineValue.notifications ?? DEFAULT_CI_PIPELINE_CONFIG.notifications,
  };
}

export function validateCiConfiguration(value, configPath) {
  const ciValue = value.ci ?? {};
  if (!ciValue || typeof ciValue !== 'object' || Array.isArray(ciValue)) {
    throw configValidationError(`${configPath} ci 必须是对象`);
  }
  assertKnownProperties(
    ciValue,
    new Set(['enabled', 'profile', 'reportPath', 'protectedFiles', 'gatePolicy', 'pipeline']),
    `${configPath} ci`,
  );
  if (ciValue.enabled != null && typeof ciValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} ci.enabled 必须是布尔值`);
  }
  if (ciValue.profile != null && !['policy', 'full', 'release-ready'].includes(ciValue.profile)) {
    throw configValidationError(`${configPath} ci.profile 必须为 policy、full 或 release-ready`);
  }
  const ciReportPath = validateCiReportPath(
    ciValue.reportPath ?? DEFAULT_CI_CONFIG.reportPath,
    `${configPath} ci.reportPath`,
  );
  const ciProtectedFilesValue = ciValue.protectedFiles ?? {};
  if (!ciProtectedFilesValue || typeof ciProtectedFilesValue !== 'object'
    || Array.isArray(ciProtectedFilesValue)) {
    throw configValidationError(`${configPath} ci.protectedFiles 必须是对象`);
  }
  assertKnownProperties(
    ciProtectedFilesValue,
    new Set(['action']),
    `${configPath} ci.protectedFiles`,
  );
  const ciProtectedFilesAction = ciProtectedFilesValue.action
    ?? DEFAULT_CI_CONFIG.protectedFiles.action;
  if (!['report', 'fail'].includes(ciProtectedFilesAction)) {
    throw configValidationError(`${configPath} ci.protectedFiles.action 必须为 report 或 fail`);
  }
  const gatePolicyValue = ciValue.gatePolicy ?? {};
  if (!gatePolicyValue || typeof gatePolicyValue !== 'object'
    || Array.isArray(gatePolicyValue)) {
    throw configValidationError(`${configPath} ci.gatePolicy 必须是对象`);
  }
  assertKnownProperties(
    gatePolicyValue,
    new Set(['defaultMode', 'gates']),
    `${configPath} ci.gatePolicy`,
  );
  const defaultMode = gatePolicyValue.defaultMode
    ?? DEFAULT_CI_GATE_POLICY_CONFIG.defaultMode;
  if (!CI_GATE_POLICY_MODES.includes(defaultMode)) {
    throw configValidationError(
      `${configPath} ci.gatePolicy.defaultMode 必须为 inherit、off、report 或 enforce`,
    );
  }
  const gatePoliciesValue = gatePolicyValue.gates ?? {};
  if (!gatePoliciesValue || typeof gatePoliciesValue !== 'object'
    || Array.isArray(gatePoliciesValue)) {
    throw configValidationError(`${configPath} ci.gatePolicy.gates 必须是对象`);
  }
  const gatePolicies = {};
  for (const [gateId, policy] of Object.entries(gatePoliciesValue)) {
    const label = `${configPath} ci.gatePolicy.gates.${gateId}`;
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(gateId)) {
      throw configValidationError(`${label} 的门禁 id 必须使用点分隔的 kebab-case 命名`);
    }
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(policy, new Set(['mode', 'scope']), label);
    if (!Object.hasOwn(policy, 'mode')) {
      throw configValidationError(`${label}.mode 为必填项`);
    }
    if (!CI_GATE_POLICY_MODES.includes(policy.mode)) {
      throw configValidationError(`${label}.mode 必须为 inherit、off、report 或 enforce`);
    }
    const scope = policy.scope ?? 'all-files';
    if (!CI_GATE_SCOPES.includes(scope)) {
      throw configValidationError(`${label}.scope 必须为 all-files 或 changed-files`);
    }
    gatePolicies[gateId] = { mode: policy.mode, scope };
  }

  const externalGatesValue = value.externalGates ?? [];
  if (!Array.isArray(externalGatesValue)) {
    throw configValidationError(`${configPath} externalGates 必须是数组`);
  }
  const externalGateIds = new Set();
  const externalReportPaths = new Set();
  const externalGates = externalGatesValue.map((entry, index) => {
    const label = `${configPath} externalGates 第 ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(
      entry,
      new Set(['id', 'enabled', 'environments', 'script', 'timeoutMs', 'report']),
      label,
    );
    for (const field of ['id', 'enabled', 'environments', 'script', 'timeoutMs', 'report']) {
      if (!Object.hasOwn(entry, field)) throw configValidationError(`${label}.${field} 为必填项`);
    }
    if (typeof entry.id !== 'string' || !/^project\.[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw configValidationError(`${label}.id 必须使用 project.<kebab-case> 命名空间`);
    }
    if (externalGateIds.has(entry.id)) {
      throw configValidationError(`${configPath} 外部门禁 id 重复： ${entry.id}`);
    }
    externalGateIds.add(entry.id);
    if (typeof entry.enabled !== 'boolean') throw configValidationError(`${label}.enabled 必须是布尔值`);
    if (!Array.isArray(entry.environments) || entry.environments.length === 0
      || entry.environments.some((environment) => !['manual', 'ci-full', 'release-ready'].includes(environment))
      || new Set(entry.environments).size !== entry.environments.length) {
      throw configValidationError(`${label}.environments 只能包含不重复的 manual、ci-full 或 release-ready 值`);
    }
    if (typeof entry.script !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(entry.script)) {
      throw configValidationError(`${label}.script 必须是准确的 npm 脚本名称`);
    }
    if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1000 || entry.timeoutMs > 1800000) {
      throw configValidationError(`${label}.timeoutMs 必须介于 1000 到 1800000 之间`);
    }
    if (!entry.report || typeof entry.report !== 'object' || Array.isArray(entry.report)) {
      throw configValidationError(`${label}.report 必须是对象`);
    }
    assertKnownProperties(entry.report, new Set(['format', 'path']), `${label}.report`);
    if (entry.report.format !== 'repo-guard-json-v1') {
      throw configValidationError(`${label}.report.format 必须为 repo-guard-json-v1`);
    }
    const reportSegments = typeof entry.report.path === 'string'
      ? entry.report.path.split('/')
      : [];
    if (reportSegments[0] !== 'reports'
      || reportSegments.length < 2
      || reportSegments.some((segment) => (
        !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(segment)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      ))) {
      throw configValidationError(`${label}.report.path 必须使用 reports/ 内的规范化路径`);
    }
    const reportPath = validateCiReportPath(entry.report.path, `${label}.report.path`);
    const reportPathKey = reportPath.toLowerCase();
    if (externalReportPaths.has(reportPathKey)) {
      throw configValidationError(`${configPath} 外部门禁报告路径重复： ${reportPath}`);
    }
    externalReportPaths.add(reportPathKey);
    return {
      id: entry.id,
      enabled: entry.enabled,
      environments: [...entry.environments],
      script: entry.script,
      timeoutMs: entry.timeoutMs,
      report: { format: entry.report.format, path: reportPath },
    };
  });
  if (externalReportPaths.has(ciReportPath.toLowerCase())) {
    throw configValidationError(`${configPath} 外部门禁报告路径不能与 ci.reportPath 相同`);
  }

  return {
    ci: {
      enabled: ciValue.enabled ?? DEFAULT_CI_CONFIG.enabled,
      profile: ciValue.profile ?? DEFAULT_CI_CONFIG.profile,
      reportPath: ciReportPath,
      protectedFiles: { action: ciProtectedFilesAction },
      gatePolicy: { defaultMode, gates: gatePolicies },
      pipeline: validateManagedPipeline(ciValue.pipeline, configPath),
    },
    externalGates,
  };
}
