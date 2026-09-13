import { sourceSecurityGate } from './security/source-security-gate.js';
import { createGateRegistry } from '../core/capability/gate-registry.js';
import { functionDocumentationGate } from './quality/function-documentation-gate.js';
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
  stylelintGate,
} from './quality/staged-quality-gates.js';
import { vueAsyncResourceCleanupGate } from './quality/vue-async-resource-cleanup-gate.js';
import { uiTokenGate } from './quality/ui-token-gate.js';
import { pathNamingGate } from './repository/path-naming-gate.js';
import { imageAssetsGate } from './repository/image-assets-gate.js';
import { unusedImageAssetsGate } from './repository/unused-image-assets-gate.js';
import { repositoryPolicyGates } from './repository/repository-policy-gates.js';
import { deliveryEvidenceGate } from './release/delivery-evidence-gate.js';
import { defineExternalGate } from './testing/external-gate.js';
import { unitTestGate } from './testing/platform-test-gates.js';
import { mutationTestGate } from './testing/mutation-test-platform-gate.js';
import { javaSourceGates } from './java/source-gates.js';
import { javaEngineeringGates } from './java/engineering-gates.js';
import { javaPathNamingGate } from './java/path-naming-gate.js';
import { javaSpotbugsGate } from './java/spotbugs-gate.js';
import { javaMutationGate } from './java/mutation-gate.js';
import { globalFilePlacementGate } from './repository/global-file-placement-gate.js';

const nativePolicyGates = Object.freeze([
  ...repositoryPolicyGates,
]);

const platformGates = Object.freeze([
  stylelintGate,
  eslintGate,
  prettierGate,
  typecheckGate,
  unitTestGate,
  mutationTestGate,
  architectureGate,
  deadCodeGate,
  buildGate,
  lighthouseGate,
]);

export const officialGates = Object.freeze([
  functionDocumentationGate,
  vueAsyncResourceCleanupGate,
  uiTokenGate,
  pathNamingGate,
  imageAssetsGate,
  unusedImageAssetsGate,
  sourceSecurityGate,
  ...nativePolicyGates,
  deliveryEvidenceGate,
  ...platformGates,
  ...javaSourceGates,
  ...javaEngineeringGates,
  javaPathNamingGate,
  javaSpotbugsGate,
  javaMutationGate,
  globalFilePlacementGate,
]);

export const gateRegistry = createGateRegistry(officialGates);

export function createProjectGateRegistry(config) {
  return createGateRegistry([
    ...officialGates,
    ...config.ci.externalGates.map(defineExternalGate),
  ]);
}
