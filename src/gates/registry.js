import { createGateRegistry } from '../core/capability/gate-registry.js';
import { vueAccessibilityGates } from './accessibility/vue-policy-gates.js';
import {
  architectureGate,
  buildGate,
  deadCodeGate,
  lighthouseGate,
  typecheckGate,
} from './quality/project-quality-gates.js';
import {
  eslintGate,
  prettierGate,
  styleComplexityGate,
  styleGovernanceGate,
  stylelintGate,
} from './quality/staged-quality-gates.js';
import { dynamicCodeGate } from './security/dynamic-code-gate.js';
import { vueAsyncResourceCleanupGate } from './quality/vue-async-resource-cleanup-gate.js';
import { uiTokenGate } from './quality/ui-token-gate.js';
import { pathNamingGate } from './repository/path-naming-gate.js';
import { imageAssetsGate } from './repository/image-assets-gate.js';
import { unusedImageAssetsGate } from './repository/unused-image-assets-gate.js';
import { repositoryPolicyGates } from './repository/repository-policy-gates.js';
import { releaseReadinessGates } from './release/release-readiness-gates.js';
import { defineExternalGate } from './testing/external-gate.js';
import { accessibilityTestGate, unitTestGate } from './testing/platform-test-gates.js';
import { mutationTestGate } from './testing/mutation-test-platform-gate.js';
import { vueSecurityGates } from './security/vue-policy-gates.js';

const nativePolicyGates = Object.freeze([
  ...vueSecurityGates,
  ...vueAccessibilityGates,
  ...repositoryPolicyGates,
]);

const platformGates = Object.freeze([
  stylelintGate,
  eslintGate,
  prettierGate,
  typecheckGate,
  unitTestGate,
  mutationTestGate,
  accessibilityTestGate,
  architectureGate,
  deadCodeGate,
  buildGate,
  lighthouseGate,
  styleComplexityGate,
  styleGovernanceGate,
]);

export const officialGates = Object.freeze([
  vueAsyncResourceCleanupGate,
  uiTokenGate,
  pathNamingGate,
  imageAssetsGate,
  unusedImageAssetsGate,
  dynamicCodeGate,
  ...nativePolicyGates,
  ...releaseReadinessGates,
  ...platformGates,
]);

export const gateRegistry = createGateRegistry(officialGates);

export function createProjectGateRegistry(config) {
  return createGateRegistry([
    ...officialGates,
    ...config.externalGates.map(defineExternalGate),
  ]);
}
