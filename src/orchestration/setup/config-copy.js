import {
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_CI_PIPELINE_CONFIG,
  DEFAULT_CODE_PLACEMENT_CONFIG,
  DEFAULT_COMMIT_MESSAGE_CONFIG,
  DEFAULT_COMPONENT_INTERACTION_CONFIG,
  DEFAULT_DEPENDENCY_POLICY_CONFIG,
  DEFAULT_DEAD_CODE_CONFIG,
  DEFAULT_EXCEPTIONS_CONFIG,
  DEFAULT_FILE_HEADER_CONFIG,
  DEFAULT_FILE_PLACEMENT_CONFIG,
  DEFAULT_FUNCTION_DOC_CONFIG,
  DEFAULT_IMAGE_ASSETS_CONFIG,
  DEFAULT_MUTATION_TEST_CONFIG,
  DEFAULT_PATH_NAMING_CONFIG,
  DEFAULT_STYLELINT_CONFIG,
  DEFAULT_STYLE_COMPLEXITY_CONFIG,
  DEFAULT_STYLE_GOVERNANCE_CONFIG,
  DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../../config/defaults.js';

export function cloneExceptionsConfig(value = {}) {
  return {
    ...DEFAULT_EXCEPTIONS_CONFIG,
    ...value,
    entries: (value.entries ?? DEFAULT_EXCEPTIONS_CONFIG.entries).map((entry) => ({ ...entry })),
  };
}

export function cloneCiPipelineConfig(value = {}) {
  return {
    ...DEFAULT_CI_PIPELINE_CONFIG,
    ...value,
    testBranches: [...(value.testBranches ?? DEFAULT_CI_PIPELINE_CONFIG.testBranches)],
    productionBranches: [
      ...(value.productionBranches ?? DEFAULT_CI_PIPELINE_CONFIG.productionBranches),
    ],
    runnerTags: [...(value.runnerTags ?? DEFAULT_CI_PIPELINE_CONFIG.runnerTags)],
  };
}

export function cloneDependencyPolicyConfig(value = {}) {
  return {
    ...DEFAULT_DEPENDENCY_POLICY_CONFIG,
    ...value,
    allowedProtocols: [
      ...(value.allowedProtocols ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.allowedProtocols),
    ],
    bannedPackages: (
      value.bannedPackages ?? DEFAULT_DEPENDENCY_POLICY_CONFIG.bannedPackages
    ).map((item) => ({ ...item })),
  };
}

export function cloneCommitMessageConfig(value = {}) {
  return {
    ...DEFAULT_COMMIT_MESSAGE_CONFIG,
    ...value,
    types: [...(value.types ?? DEFAULT_COMMIT_MESSAGE_CONFIG.types)],
    allowedScopes: [...(value.allowedScopes ?? DEFAULT_COMMIT_MESSAGE_CONFIG.allowedScopes)],
    breakingChange: {
      ...DEFAULT_COMMIT_MESSAGE_CONFIG.breakingChange,
      ...(value.breakingChange ?? {}),
    },
    merge: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.merge, ...(value.merge ?? {}) },
    revert: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.revert, ...(value.revert ?? {}) },
    fixup: { ...DEFAULT_COMMIT_MESSAGE_CONFIG.fixup, ...(value.fixup ?? {}) },
  };
}

export function cloneDeadCodeConfig(value = {}) {
  return {
    ...DEFAULT_DEAD_CODE_CONFIG,
    ...value,
    issueTypes: [...(value.issueTypes ?? DEFAULT_DEAD_CODE_CONFIG.issueTypes)],
  };
}

export function cloneBuildConfig(value = {}) {
  const artifactBudget = value.artifactBudget ?? DEFAULT_BUILD_CONFIG.artifactBudget;
  return {
    ...DEFAULT_BUILD_CONFIG,
    ...value,
    artifactBudget: {
      ...DEFAULT_BUILD_CONFIG.artifactBudget,
      ...artifactBudget,
      scanLimits: {
        ...DEFAULT_BUILD_CONFIG.artifactBudget.scanLimits,
        ...(artifactBudget.scanLimits ?? {}),
      },
      pc: artifactBudget.pc == null ? null : {
        ...artifactBudget.pc,
        ...(artifactBudget.pc.compression == null
          ? {}
          : { compression: [...artifactBudget.pc.compression] }),
        limits: { ...(artifactBudget.pc.limits ?? {}) },
      },
      miniProgram: artifactBudget.miniProgram == null ? null : {
        ...artifactBudget.miniProgram,
        limits: { ...(artifactBudget.miniProgram.limits ?? {}) },
        subPackages: (artifactBudget.miniProgram.subPackages ?? []).map((entry) => ({ ...entry })),
        expectedSubPackages: [...(artifactBudget.miniProgram.expectedSubPackages ?? [])],
        exclusions: (artifactBudget.miniProgram.exclusions ?? []).map((entry) => ({
          ...entry,
          patterns: [...entry.patterns],
        })),
      },
    },
  };
}

export function ensureBuildArtifactBaselineRule(rules, build) {
  const next = rules.map((rule) => ({ ...rule }));
  const baseline = build.artifactBudget;
  if (
    baseline?.enabled
    && baseline.mode === 'baseline'
    && !next.some(({ pattern }) => pattern === baseline.baselineFile)
  ) {
    next.push({
      pattern: baseline.baselineFile,
      category: '构建产物历史债务基线',
      level: 'notify',
    });
  }
  return next;
}

export function cloneArchitectureConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_ARCHITECTURE_CONFIG.rules;
  return {
    ...DEFAULT_ARCHITECTURE_CONFIG,
    ...value,
    sourcePaths: [...(value.sourcePaths ?? DEFAULT_ARCHITECTURE_CONFIG.sourcePaths)],
    rules: rules.map((rule) => ({
      ...rule,
      from: structuredClone(rule.from),
      to: structuredClone(rule.to),
    })),
  };
}

export function cloneCodePlacementConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_CODE_PLACEMENT_CONFIG.rules;
  return {
    ...DEFAULT_CODE_PLACEMENT_CONFIG,
    ...value,
    rules: rules.map((rule) => ({
      ...rule,
      allowedFiles: [...rule.allowedFiles],
      scanPatterns: [...rule.scanPatterns],
    })),
  };
}

export function cloneFilePlacementConfig(value = {}) {
  const rules = value.rules ?? DEFAULT_FILE_PLACEMENT_CONFIG.rules;
  return {
    ...DEFAULT_FILE_PLACEMENT_CONFIG,
    ...value,
    rules: rules.map((rule) => ({
      ...rule,
      patterns: [...rule.patterns],
      allowedPatterns: [...rule.allowedPatterns],
      exceptions: [...(rule.exceptions ?? [])],
    })),
  };
}

export function cloneFileHeaderConfig(value = {}) {
  return {
    ...DEFAULT_FILE_HEADER_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_FILE_HEADER_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_FILE_HEADER_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_FILE_HEADER_CONFIG.extensions)],
  };
}

export function cloneFunctionDocConfig(value = {}) {
  return {
    ...DEFAULT_FUNCTION_DOC_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_FUNCTION_DOC_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_FUNCTION_DOC_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_FUNCTION_DOC_CONFIG.extensions)],
  };
}

export function cloneAsyncResourceCleanupConfig(value = {}) {
  return {
    ...DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.extensions)],
    requestFunctions: [
      ...(value.requestFunctions ?? DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG.requestFunctions),
    ],
  };
}

export function clonePathNamingConfig(value = {}) {
  return {
    ...DEFAULT_PATH_NAMING_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_PATH_NAMING_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_PATH_NAMING_CONFIG.exclude)],
  };
}

export function cloneImageAssetsConfig(value = {}) {
  const naming = value.naming ?? DEFAULT_IMAGE_ASSETS_CONFIG.naming;
  const duplicates = value.duplicates ?? DEFAULT_IMAGE_ASSETS_CONFIG.duplicates;
  const compression = value.compression ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression;
  const raster = compression.raster ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.raster;
  const svg = compression.svg ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.svg;
  const conversion = compression.conversion
    ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion;
  const unused = value.unused ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused;
  return {
    ...DEFAULT_IMAGE_ASSETS_CONFIG,
    ...value,
    include: [...(value.include ?? DEFAULT_IMAGE_ASSETS_CONFIG.include)],
    exclude: [...(value.exclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.exclude)],
    extensions: [...(value.extensions ?? DEFAULT_IMAGE_ASSETS_CONFIG.extensions)],
    naming: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.naming,
      ...naming,
      densitySuffixes: [
        ...(naming.densitySuffixes ?? DEFAULT_IMAGE_ASSETS_CONFIG.naming.densitySuffixes),
      ],
    },
    duplicates: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.duplicates,
      ...duplicates,
      canonicalRoots: [
        ...(duplicates.canonicalRoots
          ?? DEFAULT_IMAGE_ASSETS_CONFIG.duplicates.canonicalRoots),
      ],
    },
    compression: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.compression,
      ...compression,
      raster: { ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.raster, ...raster },
      svg: { ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.svg, ...svg },
      conversion: {
        ...DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion,
        ...conversion,
        sourceFormats: [
          ...(conversion.sourceFormats
            ?? DEFAULT_IMAGE_ASSETS_CONFIG.compression.conversion.sourceFormats),
        ],
      },
    },
    unused: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.unused,
      ...unused,
      sourceInclude: [...(unused.sourceInclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceInclude)],
      sourceExclude: [...(unused.sourceExclude ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceExclude)],
      sourceExtensions: [...(unused.sourceExtensions ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.sourceExtensions)],
      aliases: (unused.aliases ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.aliases).map((entry) => ({ ...entry })),
      publicRoots: (unused.publicRoots ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.publicRoots).map((entry) => ({ ...entry })),
      dynamicReferences: (unused.dynamicReferences ?? DEFAULT_IMAGE_ASSETS_CONFIG.unused.dynamicReferences).map((entry) => ({
        ...entry,
        sourcePatterns: [...entry.sourcePatterns],
        assetPatterns: [...entry.assetPatterns],
      })),
      limits: {
        ...DEFAULT_IMAGE_ASSETS_CONFIG.unused.limits,
        ...(unused.limits ?? {}),
      },
    },
    limits: {
      ...DEFAULT_IMAGE_ASSETS_CONFIG.limits,
      ...(value.limits ?? {}),
    },
  };
}

export function cloneUnitTestConfig(value = {}) {
  const mappings = value.mappings ?? DEFAULT_UNIT_TEST_CONFIG.mappings;
  const coverage = value.coverage ?? DEFAULT_UNIT_TEST_CONFIG.coverage;
  return {
    ...DEFAULT_UNIT_TEST_CONFIG,
    ...value,
    coverage: {
      ...DEFAULT_UNIT_TEST_COVERAGE_CONFIG,
      ...coverage,
      thresholds: {
        ...DEFAULT_UNIT_TEST_COVERAGE_CONFIG.thresholds,
        ...(coverage.thresholds ?? {}),
      },
    },
    componentInteraction: {
      ...DEFAULT_COMPONENT_INTERACTION_CONFIG,
      ...(value.componentInteraction ?? {}),
      componentPatterns: [
        ...(value.componentInteraction?.componentPatterns
          ?? DEFAULT_COMPONENT_INTERACTION_CONFIG.componentPatterns),
      ],
    },
    sourcePatterns: [...(value.sourcePatterns ?? DEFAULT_UNIT_TEST_CONFIG.sourcePatterns)],
    testPatterns: [...(value.testPatterns ?? DEFAULT_UNIT_TEST_CONFIG.testPatterns)],
    mappings: mappings.map((mapping) => ({
      ...mapping,
      testTemplates: [...mapping.testTemplates],
    })),
    exclusions: [...(value.exclusions ?? DEFAULT_UNIT_TEST_CONFIG.exclusions)],
  };
}

export function cloneMutationTestConfig(value = {}) {
  return {
    ...DEFAULT_MUTATION_TEST_CONFIG,
    ...value,
    guardedBuilds: (value.guardedBuilds ?? DEFAULT_MUTATION_TEST_CONFIG.guardedBuilds)
      .map((entry) => ({ ...entry })),
  };
}

export function cloneStylelintConfig(value = {}) {
  return {
    ...DEFAULT_STYLELINT_CONFIG,
    ...value,
    complexity: {
      ...DEFAULT_STYLE_COMPLEXITY_CONFIG,
      ...(value.complexity ?? {}),
    },
    governance: {
      ...DEFAULT_STYLE_GOVERNANCE_CONFIG,
      ...(value.governance ?? {}),
      allowedGlobalStylePatterns: [
        ...(value.governance?.allowedGlobalStylePatterns
          ?? DEFAULT_STYLE_GOVERNANCE_CONFIG.allowedGlobalStylePatterns),
      ],
    },
  };
}

