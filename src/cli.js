import { runCheck } from './commands/check.js';
import { runDoctor } from './commands/doctor.js';
import { runGate } from './commands/gate.js';
import { runHookMessage } from './commands/hook-message.js';
import { runInit, runInstallHooks } from './commands/init.js';
import {
  runLintFiles,
  runPreCommit,
  runQualityFileCommand,
} from './commands/pre-commit.js';

const HELP_TEXT = `
repo-guard - protected repository file guard

Usage:
  repo-guard init
  repo-guard install-hooks
  repo-guard doctor
  repo-guard check
  repo-guard gate [--dry-run] [--force-notify]
  repo-guard dry-run
  repo-guard pre-commit
  repo-guard hook-message <prepare|finalize|cleanup> [hook arguments]

Exit codes:
  0  success
  1  configuration or execution failure
  2  protected working tree changes found by "check"
`.trim();

function ensureSupportedOptions(argumentsList, supported) {
  const unknown = argumentsList.filter((argument) => argument.startsWith('-') && !supported.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unsupported option(s): ${unknown.join(', ')}`);
  }
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
      case 'doctor':
        ensureSupportedOptions(rest, new Set());
        return runDoctor();
      case 'pre-commit':
        ensureSupportedOptions(rest, new Set());
        return await runPreCommit();
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
      default:
        throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    }
  } catch (error) {
    console.error(`repo-guard failed: ${error.message}`);
    return 1;
  }
}
