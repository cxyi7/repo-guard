import {
  CI_GATE_POLICY_MODES,
  CI_GATE_SCOPES,
} from '../../core/capability/gate-definition.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import {
  createGateResult,
  gateResultToExitCode,
} from '../../core/result/gate-result.js';

const BLOCKING_MODES = new Set(['inherit', 'enforce']);

function gatePolicyError(code, message) {
  return configurationError(`ci-gate-policy/${code}`, message, {
    expected: 'CI 门禁策略只能引用 Registry 中已声明的 CI Gate 及其支持的检查范围。',
    remediation: {
      goal: '修正 ci.gatePolicy，使每个门禁覆盖项都能由当前版本可靠执行。',
      steps: ['根据门禁 id、mode 和 scope 校验消息修正配置。'],
      constraints: ['不要通过改写执行顺序或提交门禁配置绕过 CI 策略。'],
      verification: ['运行 repo-guard doctor --ci，再重新运行 repo-guard ci。'],
    },
  });
}

function policyFor(config, gate) {
  const override = config.ci.gatePolicy.gates[gate.id];
  return Object.freeze({
    mode: override?.mode ?? config.ci.gatePolicy.defaultMode,
    scope: override?.scope ?? 'all-files',
  });
}

function activateAtPath(value, segments, index = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (index === segments.length) {
    if (!Object.hasOwn(value, 'enabled') || value.enabled === true) return value;
    return Object.freeze({ ...value, enabled: true });
  }
  const segment = segments[index];
  const nested = activateAtPath(value[segment], segments, index + 1);
  if (nested === value[segment]) return value;
  return Object.freeze({ ...value, [segment]: nested });
}

function activateGateConfig(config, gate) {
  if (gate.id.startsWith('project.')) {
    const externalGates = config.externalGates.map((entry) => (
      entry.id === gate.id && !entry.enabled
        ? Object.freeze({ ...entry, enabled: true })
        : entry
    ));
    return Object.freeze({
      ...config,
      externalGates: Object.freeze(externalGates),
    });
  }
  if (!gate.configKey) return config;
  return activateAtPath(config, gate.configKey.split('.'));
}

function relativeFile(file) {
  return typeof file === 'string' ? file : file.relative;
}

function changedFileSet(context) {
  const changed = new Set();
  for (const entry of context.changes.entries) {
    if (entry.path) changed.add(entry.path);
    if (entry.relative) changed.add(entry.relative);
  }
  return changed;
}

function validatePolicies(config, registry) {
  if (!CI_GATE_POLICY_MODES.includes(config.ci.gatePolicy.defaultMode)) {
    throw gatePolicyError('invalid-default-mode', 'ci.gatePolicy.defaultMode 无效');
  }
  const ciGates = new Map(registry.ci.map((gate) => [gate.id, gate]));
  for (const [gateId, policy] of Object.entries(config.ci.gatePolicy.gates)) {
    const gate = ciGates.get(gateId);
    if (!gate) {
      throw gatePolicyError('unknown-gate', `ci.gatePolicy 引用了未知或非 CI 门禁：${gateId}`);
    }
    if (!CI_GATE_POLICY_MODES.includes(policy.mode)) {
      throw gatePolicyError('invalid-mode', `CI 门禁 ${gateId} 的 mode 无效`);
    }
    if (!CI_GATE_SCOPES.includes(policy.scope) || !gate.ciScopes.includes(policy.scope)) {
      throw gatePolicyError(
        'unsupported-scope',
        `CI 门禁 ${gateId} 不支持 ${policy.scope}；支持范围为 ${gate.ciScopes.join('、')}`,
      );
    }
  }
}

function aggregateBlockingResults(results) {
  for (const status of ['execution-error', 'configuration-error', 'range-error']) {
    if (results.some((result) => result.status === status)) return status;
  }
  if (results.some(({ status }) => status === 'violation')) return 'violation';
  return 'passed';
}

function decisiveBlockingResult(results) {
  return results.find(({ status }) => status === 'execution-error')
    ?? results.find(({ status }) => status === 'configuration-error')
    ?? results.find(({ status }) => status === 'range-error')
    ?? results.find(({ status }) => status === 'violation')
    ?? null;
}

export function validateCiGatePolicy(config, registry) {
  validatePolicies(config, registry);
  return config.ci.gatePolicy;
}

export function createCiGatePolicyController({ config, registry, plan }) {
  validatePolicies(config, registry);
  const policies = new Map(plan.steps.map((step) => {
    const gate = registry.get(step.gateId);
    const policy = policyFor(config, gate);
    if (!gate.ciScopes.includes(policy.scope)) {
      throw gatePolicyError(
        'unsupported-scope',
        `CI 门禁 ${gate.id} 不支持 ${policy.scope}；支持范围为 ${gate.ciScopes.join('、')}`,
      );
    }
    return [step.id, policy];
  }));

  const get = (step) => policies.get(step.id);
  const prepareStepContext = ({ context, gate, step }) => {
    const policy = get(step);
    const changed = policy.scope === 'changed-files' ? changedFileSet(context) : null;
    const files = policy.scope === 'changed-files'
      ? Object.freeze(context.files.filter((file) => changed.has(relativeFile(file))))
      : context.files;
    const gateConfig = policy.mode === 'report' || policy.mode === 'enforce'
      ? activateGateConfig(context.config, gate)
      : context.config;
    return Object.freeze({
      ...context,
      config: gateConfig,
      files,
      ciGatePolicy: Object.freeze({
        mode: policy.mode,
        scope: policy.scope,
        blocking: BLOCKING_MODES.has(policy.mode),
      }),
    });
  };
  const beforeStep = ({ gate, step }) => {
    const policy = get(step);
    if (policy.mode !== 'off') return null;
    return createGateResult({
      gateId: gate.id,
      status: 'skipped',
      summary: `${gate.id} 已由 ci.gatePolicy 关闭`,
    });
  };
  const describe = (step) => {
    const policy = get(step);
    return Object.freeze({
      mode: policy.mode,
      scope: policy.scope,
      blocking: BLOCKING_MODES.has(policy.mode),
    });
  };
  const evaluate = (execution) => {
    const results = execution.results.filter((result, index) => (
      BLOCKING_MODES.has(get(plan.steps[index]).mode)
    ));
    const decisiveResult = decisiveBlockingResult(results);
    return Object.freeze({
      ...execution,
      status: aggregateBlockingResults(results),
      decisiveResult,
      exitCode: decisiveResult == null ? 0 : gateResultToExitCode(decisiveResult),
    });
  };
  return Object.freeze({
    beforeStep,
    describe,
    evaluate,
    get,
    prepareStepContext,
  });
}
