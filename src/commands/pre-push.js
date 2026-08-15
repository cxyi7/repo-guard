import { CONFIG_FILE, loadConfig, validateConfig } from '../config.js';
import { configurationError, internalError, rangeError } from '../core/error/repo-guard-error.js';
import { findRepositoryRoot, gitValue, runGit } from '../git.js';
import {
  collectPrePushChanges,
  parsePrePushUpdates,
} from '../orchestration/pre-push/change-range.js';
import { assertExceptionRegistryCurrent } from '../policies/exception-registry.js';
import {
  createChangeSet,
  createGateContext,
} from '../core/capability/gate-context.js';
import { gateStatusToExitCode } from '../core/result/gate-result.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../core/report/console-renderer.js';
import { gateRegistry } from '../gates/registry.js';
import { prePushPlan } from '../orchestration/execution-plans.js';
import { orchestratePlan } from '../orchestration/orchestrator.js';

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
    throw configurationError(
      'pre-push/invalid-pushed-config',
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
    throw rangeError('pre-push/snapshot-mismatch', [
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
    throw rangeError('pre-push/dirty-working-tree', [
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
    throw rangeError(
      'pre-push/multiple-revisions',
      'Pre-push quality gates cannot safely verify multiple different commits at once. '
      + 'Push each branch or tag separately.',
    );
  }

  assertExactPushSnapshot(root, revisions[0]);
  return { config: revisionConfigs[0].config, skip: false };
}

export async function runPrePush(cwd = process.cwd(), {
  input = '',
  remoteName = 'origin',
} = {}) {
  const root = findRepositoryRoot(cwd);
  const resolved = resolvePushConfig(root, input);
  if (resolved.skip) {
    writeConsoleMessage(`repo-guard pre-push: ${resolved.skipMessage}; quality gates skipped.`);
    return gateStatusToExitCode('skipped');
  }
  const { config } = resolved;
  const changeSet = createChangeSet({
    source: 'pre-push',
    changes: collectPrePushChanges({ input, remoteName, root }),
  });
  const context = createGateContext({
    root,
    environment: prePushPlan.environment,
    config,
    changes: changeSet,
  });
  const execution = await orchestratePlan({
    plan: prePushPlan,
    registry: gateRegistry,
    context,
    stopOnFailure: true,
    executeStep: async ({ context: stepContext, gate, step }) => {
      switch (step.id) {
      case 'quality.typecheck':
      case 'quality.unit-test':
      case 'quality.accessibility-test':
      case 'quality.architecture':
      case 'quality.build':
      case 'quality.lighthouse':
        {
          const gatePlan = await gate.plan(stepContext);
          return await gate.run({ ...stepContext, plan: gatePlan });
        }
      default:
        throw internalError(
          'pre-push/unsupported-plan-step',
          `Unsupported pre-push execution step: ${step.id}`,
        );
      }
    },
    onResult: ({ result, step }) => writeGateResultConsole(result, { label: step.id }),
  });
  return execution.exitCode;
}
