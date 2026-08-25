import { defineGate } from '../../core/capability/gate-definition.js';
import { collectTrackedProjectPaths } from '../../git/tracked-paths.js';
import {
  inspectPathNaming,
  PATH_NAMING_RULE,
} from '../../policies/path-naming.js';
import {
  findingFromPolicy,
  passedResult,
  skippedResult,
  violationResult,
} from '../native-result.js';
import { selectImageAssetPaths } from '../../policies/image-assets.js';

export const PATH_NAMING_GATE_ID = 'repository.path-naming';

export const pathNamingGate = defineGate({
  id: PATH_NAMING_GATE_ID,
  configKey: 'preCommit.pathNaming',
  featureName: 'pathNaming',
  featureOrder: 38,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'path-naming',
  manualOrder: 145,
  doctorOrder: 145,
  packageScript: 'guard:path-naming',
  rules: [PATH_NAMING_RULE],
  requiredTools: [],
  requiredScripts: [],
  requiredEnvironment: [],
  requiredSecrets: [],
  artifactTypes: [],
  supportsFix: false,
  supportsCancellation: false,
  inspectSetup({ config }) {
    const featureConfig = config.preCommit.pathNaming;
    return {
      status: 'ready',
      summary: featureConfig.enabled
        ? `路径命名门禁已启用（统一规范=${featureConfig.convention}）`
        : '路径命名门禁已禁用，可使用 repo-guard enable pathNaming 启用',
    };
  },
  plan({ root, config, environment, files }) {
    const enabled = environment === 'manual' || config.preCommit.pathNaming.enabled;
    const selectedFiles = enabled
      ? [...(environment === 'manual' ? files : collectTrackedProjectPaths(root))]
      : [];
    const imageFiles = config.imageAssets?.enabled && config.imageAssets.naming.enabled
      ? selectImageAssetPaths(selectedFiles, config.imageAssets)
      : [];
    return Object.freeze({
      enabled,
      files: Object.freeze(selectedFiles),
      imageFiles: Object.freeze(imageFiles),
    });
  },
  run({ config, plan }) {
    if (!plan.enabled) {
      return skippedResult(PATH_NAMING_GATE_ID, '路径命名门禁已禁用');
    }
    const result = inspectPathNaming({
      files: plan.files,
      config: config.preCommit.pathNaming,
      skipFiles: plan.imageFiles,
    });
    const metrics = {
      checkedFiles: result.checkedFiles,
      checkedDirectories: result.checkedDirectories,
      violations: result.violations.length,
    };
    if (result.violations.length === 0) {
      return passedResult(
        PATH_NAMING_GATE_ID,
        `${result.checkedFiles} 个文件和 ${result.checkedDirectories} 个目录通过统一命名检查`,
        { metrics },
      );
    }
    return violationResult(
      PATH_NAMING_GATE_ID,
      `路径命名检查发现 ${result.violations.length} 项阻断错误`,
      {
        metrics,
        findings: result.violations.map((finding) => findingFromPolicy(finding)),
      },
    );
  },
});
