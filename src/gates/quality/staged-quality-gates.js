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
  if (!config.preCommit.eslint.enabled) return readyGateSetup('ESLint gate is disabled');
  const eslint = resolveProjectEslintMetadata(root);
  if (config.preCommit.eslint.preset) await resolveRepoGuardEslintPreset(root, eslint.version);
  return readyGateSetup(`ESLint ${eslint.version} gate`);
}

async function inspectPrettierSetup({ root, config }) {
  if (!config.preCommit.prettier.enabled) return readyGateSetup('Prettier gate is disabled');
  const prettier = resolveProjectPrettierMetadata(root);
  if (config.preCommit.prettier.requireConfig && !await resolveProjectPrettierConfigFile(root)) {
    throw configurationError(
      'prettier/missing-project-config',
      'Prettier gate requires a project configuration file',
    );
  }
  return readyGateSetup(`Prettier ${prettier.version} gate`);
}

function inspectStylelintSetup({ root, config }) {
  if (!config.preCommit.stylelint.enabled) return readyGateSetup('Stylelint gate is disabled');
  const stylelint = resolveProjectStylelintMetadata(root);
  if (config.preCommit.stylelint.requireConfig && !findProjectStylelintConfig(root)) {
    throw configurationError(
      'stylelint/missing-project-config',
      'Stylelint gate requires a project configuration file',
    );
  }
  return readyGateSetup(`Stylelint ${stylelint.version} gate`);
}

export const stylelintGate = definePlatformGate({
  id: 'quality.stylelint',
  configKey: 'preCommit.stylelint',
  featureName: 'stylelint',
  featureOrder: 30,
  doctorOrder: 160,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.eslint'],
  requiredTools: ['stylelint'],
  supportsFix: true,
  inspectSetup: inspectStylelintSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.preCommit.stylelint.enabled,
    files: matchingFiles(root, files, config.preCommit.stylelint.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.stylelint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runStylelintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.preCommit.stylelint.maxWarnings,
        requireConfig: config.preCommit.stylelint.requireConfig,
        complexity: config.preCommit.stylelint.complexity,
        governance: config.preCommit.stylelint.governance,
        exceptions: config.exceptions,
      })
    : skippedResult('quality.stylelint', 'Stylelint is disabled'),
});

export const eslintGate = definePlatformGate({
  id: 'quality.eslint',
  configKey: 'preCommit.eslint',
  featureName: 'eslint',
  featureOrder: 10,
  doctorOrder: 130,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  before: ['quality.prettier'],
  requiredTools: ['eslint'],
  supportsFix: true,
  inspectSetup: inspectEslintSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.preCommit.eslint.enabled,
    files: matchingFiles(root, files, config.preCommit.eslint.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.eslint.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runEslintFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        maxWarnings: config.preCommit.eslint.maxWarnings,
        preset: config.preCommit.eslint.preset,
      })
    : skippedResult('quality.eslint', 'ESLint is disabled'),
});

export const prettierGate = definePlatformGate({
  id: 'quality.prettier',
  configKey: 'preCommit.prettier',
  featureName: 'prettier',
  featureOrder: 20,
  doctorOrder: 170,
  environments: ['pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  allowedMutations: ['working-tree-fix', 'read-only'],
  requiredTools: ['prettier'],
  supportsFix: true,
  inspectSetup: inspectPrettierSetup,
  plan: ({ root, config, files, step }) => ({
    enabled: config.preCommit.prettier.enabled,
    files: matchingFiles(root, files, config.preCommit.prettier.pattern),
    fix: step?.mutation === 'working-tree-fix' && config.preCommit.prettier.fix,
  }),
  run: ({ root, config, plan }) => plan.enabled
    ? runPrettierFiles({
        root,
        files: plan.files,
        fix: plan.fix,
        requireConfig: config.preCommit.prettier.requireConfig,
      })
    : skippedResult('quality.prettier', 'Prettier is disabled'),
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
  configKey: 'preCommit.stylelint.complexity',
  featureName: 'styleComplexity',
  featureOrder: 60,
  command: 'style-complexity',
  manualOrder: 130,
  run: ({ root, config, plan }) => runStyleComplexityProject({
    root,
    files: plan.files,
    config: { ...config.preCommit.stylelint.complexity, enabled: true },
    exceptions: config.exceptions,
  }),
});

export const styleGovernanceGate = defineStyleProjectGate({
  id: 'quality.style-governance',
  configKey: 'preCommit.stylelint.governance',
  featureName: 'styleGovernance',
  featureOrder: 70,
  command: 'style-governance',
  manualOrder: 140,
  run: ({ root, config, plan }) => runStyleGovernanceProject({
    root,
    files: plan.files,
    config: { ...config.preCommit.stylelint.governance, enabled: true },
    exceptions: config.exceptions,
  }),
});
