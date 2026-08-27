import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import {
  inspectMiniProgramBuildArtifacts,
  inspectPcBuildArtifacts,
} from '../../integrations/build-artifacts/project.js';

const PC_METRIC_LABELS = Object.freeze({
  totalRawBytes: 'PC 产物总体积',
  initialJsRawBytes: '首屏 JavaScript 原始体积',
  initialJsGzipBytes: '首屏 JavaScript gzip 体积',
  initialJsBrotliBytes: '首屏 JavaScript brotli 体积',
  initialCssRawBytes: '首屏 CSS 原始体积',
  initialCssGzipBytes: '首屏 CSS gzip 体积',
  initialCssBrotliBytes: '首屏 CSS brotli 体积',
  maxChunkRawBytes: '最大 JavaScript 分块体积',
  maxChunkCount: 'JavaScript 分块数量',
  maxAssetRawBytes: '最大静态资源体积',
});

function configFingerprint(config) {
  const contract = {
    platform: config.platform,
    outputDirectory: config.outputDirectory,
    action: config.action,
    pc: config.pc,
  };
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

function finding({ ruleId, message, outputDirectory, severity = 'error', evidence = null }) {
  return Object.freeze({
    ruleId,
    code: ruleId,
    severity,
    message,
    location: { path: outputDirectory },
    evidence,
    expected: '构建产物必须满足当前项目选定平台的体积、结构与安全预算。',
    remediation: {
      goal: '减少或修正构建产物，并保持平台硬限制与工程预算不变。',
      steps: ['根据问题指标定位最大分块、资源或分包，完成拆分、压缩或移除无效内容。'],
      constraints: ['不得通过关闭门禁、扩大预算、伪造基线或排除生产资源绕过检查。'],
      verification: ['重新运行 repo-guard build 并确认产物预算通过。'],
    },
  });
}

function metricViolation(ruleId, label, observed, limit, outputDirectory, severity) {
  return finding({
    ruleId,
    severity,
    outputDirectory,
    message: `${label}为 ${observed}，超过上限 ${limit}`,
    evidence: [{ type: 'artifact-budget-metric', message: `实际值 ${observed}；限制值 ${limit}` }],
  });
}

function pcViolations(inspection, config) {
  const severity = config.action === 'error' ? 'error' : 'warning';
  const violations = [];
  for (const [name, limit] of Object.entries(config.pc.limits)) {
    if (limit == null || inspection.metrics[name] <= limit) continue;
    violations.push(Object.freeze({
      key: `pc/${name}`,
      observed: inspection.metrics[name],
      finding: metricViolation(
        `build-artifact/pc-${name}`,
        PC_METRIC_LABELS[name],
        inspection.metrics[name],
        limit,
        inspection.outputDirectory,
        severity,
      ),
    }));
  }
  if (config.pc.sourceMaps === 'forbid') {
    for (const sourceMap of inspection.sourceMaps) {
      violations.push(Object.freeze({
        key: `pc/source-map/${sourceMap}`,
        observed: 1,
        finding: finding({
          ruleId: 'build-artifact/pc-source-map',
          severity,
          outputDirectory: `${inspection.outputDirectory}/${sourceMap}`,
          message: `生产产物中禁止包含源映射文件：${sourceMap}`,
        }),
      }));
    }
  }
  for (const abnormalFile of inspection.abnormalFiles) {
    violations.push(Object.freeze({
      key: `pc/abnormal-file/${abnormalFile}`,
      observed: 1,
      finding: finding({
        ruleId: 'build-artifact/pc-abnormal-file',
        severity,
        outputDirectory: `${inspection.outputDirectory}/${abnormalFile}`,
        message: `生产产物中包含测试、临时或报告文件：${abnormalFile}`,
      }),
    }));
  }
  return violations;
}

function miniProgramViolations(inspection, config) {
  const violations = [];
  const limits = config.miniProgram.limits;
  const metricRules = [
    ['mainPackageBytes', '小程序主包体积'],
    ['totalPackageBytes', '小程序总体积'],
    ['maxSingleFileBytes', '小程序最大单文件体积'],
    ['maxPreloadBytes', '小程序单页预下载体积'],
  ];
  for (const [name, label] of metricRules) {
    const limit = limits[name];
    if (limit == null || inspection.metrics[name] <= limit) continue;
    violations.push(Object.freeze({
      key: `miniProgram/${name}`,
      observed: inspection.metrics[name],
      finding: metricViolation(
        `build-artifact/mini-program-${name}`,
        label,
        inspection.metrics[name],
        limit,
        inspection.outputDirectory,
        'error',
      ),
    }));
  }
  const overrides = new Map(config.miniProgram.subPackages.map((item) => [item.root, item.maxBytes]));
  for (const packageInfo of inspection.packages) {
    const limit = overrides.get(packageInfo.root) ?? limits.defaultSubPackageBytes;
    if (limit != null && packageInfo.bytes > limit) {
      violations.push(Object.freeze({
        key: `miniProgram/subPackage/${packageInfo.root}`,
        observed: packageInfo.bytes,
        finding: metricViolation(
          'build-artifact/mini-program-subpackage-bytes',
          `小程序分包 ${packageInfo.root} 体积`,
          packageInfo.bytes,
          limit,
          `${inspection.outputDirectory}/${packageInfo.root}`,
          'error',
        ),
      }));
    }
  }
  const actualRoots = new Set(inspection.packageRoots);
  for (const configuredPackage of config.miniProgram.subPackages) {
    if (actualRoots.has(configuredPackage.root)) continue;
    violations.push(Object.freeze({
      key: `miniProgram/stale-subPackage-config/${configuredPackage.root}`,
      observed: 1,
      finding: finding({
        ruleId: 'build-artifact/mini-program-stale-subpackage-config',
        outputDirectory: inspection.outputDirectory,
        message: `小程序分包预算引用了不存在的 root：${configuredPackage.root}`,
      }),
    }));
  }
  for (const expectedRoot of config.miniProgram.expectedSubPackages) {
    if (actualRoots.has(expectedRoot)) continue;
    violations.push(Object.freeze({
      key: `miniProgram/missing-subPackage/${expectedRoot}`,
      observed: 1,
      finding: finding({
        ruleId: 'build-artifact/mini-program-missing-subpackage',
        outputDirectory: inspection.outputDirectory,
        message: `小程序产物缺少预期分包：${expectedRoot}`,
      }),
    }));
  }
  for (const { page, packageRoot, reason } of inspection.preloadFindings) {
    violations.push(Object.freeze({
      key: `miniProgram/preload/${page}/${packageRoot ?? 'invalid'}`,
      observed: 1,
      finding: finding({
        ruleId: 'build-artifact/mini-program-invalid-preload',
        outputDirectory: `${inspection.outputDirectory}/${config.miniProgram.appConfig}`,
        message: reason === 'unknown-page'
          ? `小程序预下载规则引用了不存在的页面：${page}`
          : reason === 'invalid-packages'
            ? `小程序预下载规则 ${page} 的 packages 必须是数组`
            : `小程序预下载规则 ${page} 引用了不存在的分包：${packageRoot}`,
      }),
    }));
  }
  return violations;
}

const BUILD_ARTIFACT_PLATFORM_STRATEGIES = Object.freeze({
  pc: Object.freeze({
    inspect: inspectPcBuildArtifacts,
    collectViolations: pcViolations,
    description: '桌面网页构建产物',
  }),
  miniProgram: Object.freeze({
    inspect: inspectMiniProgramBuildArtifacts,
    collectViolations: miniProgramViolations,
    description: '小程序构建产物',
  }),
});

function resolveBuildArtifactPlatformStrategy(platform) {
  const strategy = BUILD_ARTIFACT_PLATFORM_STRATEGIES[platform];
  if (!strategy) {
    throw configurationError(
      'build-artifact/unsupported-platform',
      `构建产物预算不支持平台：${platform}`,
    );
  }
  return strategy;
}

function loadBaseline(root, config) {
  const target = path.resolve(root, config.baselineFile);
  if (!existsSync(target) || !lstatSync(target).isFile()) {
    throw configurationError(
      'build-artifact/missing-baseline',
      `找不到构建产物历史基线：${config.baselineFile}`,
      { details: { location: { path: config.baselineFile } } },
    );
  }
  const tracked = runGit(
    ['ls-files', '--error-unmatch', '--', config.baselineFile],
    { allowFailure: true, cwd: root },
  ).status === 0;
  if (!tracked) {
    throw configurationError(
      'build-artifact/baseline-not-tracked',
      `构建产物历史基线必须被 Git 跟踪：${config.baselineFile}`,
    );
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw configurationError('build-artifact/invalid-baseline-json', `构建产物历史基线不是有效 JSON：${config.baselineFile}`, { cause: error });
  }
  if (
    baseline?.version !== 1
    || baseline.platform !== config.platform
    || baseline.configFingerprint !== configFingerprint(config)
    || !baseline.allowances
    || typeof baseline.allowances !== 'object'
    || Array.isArray(baseline.allowances)
  ) {
    throw configurationError(
      'build-artifact/stale-baseline',
      `构建产物历史基线与当前平台或配置不一致：${config.baselineFile}`,
    );
  }
  for (const [key, allowance] of Object.entries(baseline.allowances)) {
    if (!key || !Number.isFinite(allowance) || allowance <= 0) {
      throw configurationError('build-artifact/invalid-baseline-entry', `构建产物历史基线包含无效条目：${key}`);
    }
  }
  return baseline;
}

export function inspectBuildArtifactBudget(root, config) {
  return resolveBuildArtifactPlatformStrategy(config.platform).inspect(root, config);
}

export function collectBuildArtifactViolations(inspection, config) {
  return resolveBuildArtifactPlatformStrategy(config.platform)
    .collectViolations(inspection, config);
}

export function describeBuildArtifactPlatform(platform) {
  return resolveBuildArtifactPlatformStrategy(platform).description;
}

export function evaluateBuildArtifactBudget(root, config) {
  const inspection = inspectBuildArtifactBudget(root, config);
  const violations = collectBuildArtifactViolations(inspection, config);
  if (config.mode !== 'baseline') {
    return Object.freeze({ inspection, violations: Object.freeze(violations), baselineDebt: 0 });
  }
  const baseline = loadBaseline(root, config);
  const remaining = [];
  let baselineDebt = 0;
  for (const violation of violations) {
    const allowance = baseline.allowances[violation.key];
    if (allowance != null && violation.observed <= allowance) baselineDebt += 1;
    else remaining.push(violation);
  }
  return Object.freeze({
    inspection,
    violations: Object.freeze(remaining),
    baselineDebt,
  });
}

export function buildArtifactBaselineDocument(config, violations) {
  return Object.freeze({
    version: 1,
    platform: config.platform,
    configFingerprint: configFingerprint(config),
    allowances: Object.freeze(Object.fromEntries(
      violations.map(({ key, observed }) => [key, observed]),
    )),
  });
}
