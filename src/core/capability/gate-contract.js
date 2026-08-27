export const GATE_ENVIRONMENTS = Object.freeze([
  'manual',
  'pre-commit',
  'pre-push',
  'ci-policy',
  'ci-full',
  'release-ready',
]);

export const CI_GATE_ENVIRONMENTS = Object.freeze([
  'ci-policy',
  'ci-full',
  'release-ready',
]);

export const GATE_MUTATIONS = Object.freeze([
  'read-only',
  'working-tree-fix',
  'managed-files',
  'external-write',
]);
