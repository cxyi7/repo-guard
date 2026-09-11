export { gateAppliesToProject, JAVA_GATE_IDS } from '../profiles/gate-applicability.js';

export const REPOSITORY_GATE_IDS = new Set([
  'repository.agent-policy',
  'repository.commit-message',
  'repository.delivery-contract',
  'repository.global-file-placement',
  'repository.protected-files',
  'release.delivery-evidence',
]);

export const SHARED_AND_APPLICATION_GATE_IDS = new Set([
  'repository.agent-policy', 'repository.protected-files',
]);
