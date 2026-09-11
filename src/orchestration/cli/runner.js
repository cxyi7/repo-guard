import { runAnimationPreview } from './animation-preview.js';
import { readFileSync } from 'node:fs';
import { runCheck } from './check.js';
import { runCiCommand } from '../ci/command.js';
import { runGitLabCiNotification } from '../../operations/notifications/gitlab-ci-notification.js';
import { runDisable, runEnable } from './configuration.js';
import { runDoctor } from '../doctor/runner.js';
import { gateRegistry } from '../../gates/registry.js';
import {
  runExternalManualGate,
  runRegisteredManualGate,
} from './manual-gates.js';
import {
  ensureSupportedOptions,
  parseValuedOptions,
  extractProjectOption,
} from './argument-parsing.js';
import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult, gateResultToExitCode } from '../../core/result/gate-result.js';
import { EXIT_CODES, validateExitCode } from '../../core/result/exit-code.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { runGate } from './gate.js';
import { runHookMessage } from '../commit-message/runner.js';
import { runInstallHooks } from './install-hooks.js';
import { runInit } from '../setup/project-initialization.js';
import { runInstallCiCommand } from './install-ci.js';
import { runPrePush } from '../pre-push/runner.js';
import { runQualityFileArguments } from '../pre-commit/quality-command.js';
import { runPreCommit } from '../pre-commit/runner.js';
import { runGuardedBuild } from './guarded-build.js';
import { runApiPerformanceRunner } from './api-performance-runner.js';
import { runK6Runner } from './k6-runner.js';
import { runDeadCodeBaseline } from './dead-code-baseline.js';
import { runBuildArtifactBaseline } from './build-artifact-baseline.js';
import { runImageOptimize } from './image-optimize.js';
import { runOperations } from './operations.js';
import { runDeliveryCommand } from './delivery.js';

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
  'commitAnimation',
  'ci',
].join('|');

const HELP_TEXT = `
repo-guard - 仓库保护门禁

用法：
  repo-guard init --project <id> --role frontend|backend --stack node|java --preset <preset>
  repo-guard install-hooks
  repo-guard enable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard disable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard doctor [--fix|--ci]
  repo-guard install-ci --provider gitlab [--profile policy|full|release-ready] [--stage <name>] [--dry-run]
  repo-guard ci [--profile policy|full|release-ready] [--base <sha>] [--head <sha>] [--report-json <path>]
  repo-guard ci-notify [--status success|failed|canceled]
  repo-guard ops plan
  repo-guard ops install [--dry-run]
  repo-guard delivery <init|keygen|bind|enable|disable|approve|check|run|import|integrate|feedback|status|accept|verify> [选项]
${EARLY_MANUAL_HELP}
  repo-guard check
  repo-guard gate [--dry-run] [--force-notify]
  repo-guard dry-run
  repo-guard pre-commit
  repo-guard animation-preview [--theme cat|dog] [--type feat|fix|docs|style|refactor|perf|test|build|ci|chore] [--egg auto|none|meteor|butterfly|fireworks] [--fail] [--plain]
  repo-guard pre-push
  repo-guard external <project.gate-id>
  repo-guard api-performance-runner --gate-id <project.gate-id> --config <path>
  repo-guard k6-runner --gate-id <project.gate-id> --config <path>
  repo-guard guarded-build <npm-script>
  repo-guard dead-code-baseline <init|prune>
  repo-guard build-artifact-baseline <init|prune>
  repo-guard image-optimize [--project <id>] [--to webp] [--write] [--allow-lossy] -- <paths...>
${REGISTERED_MANUAL_HELP}
  repo-guard hook-message <prepare|finalize|cleanup|success> [hook arguments]

应用选择：
  doctor、ci、enable、disable 和应用检查支持 --project <id>。
  多应用工作区中的提交与推送只检查受影响的应用；release-ready 检查全部必需目标。
  delivery 独立于工程检查，可用于 Node、Java、Python 仓库；详细选项见交付合同文档。
  预设：vue-javascript、vue-typescript、node-javascript、node-typescript、java-maven。

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
  return EXIT_CODES.success;
};

function projectDeclaration(argumentsList, projectId) {
  const { values } = valuedOptions(argumentsList, ['--role', '--stack', '--preset']);
  if (projectId === undefined && Object.keys(values).length === 0) return undefined;
  return { id: projectId, role: values['--role'], stack: values['--stack'], preset: values['--preset'] };
}

const COMMAND_HANDLERS = Object.freeze({
  delivery: (argumentsList) => runDeliveryCommand(argumentsList),
  help: helpCommand,
  '--help': helpCommand,
  '-h': helpCommand,
  init: (argumentsList, { projectId }) => runInit(process.cwd(), {
    project: projectDeclaration(argumentsList, projectId),
  }),
  'install-hooks': withoutOptions(runInstallHooks),
  enable: async (argumentsList, options) => {
    ensureSupportedOptions(argumentsList, new Set());
    return runEnable(argumentsList, process.cwd(), options);
  },
  disable: async (argumentsList, options) => {
    ensureSupportedOptions(argumentsList, new Set());
    return runDisable(argumentsList, process.cwd(), options);
  },
  doctor: async (argumentsList, { projectId }) => {
    ensureSupportedOptions(argumentsList, new Set(['--fix', '--ci']));
    return runDoctor(process.cwd(), {
      fix: argumentsList.includes('--fix'),
      ci: argumentsList.includes('--ci'),
      projectId,
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
      profile: options.values['--profile'],
      stage: options.values['--stage'] || null,
      dryRun: options.flags.has('--dry-run'),
    });
  },
  ci: async (argumentsList, { projectId }) => {
    const options = valuedOptions(argumentsList, ['--profile', '--base', '--head', '--report-json']);
    return runCiCommand(process.cwd(), {
      profile: options.values['--profile'],
      base: options.values['--base'] || null,
      head: options.values['--head'] || null,
      reportPath: options.values['--report-json'],
      projectId,
    });
  },
  'ci-notify': async (argumentsList) => {
    const options = valuedOptions(argumentsList, ['--status']);
    return runGitLabCiNotification({
      status: options.values['--status'] || null,
      write: writeConsoleMessage,
    });
  },
  'animation-preview': (argumentsList) => runAnimationPreview(argumentsList),
  'pre-commit': withoutOptions(runPreCommit),
  'pre-push': async (argumentsList) => runPrePush(process.cwd(), {
    input: process.stdin.isTTY ? '' : readFileSync(0, 'utf8'),
    remoteName: argumentsList[0] || 'origin',
  }),
  'quality-files': (argumentsList) => runQualityFileArguments(argumentsList),
  check: withoutOptions(runCheck),
  gate: async (argumentsList) => {
    ensureSupportedOptions(argumentsList, new Set(['--dry-run', '--force-notify']));
    return runGate({
      dryRun: argumentsList.includes('--dry-run'),
      forceNotify: argumentsList.includes('--force-notify'),
    });
  },
  'dry-run': withoutOptions(() => runGate({ dryRun: true })),
  'hook-message': (argumentsList) => runHookMessage(argumentsList),
  external: async (argumentsList, options) => {
    const gateId = requireSingleArgument(argumentsList, {
      code: 'cli/invalid-external-gate-arguments',
      message: 'external 命令需要一个 project.<kebab-case> 门禁 id',
    });
    return gateResultToExitCode(await runExternalManualGate(gateId, process.cwd(), options));
  },
  'api-performance-runner': async (argumentsList, { projectId }) => {
    const options = valuedOptions(argumentsList, ['--gate-id', '--config']);
    return runApiPerformanceRunner({
      gateId: options.values['--gate-id'],
      configFile: options.values['--config'],
      projectId,
    });
  },
  'k6-runner': async (argumentsList, { projectId }) => {
    const options = valuedOptions(argumentsList, ['--gate-id', '--config']);
    return runK6Runner({
      gateId: options.values['--gate-id'],
      configFile: options.values['--config'],
      projectId,
    });
  },
  'guarded-build': async (argumentsList, options) => runGuardedBuild(requireSingleArgument(argumentsList, {
    code: 'cli/invalid-guarded-build-arguments',
    message: 'guarded-build 命令需要一个已在 mutationTest.guardedBuilds 中声明的 npm 脚本名称',
  }), options),
  'dead-code-baseline': async (argumentsList, options) => runDeadCodeBaseline(requireSingleArgument(argumentsList, {
    allowed: ['init', 'prune'],
    code: 'cli/invalid-dead-code-baseline-arguments',
    message: 'dead-code-baseline 命令需要 init 或 prune',
  }), process.cwd(), options),
  'build-artifact-baseline': async (argumentsList, options) => runBuildArtifactBaseline(requireSingleArgument(argumentsList, {
    allowed: ['init', 'prune'],
    code: 'cli/invalid-build-artifact-baseline-arguments',
    message: 'build-artifact-baseline 命令需要 init 或 prune',
  }), process.cwd(), options),
  ops: (argumentsList) => {
    const [command, ...rest] = argumentsList;
    const options = valuedOptions(rest, [], ['--dry-run']);
    return runOperations(command, process.cwd(), { dryRun: options.flags.has('--dry-run') });
  },
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
      ['--to', '--project'],
      ['--write', '--allow-lossy'],
    );
    return runImageOptimize({
      paths: argumentsList.slice(delimiter + 1),
      projectId: options.values['--project'],
      to: options.values['--to'] ?? null,
      write: options.flags.has('--write'),
      allowLossy: options.flags.has('--allow-lossy'),
    });
  },
});

async function runKnownCommand(command, argumentsList) {
  const gate = gateRegistry.findByManualCommand(command);
  const scopedCommands = new Set([
    'init', 'enable', 'disable', 'doctor', 'ci', 'external',
    'guarded-build', 'dead-code-baseline', 'build-artifact-baseline',
    'api-performance-runner', 'k6-runner',
  ]);
  const selection = gate || scopedCommands.has(command)
    ? extractProjectOption(argumentsList)
    : { argumentsList, projectId: undefined };
  argumentsList = selection.argumentsList;
  const handler = COMMAND_HANDLERS[command];
  if (handler) return await handler(argumentsList, { projectId: selection.projectId });
  if (gate) {
    ensureSupportedOptions(argumentsList, new Set(gate.manualOptions));
    return gateResultToExitCode(await runRegisteredManualGate(command, argumentsList, process.cwd(), {
      projectId: selection.projectId,
    }));
  }
  throw configurationError('cli/unknown-command', `未知命令： ${command}\n\n${HELP_TEXT}`);
}

export async function runCli(argumentsList) {
  const [command = 'help', ...rest] = argumentsList;

  try {
    return validateExitCode(await runKnownCommand(command, rest));
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
