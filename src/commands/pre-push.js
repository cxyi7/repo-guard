import { runBuildGate } from '../build-runner.js';
import { runAccessibilityTestGate } from '../accessibility-test-runner.js';
import { runArchitectureGate } from '../architecture-runner.js';
import { CONFIG_FILE, loadConfig, validateConfig } from '../config.js';
import { findRepositoryRoot, gitValue, runGit } from '../git.js';
import { runVueLighthouse } from '../lighthouse-runner.js';
import {
  collectPrePushChanges,
  parsePrePushUpdates,
} from '../pre-push-changes.js';
import { runUnitTestGate } from '../unit-test-runner.js';
import { runTypeCheckGate } from '../typecheck-runner.js';
import { assertExceptionRegistryCurrent } from '../exception-registry.js';
import { prePushPlan } from '../orchestration/execution-plans.js';

const ZERO_SHA = /^0+$/;

function loadConfigAtRevision(root, revision) {
  const result = runGit(
    ['show', `${revision}:${CONFIG_FILE}`],
    { allowFailure: true, cwd: root },
  );
  if (result.status !== 0) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Unable to parse ${CONFIG_FILE} from pushed commit ${revision.slice(0, 12)}: `
      + error.message,
    );
  }
  const config = validateConfig(parsed, CONFIG_FILE);
  assertExceptionRegistryCurrent(config.exceptions);
  return config;
}

function usesPrePushGate(config) {
  return config?.accessibilityTest.enabled
    || config?.typeCheck.enabled
    || config?.unitTest.enabled
    || config?.architecture.enabled
    || config?.build.enabled
    || config?.lighthouse.enabled;
}

function assertExactPushSnapshot(root, revision) {
  const head = gitValue(['rev-parse', '--verify', 'HEAD'], '', root);
  const pushedCommit = gitValue(
    ['rev-parse', '--verify', `${revision}^{commit}`],
    '',
    root,
  );
  if (!head || !pushedCommit || head !== pushedCommit) {
    throw new Error([
      'Pre-push quality gates can only verify the currently checked-out HEAD.',
      `Pushed commit: ${(pushedCommit || revision).slice(0, 12)}; `
      + `checked-out HEAD: ${head.slice(0, 12) || 'unknown'}.`,
      'Check out the branch being pushed and push it separately.',
    ].join('\n'));
  }

  const status = runGit(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root },
  ).stdout.trim();
  if (status) {
    const changed = status.split(/\r?\n/).slice(0, 10);
    throw new Error([
      'Pre-push quality gates require a clean working tree so they test the exact pushed commit.',
      ...changed.map((line) => `- ${line}`),
      ...(status.split(/\r?\n/).length > changed.length ? ['- ...'] : []),
      'Commit, stash, or remove these changes, then push again.',
    ].join('\n'));
  }
}

function resolvePushConfig(root, input) {
  if (!String(input || '').trim()) {
    return { config: loadConfig(root), skip: false };
  }

  const updates = parsePrePushUpdates(input)
    .filter(({ localSha }) => !ZERO_SHA.test(localSha));
  if (updates.length === 0) {
    return {
      config: null,
      skip: true,
      skipMessage: 'only deleted refs were supplied',
    };
  }

  const revisions = [...new Set(updates.map(({ localSha }) => localSha))];
  const revisionConfigs = revisions.map((revision) => ({
    config: loadConfigAtRevision(root, revision),
    revision,
  }));
  const gated = revisionConfigs.filter(({ config }) => usesPrePushGate(config));
  if (gated.length === 0) {
    const config = revisionConfigs.find((entry) => entry.config)?.config;
    if (!config) {
      return {
        config: null,
        skip: true,
        skipMessage: `pushed commits do not contain ${CONFIG_FILE}`,
      };
    }
    return { config, skip: false };
  }
  if (revisions.length !== 1) {
    throw new Error(
      'Pre-push quality gates cannot safely verify multiple different commits at once. '
      + 'Push each branch or tag separately.',
    );
  }

  assertExactPushSnapshot(root, revisions[0]);
  return { config: revisionConfigs[0].config, skip: false };
}

export function runPrePush(cwd = process.cwd(), {
  input = '',
  remoteName = 'origin',
} = {}) {
  const root = findRepositoryRoot(cwd);
  const resolved = resolvePushConfig(root, input);
  if (resolved.skip) {
    console.log(`repo-guard pre-push: ${resolved.skipMessage}; quality gates skipped.`);
    return 0;
  }
  const { config } = resolved;

  for (const step of prePushPlan.steps) {
    let exitCode = 0;
    switch (step.id) {
      case 'quality.typecheck':
        if (config.typeCheck.enabled) exitCode = runTypeCheckGate({ root, config: config.typeCheck });
        else console.log('repo-guard pre-push: TypeScript type check is disabled.');
        break;
      case 'quality.unit-test':
        if (config.unitTest.enabled) exitCode = runUnitTestGate({ root, config: config.unitTest, changes: collectPrePushChanges({ input, remoteName, root }) });
        else console.log('repo-guard pre-push: unit tests are disabled.');
        break;
      case 'quality.accessibility-test':
        if (config.accessibilityTest.enabled) exitCode = runAccessibilityTestGate({ root, config: config.accessibilityTest });
        else console.log('repo-guard pre-push: accessibility tests are disabled.');
        break;
      case 'quality.architecture':
        if (config.architecture.enabled) exitCode = runArchitectureGate({ root, config: config.architecture });
        else console.log('repo-guard pre-push: architecture dependency gate is disabled.');
        break;
      case 'quality.build':
        if (config.build.enabled) exitCode = runBuildGate({ root, config: config.build });
        else console.log('repo-guard pre-push: project build is disabled.');
        break;
      case 'quality.lighthouse':
        if (config.lighthouse.enabled) {
          const buildAlreadyRan = config.build.enabled
            && config.lighthouse.buildScript === config.build.script;
          exitCode = runVueLighthouse({ root, config: config.lighthouse, skipBuild: buildAlreadyRan });
        } else console.log('repo-guard pre-push: Lighthouse is disabled.');
        break;
      default:
        throw new Error(`Unsupported pre-push execution step: ${step.id}`);
    }
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}
