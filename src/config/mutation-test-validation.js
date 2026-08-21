import { DEFAULT_MUTATION_TEST_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizeRelativePattern,
} from './validation-primitives.js';

const NPM_SCRIPT_NAME = /^[A-Za-z0-9:_-]+$/;
const GUARDED_BUILD_SCRIPT_NAME = /^guard:build:[A-Za-z0-9:_-]+$/;

function npmScriptName(value, label) {
  if (typeof value !== 'string' || !NPM_SCRIPT_NAME.test(value.trim())) {
    throw configValidationError(`${label} 必须是 npm 脚本名称`);
  }
  return value.trim();
}

function normalizeReportsDirectory(value, label) {
  const normalized = normalizeRelativePattern(value, label).replace(/\/+$/, '');
  if (!normalized.startsWith('reports/') || normalized === 'reports') {
    throw configValidationError(`${label} 必须是 reports/ 内的专用目录`);
  }
  return normalized;
}

function normalizeGuardedBuilds(value, configPath) {
  if (!Array.isArray(value)) {
    throw configValidationError(`${configPath} mutationTest.guardedBuilds 必须是数组`);
  }
  const scripts = new Set();
  const packageScripts = new Set();
  return value.map((entry, index) => {
    const label = `${configPath} mutationTest.guardedBuilds 第 ${index + 1} 项`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(entry, new Set(['script', 'packageScript', 'timeoutMs', 'notifyOnFailure']), label);
    const script = npmScriptName(entry.script, `${label}.script`);
    const packageScript = npmScriptName(entry.packageScript, `${label}.packageScript`);
    if (script.startsWith('guard:build:')) {
      throw configValidationError(`${label}.script 不得指向其他受保护构建脚本`);
    }
    if (!GUARDED_BUILD_SCRIPT_NAME.test(packageScript)) {
      throw configValidationError(`${label}.packageScript 必须以 guard:build: 开头`);
    }
    if (script === packageScript) {
      throw configValidationError(`${label}.script 与 packageScript 不得相同`);
    }
    if (scripts.has(script)) throw configValidationError(`${label}.script 不得重复：${script}`);
    if (packageScripts.has(packageScript)) {
      throw configValidationError(`${label}.packageScript 不得重复：${packageScript}`);
    }
    if (entry.timeoutMs != null
      && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0)) {
      throw configValidationError(`${label}.timeoutMs 必须是正整数`);
    }
    if (entry.notifyOnFailure != null && typeof entry.notifyOnFailure !== 'boolean') {
      throw configValidationError(`${label}.notifyOnFailure 必须是布尔值`);
    }
    scripts.add(script);
    packageScripts.add(packageScript);
    return {
      script,
      packageScript,
      timeoutMs: entry.timeoutMs ?? 300000,
      notifyOnFailure: entry.notifyOnFailure ?? true,
    };
  });
}

export function validateMutationTestConfiguration(value, configPath) {
  const mutationValue = value.mutationTest ?? {};
  if (!mutationValue || typeof mutationValue !== 'object' || Array.isArray(mutationValue)) {
    throw configValidationError(`${configPath} mutationTest 必须是对象`);
  }
  assertKnownProperties(
    mutationValue,
    new Set([
      'enabled',
      'configFile',
      'timeoutMs',
      'reportsDirectory',
      'originalHtml',
      'guardedBuilds',
    ]),
    `${configPath} mutationTest`,
  );
  if (mutationValue.enabled != null && typeof mutationValue.enabled !== 'boolean') {
    throw configValidationError(`${configPath} mutationTest.enabled 必须是布尔值`);
  }
  if (mutationValue.timeoutMs != null
    && (!Number.isInteger(mutationValue.timeoutMs) || mutationValue.timeoutMs <= 0)) {
    throw configValidationError(`${configPath} mutationTest.timeoutMs 必须是正整数`);
  }
  if (mutationValue.originalHtml != null && typeof mutationValue.originalHtml !== 'boolean') {
    throw configValidationError(`${configPath} mutationTest.originalHtml 必须是布尔值`);
  }
  const configFile = normalizeRelativePattern(
    mutationValue.configFile ?? DEFAULT_MUTATION_TEST_CONFIG.configFile,
    `${configPath} mutationTest.configFile`,
  );
  if (!/\.(?:cjs|mjs|js|json)$/i.test(configFile)) {
    throw configValidationError(`${configPath} mutationTest.configFile 必须是 JS 或 JSON 配置文件`);
  }
  return {
    enabled: mutationValue.enabled ?? DEFAULT_MUTATION_TEST_CONFIG.enabled,
    configFile,
    timeoutMs: mutationValue.timeoutMs ?? DEFAULT_MUTATION_TEST_CONFIG.timeoutMs,
    reportsDirectory: normalizeReportsDirectory(
      mutationValue.reportsDirectory ?? DEFAULT_MUTATION_TEST_CONFIG.reportsDirectory,
      `${configPath} mutationTest.reportsDirectory`,
    ),
    originalHtml: mutationValue.originalHtml ?? DEFAULT_MUTATION_TEST_CONFIG.originalHtml,
    guardedBuilds: normalizeGuardedBuilds(
      mutationValue.guardedBuilds ?? DEFAULT_MUTATION_TEST_CONFIG.guardedBuilds,
      configPath,
    ),
  };
}
