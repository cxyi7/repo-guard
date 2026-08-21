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
  repo-guard guarded-build <npm-script>
${REGISTERED_MANUAL_HELP}
  repo-guard hook-message <prepare|finalize|cleanup> [hook arguments]

退出码：
  0  成功
  1  配置错误或执行失败
  2  策略违规或工作树中存在受保护的变更
  3  CI 版本范围不可信
`.trim();

export async function runCli(argumentsList) {
  const [command = 'help', ...rest] = argumentsList;

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        writeConsoleMessage(HELP_TEXT);
        return 0;
      case 'init':
        ensureSupportedOptions(rest, new Set());
        return runInit();
      case 'install-hooks':
        ensureSupportedOptions(rest, new Set());
        return runInstallHooks();
      case 'migrate':
        ensureSupportedOptions(rest, new Set());
        return runMigrate();
      case 'enable':
        ensureSupportedOptions(rest, new Set());
        return runEnable(rest);
      case 'disable':
        ensureSupportedOptions(rest, new Set());
        return runDisable(rest);
      case 'doctor':
        ensureSupportedOptions(rest, new Set(['--fix', '--ci']));
        return runDoctor(process.cwd(), {
          fix: rest.includes('--fix'),
          ci: rest.includes('--ci'),
        });
      case 'install-ci': {
        const options = parseValuedOptions(rest, {
          flags: new Set(['--dry-run']),
          values: new Set(['--provider', '--profile', '--stage']),
        });
        return runInstallCiCommand(process.cwd(), {
          provider: options.values['--provider'],
          profile: options.values['--profile'] || 'policy',
          stage: options.values['--stage'] || null,
          dryRun: options.flags.has('--dry-run'),
        });
      }
      case 'ci': {
        const options = parseValuedOptions(rest, {
          flags: new Set(),
          values: new Set(['--profile', '--base', '--head', '--report-json']),
        });
        return await runCiCommand(process.cwd(), {
          profile: options.values['--profile'],
          base: options.values['--base'] || null,
          head: options.values['--head'] || null,
          reportPath: options.values['--report-json'],
        });
      }
      case 'ci-notify': {
        const options = parseValuedOptions(rest, {
          flags: new Set(),
          values: new Set(['--status']),
        });
        return await runGitLabCiNotification({
          status: options.values['--status'] || null,
          write: writeConsoleMessage,
        });
      }
      case 'pre-commit':
        ensureSupportedOptions(rest, new Set());
        return await runPreCommit();
      case 'pre-push':
        return await runPrePush(process.cwd(), {
          input: process.stdin.isTTY ? '' : readFileSync(0, 'utf8'),
          remoteName: rest[0] || 'origin',
        });
      case 'quality-files':
        return await runQualityFileCommand(rest);
      case 'check':
        ensureSupportedOptions(rest, new Set());
        return runCheck();
      case 'gate': {
        const supported = new Set(['--dry-run', '--force-notify']);
        ensureSupportedOptions(rest, supported);
        return await runGate({
          dryRun: rest.includes('--dry-run'),
          forceNotify: rest.includes('--force-notify'),
        });
      }
      case 'dry-run':
        ensureSupportedOptions(rest, new Set());
        return await runGate({ dryRun: true });
      case 'hook-message':
        return runHookMessage(rest);
      case 'external': {
        if (rest.length !== 1 || rest[0].startsWith('-')) {
          throw configurationError(
            'cli/invalid-external-gate-arguments',
            'external 命令需要一个 project.<kebab-case> 门禁 id',
          );
        }
        const result = await runExternalManualGate(rest[0]);
        return gateResultToExitCode(result);
      }
      case 'guarded-build': {
        if (rest.length !== 1 || rest[0].startsWith('-')) {
          throw configurationError(
            'cli/invalid-guarded-build-arguments',
            'guarded-build 命令需要一个已在 mutationTest.guardedBuilds 中声明的 npm 脚本名称',
          );
        }
        return await runGuardedBuild(rest[0]);
      }
      default:
        if (gateRegistry.findByManualCommand(command)) {
          const gate = gateRegistry.findByManualCommand(command);
          ensureSupportedOptions(rest, new Set(gate.manualOptions));
          const result = await runRegisteredManualGate(command, rest);
          return gateResultToExitCode(result);
        }
        throw configurationError('cli/unknown-command', `未知命令： ${command}\n\n${HELP_TEXT}`);
    }
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
