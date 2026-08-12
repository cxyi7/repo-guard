import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCESSIBILITY_TEST_POLICY_FILE,
  ensureAccessibilityTestPolicy,
  isAccessibilityTestPolicyCurrent,
} from '../accessibility-test-policy.js';
import { validateAccessibilityTestSetup } from '../accessibility-test-runner.js';
import {
  ARCHITECTURE_POLICY_FILE,
  ensureArchitecturePolicy,
  isArchitecturePolicyCurrent,
} from '../architecture-policy.js';
import { validateArchitectureSetup } from '../architecture-runner.js';
import { validateBuildSetup } from '../build-runner.js';
import { loadConfig } from '../config.js';
import { isStructuredCoverage } from '../coverage-runner.js';
import {
  ensureExceptionPolicy,
  EXCEPTION_POLICY_FILE,
  isExceptionPolicyCurrent,
} from '../exception-policy.js';
import {
  formatExceptionRegistryReport,
  inspectExceptionRegistry,
} from '../exception-registry.js';
import {
  ensureProjectConfig,
  migrateProjectConfig,
} from '../config-management.js';
import {
  resolveProjectEslintMetadata,
  resolveRepoGuardEslintPreset,
} from '../eslint-runner.js';
import {
  resolveProjectPrettierConfigFile,
  resolveProjectPrettierMetadata,
} from '../prettier-runner.js';
import { findRepositoryRoot, gitValue } from '../git.js';
import {
  isCurrentManagedHook,
  isManagedHook,
  installHooks,
  managedHookNames,
} from '../hook-installer.js';
import {
  getLocalEnvironmentGitStatus,
  LOCAL_ENV_FILE,
  resolveNotificationEnvironment,
} from '../local-env.js';
import { loadNotificationConfig } from '../wecom.js';
import { validateVueLighthouseSetup } from '../lighthouse-project.js';
import {
  findProjectStylelintConfig,
  resolveProjectStylelintMetadata,
} from '../stylelint-project.js';
import {
  ensureUnitTestPolicy,
  isUnitTestPolicyCurrent,
  UNIT_TEST_POLICY_FILE,
} from '../unit-test-policy.js';
import { validateUnitTestSetup } from '../unit-test-runner.js';
import { validateTypeCheckSetup } from '../typecheck-runner.js';

function nodeVersionIsSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 18 || (major === 18 && minor >= 12);
}

function repairRepository(root) {
  const repairs = [];
  const repairErrors = [];

  try {
    const { created } = ensureProjectConfig(root);
    if (created) {
      repairs.push('created repo-guard.config.json');
      const config = loadConfig(root, { allowExpiredExceptions: true });
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
    } else {
      const { changed, config } = migrateProjectConfig(root, {
        allowExpiredExceptions: true,
      });
      repairs.push(
        changed
          ? 'migrated repo-guard.config.json'
          : 'repo-guard.config.json is already current',
      );
      const exceptionPolicy = ensureExceptionPolicy(root, config.exceptions);
      repairs.push(
        exceptionPolicy.changed
          ? `updated ${EXCEPTION_POLICY_FILE} structured exception policy`
          : `${EXCEPTION_POLICY_FILE} structured exception policy is already current`,
      );
      if (config.unitTest.enabled) {
        const policy = ensureUnitTestPolicy(root, config.unitTest);
        repairs.push(
          policy.changed
            ? `updated ${UNIT_TEST_POLICY_FILE} unit test policy`
            : `${UNIT_TEST_POLICY_FILE} unit test policy is already current`,
        );
      }
      if (config.accessibilityTest.enabled) {
        const policy = ensureAccessibilityTestPolicy(root, config.accessibilityTest);
        repairs.push(
          policy.changed
            ? `updated ${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy`
            : `${ACCESSIBILITY_TEST_POLICY_FILE} accessibility test policy is already current`,
        );
      }
      if (config.architecture.enabled) {
        const policy = ensureArchitecturePolicy(root, config.architecture);
        repairs.push(
          policy.changed
            ? `updated ${ARCHITECTURE_POLICY_FILE} architecture policy`
            : `${ARCHITECTURE_POLICY_FILE} architecture policy is already current`,
        );
      }
    }
  } catch (error) {
    repairErrors.push(`configuration repair failed: ${error.message}`);
  }

  try {
    installHooks({ cwd: root, updatePackageScripts: true });
    repairs.push('reconciled managed hooks, repository files, and package scripts');
  } catch (error) {
    repairErrors.push(`installation repair failed: ${error.message}`);
  }

  return { repairErrors, repairs };
}

export async function runDoctor(cwd = process.cwd(), { fix = false } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const root = findRepositoryRoot(cwd);
  const repairResult = fix
    ? repairRepository(root)
    : { repairErrors: [], repairs: [] };

  errors.push(...repairResult.repairErrors);

  if (nodeVersionIsSupported()) {
    checks.push(`Node.js ${process.versions.node}`);
  } else {
    errors.push(`Node.js ${process.versions.node} is unsupported; expected >=18.12.0`);
  }

  let config;
  try {
    config = loadConfig(root, { allowExpiredExceptions: true });
    checks.push(`configuration (${config.rules.length} rules, ${config.exclusions.length} exclusions)`);
  } catch (error) {
    errors.push(error.message);
  }

  if (config) {
    const exceptionResult = inspectExceptionRegistry(config.exceptions);
    const policyPath = path.join(root, EXCEPTION_POLICY_FILE);
    if (!existsSync(policyPath)
      || !isExceptionPolicyCurrent(readFileSync(policyPath, 'utf8'), config.exceptions)) {
      errors.push(
        `${EXCEPTION_POLICY_FILE} is missing the repo-guard structured exception policy; `
        + 'run repo-guard doctor --fix',
      );
    } else {
      checks.push(`${EXCEPTION_POLICY_FILE} structured exception policy`);
    }
    if (exceptionResult.expired.length > 0 || exceptionResult.future.length > 0) {
      errors.push(formatExceptionRegistryReport(exceptionResult));
    } else {
      checks.push(
        `Structured exceptions (${exceptionResult.entries.length} total, `
        + `${exceptionResult.active.length} active, `
        + `${exceptionResult.expiring.length} expiring)`,
      );
    }
    if (exceptionResult.expiring.length > 0
      && exceptionResult.expired.length === 0
      && exceptionResult.future.length === 0) {
      warnings.push(formatExceptionRegistryReport(exceptionResult));
    }
  }

  const hooksPath = gitValue(['config', '--local', '--get', 'core.hooksPath'], '', root);
  if (hooksPath === '.githooks') {
    checks.push('core.hooksPath=.githooks');
  } else {
    errors.push(`core.hooksPath is "${hooksPath || 'not configured'}"`);
  }

  for (const hookName of managedHookNames) {
    const target = path.join(root, '.githooks', hookName);
    if (!existsSync(target)) {
      errors.push(`missing Git hook: .githooks/${hookName}`);
      continue;
    }
    if (!isManagedHook(readFileSync(target, 'utf8'))) {
      errors.push(`Git hook is not managed by repo-guard: .githooks/${hookName}`);
      continue;
    }
    if (!isCurrentManagedHook(readFileSync(target, 'utf8'))) {
      errors.push(`Git hook is outdated: .githooks/${hookName}; run repo-guard install-hooks`);
    }
  }
  if (errors.every((message) => !message.includes('Git hook'))) {
    checks.push(`${managedHookNames.length} managed Git hooks`);
  }

  const hasNotifyRules = config?.rules.some(({ level }) => level === 'notify') ?? false;
  const notificationRequired = config?.notification.enabled && hasNotifyRules;
  const localEnvironmentPath = path.join(root, LOCAL_ENV_FILE);
  if (!existsSync(localEnvironmentPath)) {
    if (notificationRequired) {
      errors.push(`missing local notification template: ${LOCAL_ENV_FILE}; run repo-guard init`);
    } else {
      checks.push(`${LOCAL_ENV_FILE} is not required by the current notification settings`);
    }
  } else {
    const { ignored, tracked } = getLocalEnvironmentGitStatus(root);
    if (tracked) {
      errors.push(
        `${LOCAL_ENV_FILE} is tracked by Git; run "git rm --cached -- ${LOCAL_ENV_FILE}"`,
      );
    } else if (!ignored) {
      errors.push(`${LOCAL_ENV_FILE} is not ignored by Git; run repo-guard init`);
    } else {
      checks.push(`${LOCAL_ENV_FILE} is local and ignored`);
    }
  }

  if (config && !config.notification.enabled) {
    checks.push('WeCom notification is disabled');
  } else if (notificationRequired) {
    try {
      loadNotificationConfig(resolveNotificationEnvironment(root));
      checks.push('WeCom notification configuration');
    } catch (error) {
      errors.push(error.message);
    }
  } else if (config) {
    checks.push('WeCom notification is not required because no notify rules are configured');
  }

  if (config?.build.enabled) {
    try {
      validateBuildSetup(root, config.build);
      checks.push(
        `Build pre-push gate (script=${config.build.script}, `
        + `timeoutMs=${config.build.timeoutMs})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Build pre-push gate is disabled');
  }

  if (config?.architecture.enabled) {
    try {
      const setup = validateArchitectureSetup(root, config.architecture);
      const policyPath = path.join(root, ARCHITECTURE_POLICY_FILE);
      if (!existsSync(policyPath)
        || !isArchitecturePolicyCurrent(
          readFileSync(policyPath, 'utf8'),
          config.architecture,
        )) {
        throw new Error(
          `${ARCHITECTURE_POLICY_FILE} is missing the repo-guard architecture policy; `
          + 'run repo-guard doctor --fix',
        );
      }
      checks.push(
        `Architecture dependency gate (dependency-cruiser ${setup.dependencyCruiser.version}, `
        + `${config.architecture.rules.length} rules, `
        + `sources=${config.architecture.sourcePaths.join(',')})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Architecture dependency pre-push gate is disabled');
  }

  if (config?.lighthouse.enabled) {
    try {
      const setup = validateVueLighthouseSetup(root, config.lighthouse);
      checks.push(
        `Lighthouse CI ${setup.lighthouse.version} Vue pre-push gate `
        + `(config=${setup.configFile}, build=${config.lighthouse.buildScript || 'skipped'})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Lighthouse Vue pre-push gate is disabled');
  }

  if (config?.typeCheck.enabled) {
    try {
      validateTypeCheckSetup(root, config.typeCheck);
      checks.push(
        `TypeScript pre-push gate (script=${config.typeCheck.script}, `
        + `timeoutMs=${config.typeCheck.timeoutMs})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('TypeScript pre-push gate is disabled');
  }

  if (config?.unitTest.enabled) {
    try {
      const setup = validateUnitTestSetup(root, config.unitTest);
      const policyPath = path.join(root, UNIT_TEST_POLICY_FILE);
      if (
        !existsSync(policyPath)
        || !isUnitTestPolicyCurrent(
          readFileSync(policyPath, 'utf8'),
          config.unitTest,
        )
      ) {
        throw new Error(
          `${UNIT_TEST_POLICY_FILE} is missing the repo-guard unit test policy; `
          + 'run repo-guard doctor --fix',
        );
      }
      checks.push(
        `Vitest ${setup.vitest.version} pre-push gate `
        + `(script=${config.unitTest.script}, requireTests=${config.unitTest.requireTests}, `
        + `componentInteraction=${setup.vueTestUtils
          ? `Vue Test Utils ${setup.vueTestUtils.version}`
          : 'disabled'}, `
        + `coverage=${isStructuredCoverage(config.unitTest.coverage)
          ? `global=${config.unitTest.coverage.thresholds.lines}%/changed=${config.unitTest.coverage.thresholds.changedLines}%`
          : (typeof config.unitTest.coverage === 'boolean'
            ? config.unitTest.coverage
            : 'disabled')}, mappings=${config.unitTest.mappings.length})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Unit test pre-push gate is disabled');
  }

  if (config?.accessibilityTest.enabled) {
    try {
      const setup = validateAccessibilityTestSetup(root, config.accessibilityTest);
      const policyPath = path.join(root, ACCESSIBILITY_TEST_POLICY_FILE);
      if (
        !existsSync(policyPath)
        || !isAccessibilityTestPolicyCurrent(
          readFileSync(policyPath, 'utf8'),
          config.accessibilityTest,
        )
      ) {
        throw new Error(
          `${ACCESSIBILITY_TEST_POLICY_FILE} is missing the repo-guard accessibility test policy; `
          + 'run repo-guard doctor --fix',
        );
      }
      checks.push(
        `axe accessibility test pre-push gate (script=${config.accessibilityTest.script}, `
        + `files=${setup.files.length}, integrations=`
        + `${setup.integrations.map(({ name, version }) => `${name}@${version}`).join(',')})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('axe accessibility test pre-push gate is disabled');
  }

  if (config) {
    checks.push(
      'Dynamic code staged gate '
      + '(hard requirement, rules=security/no-eval+security/no-function-constructor)',
    );
    checks.push('Vue v-html staged gate (hard requirement, rule=vue/no-v-html)');
    checks.push(
      'Vue target=_blank staged gate '
      + '(hard requirement, rel=noopener+noreferrer, rule=vue/target-blank-security)',
    );
    checks.push(
      'Vue form control label staged gate '
      + '(hard requirement, rule=vue/form-control-label)',
    );
    checks.push(
      'Vue image alt staged gate '
      + '(hard requirement, rule=vue/img-alt)',
    );
    if (config.dependencyPolicy.enabled) {
      checks.push(
        `Dependency policy (exact=${config.dependencyPolicy.requireExactVersions}, `
        + `lockfile=${config.dependencyPolicy.requireLockfile}, `
        + `protocols=${config.dependencyPolicy.allowedProtocols.join(',') || 'none'}, `
        + `banned=${config.dependencyPolicy.bannedPackages.length})`,
      );
    } else {
      checks.push('Dependency policy staged gate is disabled');
    }
  }

  if (config?.preCommit.eslint.enabled) {
    try {
      const eslint = resolveProjectEslintMetadata(root);
      const preset = config.preCommit.eslint.preset
        ? await resolveRepoGuardEslintPreset(root, eslint.version)
        : null;
      checks.push(
        `ESLint ${eslint.version} staged gate `
        + `(${config.preCommit.eslint.pattern}, fix=${config.preCommit.eslint.fix}, `
        + `preset=${preset ? `enabled: ${preset.integrations.join(', ')}` : 'disabled'})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('ESLint staged gate is disabled');
  }

  if (config?.preCommit.maxFileLines.enabled) {
    const limits = config.preCommit.maxFileLines.rules
      .map(({ pattern, maxLines }) => `${pattern}<=${maxLines}`)
      .join(', ');
    checks.push(
      `Maximum file lines staged gate `
      + `(mode=${config.preCommit.maxFileLines.mode}, `
      + `warnAt=${config.preCommit.maxFileLines.warnAt}, ${limits})`,
    );
  } else {
    checks.push('Maximum file lines staged gate is disabled');
  }

  if (config?.preCommit.filePlacement.enabled) {
    checks.push(
      `File placement staged gate (mode=${config.preCommit.filePlacement.mode}, `
      + `${config.preCommit.filePlacement.rules.length} rules)`,
    );
  } else {
    checks.push('File placement staged gate is disabled');
  }

  if (config?.preCommit.stylelint.enabled) {
    try {
      const stylelint = resolveProjectStylelintMetadata(root);
      const stylelintConfigFile = findProjectStylelintConfig(root);
      if (config.preCommit.stylelint.requireConfig && !stylelintConfigFile) {
        throw new Error('Stylelint staged gate requires a project Stylelint configuration file');
      }
      checks.push(
        `Stylelint ${stylelint.version} staged gate `
        + `(${config.preCommit.stylelint.pattern}, fix=${config.preCommit.stylelint.fix}, `
        + `config=${stylelintConfigFile || 'project config optional'}, `
        + `complexity=${config.preCommit.stylelint.complexity.enabled
          ? `compound<=${config.preCommit.stylelint.complexity.maxCompoundSelectors}, `
            + `nesting<=${config.preCommit.stylelint.complexity.maxNestingDepth}`
          : 'disabled'}, `
        + `governance=${config.preCommit.stylelint.governance.enabled
          ? `specificity<=${config.preCommit.stylelint.governance.maxSpecificity}, `
            + `ids<=${config.preCommit.stylelint.governance.maxIdSelectors}, `
            + `important=${config.preCommit.stylelint.governance.disallowImportant
              ? 'blocked'
              : 'allowed'}, global-patterns=`
            + config.preCommit.stylelint.governance.allowedGlobalStylePatterns.length
          : 'disabled'})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Stylelint staged gate is disabled');
  }

  if (config?.preCommit.prettier.enabled) {
    try {
      const prettier = resolveProjectPrettierMetadata(root);
      let configDescription = 'project config optional';
      if (config.preCommit.prettier.requireConfig) {
        const prettierConfigFile = await resolveProjectPrettierConfigFile(root);
        if (!prettierConfigFile) {
          throw new Error('Prettier staged gate requires a project Prettier configuration file');
        }
        configDescription = path.relative(root, prettierConfigFile);
      }
      checks.push(
        `Prettier ${prettier.version} staged gate `
        + `(${config.preCommit.prettier.pattern}, fix=${config.preCommit.prettier.fix}, `
        + `config=${configDescription})`,
      );
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    checks.push('Prettier staged gate is disabled');
  }

  console.log(`repo-guard doctor: ${root}`);
  for (const repair of repairResult.repairs) {
    console.log(`  FIX   ${repair}`);
  }
  for (const check of checks) {
    console.log(`  OK    ${check}`);
  }
  for (const warning of warnings) {
    console.warn(`  WARN  ${warning}`);
  }
  for (const error of errors) {
    console.error(`  ERROR ${error}`);
  }

  return errors.length === 0 ? 0 : 1;
}
