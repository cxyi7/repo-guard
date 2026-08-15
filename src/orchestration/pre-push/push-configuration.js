import { loadConfig } from '../../config/configuration-loader.js';
import { validateConfig } from '../../config/configuration-validation.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError, rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue, runGit } from '../../git/execution.js';
import { assertExceptionRegistryCurrent } from '../../policies/exception-registry.js';
import { parsePrePushUpdates } from './change-range.js';

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

export function resolvePushConfig(root, input) {
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
