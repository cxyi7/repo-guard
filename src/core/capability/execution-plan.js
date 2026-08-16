import { internalError } from '../error/repo-guard-error.js';

const PLAN_ENVIRONMENTS = [
  'manual',
  'pre-commit',
  'pre-push',
  'ci-policy',
  'ci-full',
  'release-ready',
];
const MUTATIONS = ['read-only', 'working-tree-fix', 'managed-files', 'external-write'];
const ALLOWED_MUTATIONS = Object.freeze({
  manual: MUTATIONS,
  'pre-commit': MUTATIONS,
  'pre-push': ['read-only'],
  'ci-policy': ['read-only'],
  'ci-full': ['read-only'],
  'release-ready': ['read-only'],
});

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} 必须是非空字符串`);
  }
  return value;
}

function normalizeStep(step) {
  if (typeof step === 'string') {
    return Object.freeze({
      id: nonEmptyString(step, '执行计划步骤'),
      gateId: step,
      mutation: null,
    });
  }
  if (!step || typeof step !== 'object') {
    throw new TypeError('执行计划步骤必须是门禁 id 或步骤定义');
  }
  return Object.freeze({
    id: nonEmptyString(step.id, '执行计划步骤 id'),
    gateId: nonEmptyString(step.gateId, '执行计划步骤 gateId'),
    mutation: step.mutation == null ? null : nonEmptyString(
      step.mutation,
      '执行计划步骤 mutation',
    ),
    ...(step.reportName == null ? {} : {
      reportName: nonEmptyString(step.reportName, '执行计划步骤 reportName'),
    }),
  });
}

export function defineExecutionPlan({ id, environment, locked = true, steps }) {
  nonEmptyString(id, '执行计划 id');
  if (!PLAN_ENVIRONMENTS.includes(environment)) {
    throw new TypeError(`执行计划使用了不支持的环境： ${environment}`);
  }
  if (typeof locked !== 'boolean') throw new TypeError('执行计划的 locked 必须是布尔值');
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('执行计划的 steps 必须是非空数组');
  }
  const normalizedSteps = steps.map(normalizeStep);
  const stepIds = normalizedSteps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw internalError('capability/invalid-execution-plan', `执行计划 ${id} 包含重复的步骤 id`);
  }
  return Object.freeze({
    id,
    environment,
    locked,
    steps: Object.freeze(normalizedSteps),
  });
}

export function validateExecutionPlan(plan, registry) {
  // Relations describe the first activation of a capability. A reviewed plan may
  // intentionally invoke the same capability again for a later read-only verify step.
  const firstPositions = new Map();
  for (const [index, step] of plan.steps.entries()) {
    const gate = registry.get(step.gateId);
    if (!gate.environments.includes(plan.environment)) {
      throw internalError('capability/invalid-execution-plan',
        `执行计划 ${plan.id} 在不支持的环境中使用了 ${gate.id}：`
        + plan.environment,
      );
    }
    const mutation = step.mutation ?? gate.mutation;
    if (!MUTATIONS.includes(mutation)) {
      throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 使用了不支持的变更级别 ${mutation}`);
    }
    if (!gate.allowedMutations.includes(mutation)) {
      throw internalError('capability/invalid-execution-plan',
        `执行计划 ${plan.id} 不能将 ${step.id} 的变更级别改为 ${mutation}；`
        + `${gate.id} 只允许 ${gate.allowedMutations.join(', ')}`,
      );
    }
    if (!ALLOWED_MUTATIONS[plan.environment].includes(mutation)) {
      throw internalError('capability/invalid-execution-plan',
        `执行计划 ${plan.id} 不能在以下环境中以 ${mutation} 运行 ${step.id}：`
        + plan.environment,
      );
    }
    if (!firstPositions.has(gate.id)) firstPositions.set(gate.id, index);
  }
  for (const step of plan.steps) {
    const gate = registry.get(step.gateId);
    for (const dependency of gate.requires) {
      const dependencyPosition = firstPositions.get(dependency);
      if (dependencyPosition == null) {
        throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 遗漏了 ${gate.id} 的依赖 ${dependency}`);
      }
      if (dependencyPosition >= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 在依赖 ${dependency} 之前运行了 ${gate.id}`);
      }
    }
    for (const predecessor of gate.after) {
      const predecessorPosition = firstPositions.get(predecessor);
      if (predecessorPosition != null && predecessorPosition >= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 在前置门禁 ${predecessor} 之前运行了 ${gate.id}`);
      }
    }
    for (const successor of gate.before) {
      const successorPosition = firstPositions.get(successor);
      if (successorPosition != null && successorPosition <= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 在后置门禁 ${successor} 之后运行了 ${gate.id}`);
      }
    }
    for (const conflict of gate.conflicts) {
      if (firstPositions.has(conflict)) {
        throw internalError('capability/invalid-execution-plan', `执行计划 ${plan.id} 同时包含冲突门禁 ${gate.id} 和 ${conflict}`);
      }
    }
  }
  return plan;
}

export function createExecutionPlanRegistry(plans, gateRegistry) {
  if (!Array.isArray(plans)) throw new TypeError('执行计划集合必须是数组');
  const byId = new Map();
  for (const plan of plans) {
    if (byId.has(plan.id)) throw internalError('capability/invalid-execution-plan', `执行计划 id 重复： ${plan.id}`);
    validateExecutionPlan(plan, gateRegistry);
    byId.set(plan.id, plan);
  }
  return Object.freeze({
    all: Object.freeze([...plans]),
    get(id) {
      const plan = byId.get(id);
      if (!plan) throw internalError('capability/invalid-execution-plan', `未知的执行计划： ${id}`);
      return plan;
    },
  });
}
