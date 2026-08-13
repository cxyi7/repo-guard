import { readFileSync } from 'node:fs';
import { runCheck } from './commands/check.js';
import { runCiCommand } from './commands/ci.js';
import { runDisable, runEnable, runMigrate } from './commands/configure.js';
import { runDoctor } from './commands/doctor.js';
import { gateRegistry } from './gates/registry.js';
import {
  runExternalManualGate,
  runRegisteredManualGate,
} from './orchestration/cli/manual-gates.js';
import { gateResultToExitCode, gateStatusToExitCode } from './core/result/gate-result.js';
import { runGate } from './commands/gate.js';
import { runHookMessage } from './commands/hook-message.js';
import { runInit, runInstallHooks } from './commands/init.js';
import { runInstallCiCommand } from './commands/install-ci.js';
import { runPrePush } from './commands/pre-push.js';
import {
  runLintFiles,
  runPreCommit,
  runQualityFileCommand,
} from './commands/pre-commit.js';

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
  'notification',
  'ci',
].join('|');

const HELP_TEXT = `
repo-guard - protected repository file guard

Usage:
  repo-guard init
  repo-guard install-hooks
  repo-guard migrate
  repo-guard enable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard disable <${CONFIGURABLE_FEATURE_HELP}> [...]
  repo-guard doctor [--fix|--ci]
  repo-guard install-ci --provider gitlab [--profile policy|full|release-ready] [--stage <name>] [--dry-run]
  repo-guard ci [--profile policy|full|release-ready] [--base <sha>] [--head <sha>] [--report-json <path>]
${EARLY_MANUAL_HELP}
  repo-guard check
  repo-guard gate [--dry-run] [--force-notify]
  repo-guard dry-run
  repo-guard pre-commit
  repo-guard pre-push
  repo-guard external <project.gate-id>
${REGISTERED_MANUAL_HELP}
  repo-guard hook-message <prepare|finalize|cleanup> [hook arguments]

Exit codes:
  0  success
  1  configuration or execution failure
  2  policy violation or protected working tree changes
  3  CI revision range cannot be trusted
`.trim();

function ensureSupportedOptions(argumentsList, supported) {
  const unknown = argumentsList.filter((argument) => argument.startsWith('-') && !supported.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unsupported option(s): ${unknown.join(', ')}`);
  }
}

function parseValuedOptions(argumentsList, { flags, values }) {
  const parsed = { flags: new Set(), values: {} };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (flags.has(argument)) {
      parsed.flags.add(argument);
      continue;
    }
    if (values.has(argument)) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
      parsed.values[argument] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option or argument: ${argument}`);
  }
  return parsed;
}

export async function runCli(argumentsList) {
  const [command = 'help', ...rest] = argumentsList;

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP_TEXT);
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
      case 'pre-commit':
        ensureSupportedOptions(rest, new Set());
        return await runPreCommit();
      case 'pre-push':
        return await runPrePush(process.cwd(), {
          input: process.stdin.isTTY ? '' : readFileSync(0, 'utf8'),
          remoteName: rest[0] || 'origin',
        });
      case 'lint-files':
        return await runLintFiles(rest);
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
          throw new Error('external requires one project.<kebab-case> gate id');
        }
        const result = await runExternalManualGate(rest[0]);
        return gateResultToExitCode(result);
      }
      default:
        if (gateRegistry.findByManualCommand(command)) {
          const gate = gateRegistry.findByManualCommand(command);
          ensureSupportedOptions(rest, new Set(gate.manualOptions));
          const result = await runRegisteredManualGate(command, rest);
          return gateResultToExitCode(result);
        }
        throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    }
  } catch (error) {
    console.error(`repo-guard failed: ${error.message}`);
    return gateStatusToExitCode('execution-error');
  }
}
