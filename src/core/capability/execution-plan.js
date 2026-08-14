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
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizeStep(step) {
  if (typeof step === 'string') {
    return Object.freeze({
      id: nonEmptyString(step, 'Execution plan step'),
      gateId: step,
      mutation: null,
    });
  }
  if (!step || typeof step !== 'object') {
    throw new TypeError('Execution plan step must be a gate id or step definition');
  }
  return Object.freeze({
    id: nonEmptyString(step.id, 'Execution plan step id'),
    gateId: nonEmptyString(step.gateId, 'Execution plan step gateId'),
    mutation: step.mutation == null ? null : nonEmptyString(
      step.mutation,
      'Execution plan step mutation',
    ),
  });
}

export function defineExecutionPlan({ id, environment, locked = true, steps }) {
  nonEmptyString(id, 'Execution plan id');
  if (!PLAN_ENVIRONMENTS.includes(environment)) {
    throw new TypeError(`Execution plan environment is unsupported: ${environment}`);
  }
  if (typeof locked !== 'boolean') throw new TypeError('Execution plan locked must be boolean');
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('Execution plan steps must be a non-empty array');
  }
  const normalizedSteps = steps.map(normalizeStep);
  const stepIds = normalizedSteps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw internalError('capability/invalid-execution-plan', `Execution plan ${id} contains duplicate step ids`);
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
        `Execution plan ${plan.id} uses ${gate.id} in unsupported environment `
        + plan.environment,
      );
    }
    const mutation = step.mutation ?? gate.mutation;
    if (!MUTATIONS.includes(mutation)) {
      throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} uses unsupported mutation ${mutation}`);
    }
    if (!gate.allowedMutations.includes(mutation)) {
      throw internalError('capability/invalid-execution-plan',
        `Execution plan ${plan.id} cannot relabel ${step.id} as ${mutation}; `
        + `${gate.id} allows ${gate.allowedMutations.join(', ')}`,
      );
    }
    if (!ALLOWED_MUTATIONS[plan.environment].includes(mutation)) {
      throw internalError('capability/invalid-execution-plan',
        `Execution plan ${plan.id} cannot run ${step.id} with ${mutation} in `
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
        throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} omits dependency ${dependency} for ${gate.id}`);
      }
      if (dependencyPosition >= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} runs ${gate.id} before ${dependency}`);
      }
    }
    for (const predecessor of gate.after) {
      const predecessorPosition = firstPositions.get(predecessor);
      if (predecessorPosition != null && predecessorPosition >= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} runs ${gate.id} before ${predecessor}`);
      }
    }
    for (const successor of gate.before) {
      const successorPosition = firstPositions.get(successor);
      if (successorPosition != null && successorPosition <= firstPositions.get(gate.id)) {
        throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} runs ${gate.id} after ${successor}`);
      }
    }
    for (const conflict of gate.conflicts) {
      if (firstPositions.has(conflict)) {
        throw internalError('capability/invalid-execution-plan', `Execution plan ${plan.id} contains conflicting gates ${gate.id} and ${conflict}`);
      }
    }
  }
  return plan;
}

export function createExecutionPlanRegistry(plans, gateRegistry) {
  if (!Array.isArray(plans)) throw new TypeError('Execution plans must be an array');
  const byId = new Map();
  for (const plan of plans) {
    if (byId.has(plan.id)) throw internalError('capability/invalid-execution-plan', `Duplicate execution plan id: ${plan.id}`);
    validateExecutionPlan(plan, gateRegistry);
    byId.set(plan.id, plan);
  }
  return Object.freeze({
    all: Object.freeze([...plans]),
    get(id) {
      const plan = byId.get(id);
      if (!plan) throw internalError('capability/invalid-execution-plan', `Unknown execution plan: ${id}`);
      return plan;
    },
  });
}
