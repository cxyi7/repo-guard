import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { resolveProjectEslintMetadata } from '../../integrations/eslint/project.js';
import {
  resolveProjectPrettierConfigFile,
  resolveProjectPrettierMetadata,
} from '../../integrations/prettier/project.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../../integrations/stylelint/project.js';
import { skippedResult } from '../native-result.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';
import { runEslintFiles, resolveRepoGuardEslintPreset } from './eslint-gate.js';
import { runPrettierFiles } from './prettier-gate.js';
import {
  runStyleComplexityProject,
  runStyleGovernanceProject,
  runStylelintFiles,
} from './stylelint-gate.js';

const STYLE_FILE = /\.(?:css|scss|sass|less|vue)$/i;

function matchingFiles(root, files, pattern) {
  return files.filter((file) => {
    const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
    return micromatch.isMatch(relative.split(path.sep).join('/'), pattern, {
      dot: true,
      matchBase: true,
    });
  });
}

async function inspectEslintSetup({ root, config }) {
  if (!config.checks.eslint.enabled) return readyGateSetup('ESLint 门禁已禁用');
  const eslint = resolveProjectEslintMetadata(root);
  if (config.checks.eslint.preset) {
    await resolveRepoGuardEslintPreset(root, eslint.version, config.project);
  }
  return readyGateSetup(`ESLint 门禁（版本 ${eslint.version}）`);
}

async function inspectPrettierSetup({ root, config }) {
  if (!config.checks.prettier.enabled) return readyGateSetup('Prettier 门禁已禁用');
  const prettier = resolveProjectPrettierMetadata(root);
  if (config.checks.prettier.requireConfig && !await resolveProjectPrettierConfigFile(root)) {
    throw configurationError(
      'prettier/missing-project-config',
      'Prettier 门禁要求项目配置文件',
    );
  }
  return readyGateSetup(`Prettier 门禁（版本 ${prettier.version}）`);
}

function inspectStylelintSetup({ root, config }) {
  if (!config.checks.stylelint.enabled) return readyGateSetup('Stylelint 门禁已禁用');
  const stylelint = resolveProjectStylelintMetadata(root);
  if (config.checks.stylelint.requireConfig && !findProjectStylelintConfig(root)) {
    throw configurationError(
      'stylelint/missing-project-config',
      'Stylelint 门禁要求项目配置文件',
    );
  }
  return readyGateSetup(`Stylelint 门禁（版本 ${stylelint.version}）`);
}

export const stylelintGate = definePlatformGate({
  id: 'quality.stylelint',
  configKey: 'checks.stylelint',
  featureName: 'stylelint',
  featureOrder: 30,
  doctorOrder: 160,
  environments: ['pre-commit', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.eslint'],
  requiredTools: ['stylelint'],
  supportsFix: true,
  inspectSetup: inspectStylelintSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.checks.stylelint.enabled,
    files: matchingFiles(root, files, config.checks.stylelint.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.checks.stylelint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runStylelintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.checks.stylelint.maxWarnings,
        requireConfig: config.checks.stylelint.requireConfig,
        complexity: config.checks.styleComplexity,
        governance: config.checks.styleGovernance,
        exceptions: config.repository.exceptions,
      })
    : skippedResult('quality.stylelint', 'Stylelint 已禁用'),
});

export const eslintGate = definePlatformGate({
  id: 'quality.eslint',
  configKey: 'checks.eslint',
  featureName: 'eslint',
  featureOrder: 10,
  doctorOrder: 130,
  environments: ['pre-commit', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.prettier'],
  requiredTools: ['eslint'],
  supportsFix: true,
  inspectSetup: inspectEslintSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.checks.eslint.enabled,
    files: matchingFiles(root, files, config.checks.eslint.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.checks.eslint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runEslintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.checks.eslint.maxWarnings,
        preset: config.checks.eslint.preset,
        descriptor: config.project,
      })
    : skippedResult('quality.eslint', 'ESLint 已禁用'),
});

export const prettierGate = definePlatformGate({
  id: 'quality.prettier',
  configKey: 'checks.prettier',
  featureName: 'prettier',
  featureOrder: 20,
  doctorOrder: 170,
  environments: ['pre-commit', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  requiredTools: ['prettier'],
  supportsFix: true,
  inspectSetup: inspectPrettierSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.checks.prettier.enabled,
    files: matchingFiles(root, files, config.checks.prettier.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.checks.prettier.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runPrettierFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        requireConfig: config.checks.prettier.requireConfig,
      })
    : skippedResult('quality.prettier', 'Prettier 已禁用'),
});

function defineStyleProjectGate({
  id,
  configKey,
  featureName,
  featureOrder,
  command,
  manualOrder,
  run,
}) {
  return definePlatformGate({
    id,
    configKey,
    featureName,
    featureOrder,
    environments: ['manual'],
    manualCommand: command,
    manualOrder,
    packageScript: `guard:${command}`,
    requiredTools: ['stylelint'],
    plan: ({ files }) => ({
      files: files.filter((file) => STYLE_FILE.test(
        typeof file === 'string' ? file : file.relative,
      )),
    }),
    run,
  });
}

export const styleComplexityGate = defineStyleProjectGate({
  id: 'quality.style-complexity',
  configKey: 'checks.styleComplexity',
  featureName: 'styleComplexity',
  featureOrder: 60,
  command: 'style-complexity',
  manualOrder: 130,
  run: ({ root, config, plan }) => runStyleComplexityProject({
    root,
    files: plan.files,
    config: { ...config.checks.styleComplexity, enabled: true },
    exceptions: config.repository.exceptions,
  }),
});

export const styleGovernanceGate = defineStyleProjectGate({
  id: 'quality.style-governance',
  configKey: 'checks.styleGovernance',
  featureName: 'styleGovernance',
  featureOrder: 70,
  command: 'style-governance',
  manualOrder: 140,
  run: ({ root, config, plan }) => runStyleGovernanceProject({
    root,
    files: plan.files,
    config: { ...config.checks.styleGovernance, enabled: true },
    exceptions: config.repository.exceptions,
  }),
});
