import { readFileSync } from 'node:fs';
import { runCheck } from './check.js';
import { runCiCommand } from '../ci/command.js';
import { runGitLabCiNotification } from '../../gates/release/gitlab-ci-notification.js';
import { runDisable, runEnable, runMigrate } from './configuration.js';
import { runDoctor } from '../doctor/runner.js';
import { gateRegistry } from '../../gates/registry.js';
import {
  runExternalManualGate,
  runRegisteredManualGate,
} from './manual-gates.js';
import {
  ensureSupportedOptions,
  parseValuedOptions,
} from './argument-parsing.js';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateResultToExitCode } from '../../core/result/gate-result.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { runGate } from './gate.js';
import { runHookMessage } from '../commit-message/runner.js';
import { runInstallHooks } from './install-hooks.js';
import { runInit } from '../setup/project-initialization.js';
import { runInstallCiCommand } from './install-ci.js';
import { runPrePush } from '../pre-push/runner.js';
import { runQualityFileCommand } from '../pre-commit/quality-command.js';
import { runPreCommit } from '../pre-commit/runner.js';
import { runGuardedBuild } from './guarded-build.js';
import { runApiPerformanceRunner } from './api-performance-runner.js';
import { runK6Runner } from './k6-runner.js';
import { runDeadCodeBaseline } from './dead-code-baseline.js';
import { runBuildArtifactBaseline } from './build-artifact-baseline.js';
import { runImageOptimize } from './image-optimize.js';

const registeredManualGates = gateRegistry.all
  .filter(({ manualCommand }) => manualCommand)
  .sort((left, right) => left.manualOrder - right.manualOrder);
const EARLY_MANUAL_HELP = registeredManualGates
  .filter(({ manualOrder }) => manualOrder < 30)
  .map(({ manualCommand }) => `  repo-guard ${manualCommand}`)
  .join('\n');
const REGISTERED_MANUAL_HELP = registeredManualGates
  .filter(({ manualOrder }) => manualOrder >= 30)
  .map(({ manualCommand, manualOptions }) => (
    `  repo-guard ${manualCommand}${manualOptions.length > 0 ? ` [${manualOptions.join('|')}]` : ''}`
  ))
  .join('\n');
const CONFIGURABLE_FEATURE_HELP = [
  ...gateRegistry.configurable.map(({ featureName }) => featureName),
  'componentInteraction',
  'coverage',
  'fileHeader',
  'functionDocs',
  'notification',
  'ci',
].join('|');

const HELP_TEXT = `
repo-guard - 仓库保护门禁

用法：
  repo-guard init
  repo-guard install-hooks
  repo-guard migrate
  repo-guard enable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard disable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard doctor [--fix|--ci]
  repo-guard install-ci --provider gitlab [--profile policy|full|release-ready] [--stage <name>] [--dry-run]
  repo-guard ci [--profile policy|full|release-ready] [--base <sha>] [--head <sha>] [--report-json <path>]
  repo-guard ci-notify [--status success|failed|canceled]
${EARLY_MANUAL_HELP}
  repo-guard check
  repo-guard gate [--dry-run] [--force-notify]
  repo-guard dry-run
  repo-guard pre-commit
  repo-guard pre-push
  repo-guard external <project.gate-id>
  repo-guard api-performance-runner --gate-id <project.gate-id> --config <path>
  repo-guard k6-runner --gate-id <project.gate-id> --config <path>
  repo-guard guarded-build <npm-script>
  repo-guard dead-code-baseline <init|prune>
  repo-guard build-artifact-baseline <init|prune>
  repo-guard image-optimize [--to webp] [--write] [--allow-lossy] -- <paths...>
${REGISTERED_MANUAL_HELP}
  repo-guard hook-message <prepare|finalize|cleanup> [hook arguments]

退出码：
  0  成功
  1  配置错误或执行失败
  2  策略违规或工作树中存在受保护的变更
  3  CI 版本范围不可信
`.trim();

function withoutOptions(action) {
  return async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set());
    return await action();
  };
}

function valuedOptions(argumentsList, values, flags = []) {
  return parseValuedOptions(argumentsList, {
    flags: new Set(flags),
    values: new Set(values),
  });
}

function requireSingleArgument(argumentsList, { allowed = null, code, message }) {
  const [value] = argumentsList;
  if (
    argumentsList.length !== 1
    || value.startsWith('-')
    || (allowed && !allowed.includes(value))
  ) {
    throw configurationError(code, message);
  }
  return value;
}

const helpCommand = () => {
  writeConsoleMessage(HELP_TEXT);
  return 0;
};

const COMMAND_HANDLERS = Object.freeze({
  help: helpCommand,
  '--help': helpCommand,
  '-h': helpCommand,
  init: withoutOptions(runInit),
  'install-hooks': withoutOptions(runInstallHooks),
  migrate: withoutOptions(runMigrate),
  enable: async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set());
    return runEnable(argumentsList);
  },
  disable: async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set());
    return runDisable(argumentsList);
  },
  doctor: async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set(['--fix', '--ci']));
    return runDoctor(process.cwd(), {
      fix: argumentsList.includes('--fix'),
      ci: argumentsList.includes('--ci'),
    });
  },
  'install-ci': async (argumentsList) => {
    const options = valuedOptions(
      argumentsList,
      ['--provider', '--profile', '--stage'],
      ['--dry-run'],
    );
    return runInstallCiCommand(process.cwd(), {
      provider: options.values['--provider'],
      profile: options.values['--profile'] || 'policy',
      stage: options.values['--stage'] || null,
      dryRun: options.flags.has('--dry-run'),
    });
  },
  ci: async (argumentsList) => {
    const options = valuedOptions(argumentsList, ['--profile', '--base', '--head', '--report-json']);
    return runCiCommand(process.cwd(), {
      profile: options.values['--profile'],
      base: options.values['--base'] || null,
      head: options.values['--head'] || null,
      reportPath: options.values['--report-json'],
    });
  },
  'ci-notify': async (argumentsList) => {
    const options = valuedOptions(argumentsList, ['--status']);
    return runGitLabCiNotification({
      status: options.values['--status'] || null,
      write: writeConsoleMessage,
    });
  },
  'pre-commit': withoutOptions(runPreCommit),
  'pre-push': async (argumentsList) => runPrePush(process.cwd(), {
    input: process.stdin.isTTY ? '' : readFileSync(0, 'utf8'),
    remoteName: argumentsList[0] || 'origin',
  }),
  'quality-files': runQualityFileCommand,
  check: withoutOptions(runCheck),
  gate: async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set(['--dry-run', '--force-notify']));
    return runGate({
      dryRun: argumentsList.includes('--dry-run'),
      forceNotify: argumentsList.includes('--force-notify'),
    });
  },
  'dry-run': withoutOptions(() => runGate({ dryRun: true })),
  'hook-message': runHookMessage,
  external: async (argumentsList) => {
    const gateId = requireSingleArgument(argumentsList, {
      code: 'cli/invalid-external-gate-arguments',
      message: 'external 命令需要一个 project.<kebab-case> 门禁 id',
    });
    return gateResultToExitCode(await runExternalManualGate(gateId));
  },
  'api-performance-runner': async (argumentsList) => {
    const options = valuedOptions(argumentsList, ['--gate-id', '--config']);
    return runApiPerformanceRunner({
      gateId: options.values['--gate-id'],
      configFile: options.values['--config'],
    });
  },
  'k6-runner': async (argumentsList) => {
    const options = valuedOptions(argumentsList, ['--gate-id', '--config']);
    return runK6Runner({
      gateId: options.values['--gate-id'],
      configFile: options.values['--config'],
    });
  },
  'guarded-build': async (argumentsList) => runGuardedBuild(requireSingleArgument(argumentsList, {
    code: 'cli/invalid-guarded-build-arguments',
    message: 'guarded-build 命令需要一个已在 mutationTest.guardedBuilds 中声明的 npm 脚本名称',
  })),
  'dead-code-baseline': async (argumentsList) => runDeadCodeBaseline(requireSingleArgument(argumentsList, {
    allowed: ['init', 'prune'],
    code: 'cli/invalid-dead-code-baseline-arguments',
    message: 'dead-code-baseline 命令需要 init 或 prune',
  })),
  'build-artifact-baseline': async (argumentsList) => runBuildArtifactBaseline(requireSingleArgument(argumentsList, {
    allowed: ['init', 'prune'],
    code: 'cli/invalid-build-artifact-baseline-arguments',
    message: 'build-artifact-baseline 命令需要 init 或 prune',
  })),
  'image-optimize': async (argumentsList) => {
    const delimiter = argumentsList.indexOf('--');
    if (delimiter < 0) {
      throw configurationError(
        'cli/image-optimize-path-delimiter-required',
        'image-optimize 必须使用 -- 分隔选项和图片路径',
      );
    }
    const options = valuedOptions(
      argumentsList.slice(0, delimiter),
      ['--to'],
      ['--write', '--allow-lossy'],
    );
    return runImageOptimize({
      paths: argumentsList.slice(delimiter + 1),
      to: options.values['--to'] ?? null,
      write: options.flags.has('--write'),
      allowLossy: options.flags.has('--allow-lossy'),
    });
  },
});

async function runKnownCommand(command, argumentsList) {
  const handler = COMMAND_HANDLERS[command];
  if (handler) return await handler(argumentsList);
  const gate = gateRegistry.findByManualCommand(command);
  if (gate) {
    ensureSupportedOptions(argumentsList, new Set(gate.manualOptions));
    return gateResultToExitCode(await runRegisteredManualGate(command, argumentsList));
  }
  throw configurationError('cli/unknown-command', `未知命令： ${command}\n\n${HELP_TEXT}`);
}

export async function runCli(argumentsList) {
  const [command = 'help', ...rest] = argumentsList;

  try {
    return await runKnownCommand(command, rest);
  } catch (error) {
    const typedError = toRepoGuardError(error, {
      kind: 'execution',
      code: 'cli/command-failed',
    });
    const result = createGateResult({
      gateId: 'repo-guard.cli',
      status: errorStatus(typedError),
      summary: typedError.message,
      error: typedError,
    });
    writeGateResultConsole(result, { label: 'repo-guard' });
    return gateResultToExitCode(result);
  }
}
