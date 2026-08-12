import { readFileSync } from 'node:fs';
import { runArchitectureCommand } from './commands/architecture.js';
import { runBuildCommand } from './commands/build.js';
import { runCheck } from './commands/check.js';
import { runDisable, runEnable, runMigrate } from './commands/configure.js';
import { runDoctor } from './commands/doctor.js';
import { runDependenciesCommand } from './commands/dependencies.js';
import { runExceptionsCommand } from './commands/exceptions.js';
import { runFilePlacementCommand } from './commands/file-placement.js';
import { runGate } from './commands/gate.js';
import { runHookMessage } from './commands/hook-message.js';
import { runInit, runInstallHooks } from './commands/init.js';
import { runLighthouseCommand } from './commands/lighthouse.js';
import { runPrePush } from './commands/pre-push.js';
import { runTargetBlankCommand } from './commands/target-blank.js';
import { runTypeCheckCommand } from './commands/typecheck.js';
import { runUnitTestCommand } from './commands/unit-test.js';
import { runUnsafeHtmlCommand } from './commands/unsafe-html.js';
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
  repo-guard migrate
  repo-guard enable <eslint|prettier|stylelint|maxFileLines|filePlacement|dependencies|architecture|typeCheck|unitTest|coverage|build|lighthouse|notification> [...]
  repo-guard disable <eslint|prettier|stylelint|maxFileLines|filePlacement|dependencies|architecture|typeCheck|unitTest|coverage|build|lighthouse|notification> [...]
  repo-guard doctor [--fix]
  repo-guard exceptions
  repo-guard dependencies
  repo-guard check
  repo-guard gate [--dry-run] [--force-notify]
  repo-guard dry-run
  repo-guard pre-commit
  repo-guard pre-push
  repo-guard build
  repo-guard architecture
  repo-guard typecheck
  repo-guard unit-test
  repo-guard unsafe-html
  repo-guard target-blank
  repo-guard file-placement
  repo-guard lighthouse [--skip-build]
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
        ensureSupportedOptions(rest, new Set(['--fix']));
        return runDoctor(process.cwd(), { fix: rest.includes('--fix') });
      case 'exceptions':
        ensureSupportedOptions(rest, new Set());
        return runExceptionsCommand();
      case 'dependencies':
        ensureSupportedOptions(rest, new Set());
        return runDependenciesCommand();
      case 'pre-commit':
        ensureSupportedOptions(rest, new Set());
        return await runPreCommit();
      case 'pre-push':
        return runPrePush(process.cwd(), {
          input: process.stdin.isTTY ? '' : readFileSync(0, 'utf8'),
          remoteName: rest[0] || 'origin',
        });
      case 'build':
        ensureSupportedOptions(rest, new Set());
        return runBuildCommand();
      case 'architecture':
        ensureSupportedOptions(rest, new Set());
        return runArchitectureCommand();
      case 'unit-test':
        ensureSupportedOptions(rest, new Set());
        return runUnitTestCommand();
      case 'typecheck':
        ensureSupportedOptions(rest, new Set());
        return runTypeCheckCommand();
      case 'unsafe-html':
        ensureSupportedOptions(rest, new Set());
        return runUnsafeHtmlCommand();
      case 'target-blank':
        ensureSupportedOptions(rest, new Set());
        return runTargetBlankCommand();
      case 'file-placement':
        ensureSupportedOptions(rest, new Set());
        return runFilePlacementCommand();
      case 'lighthouse':
        ensureSupportedOptions(rest, new Set(['--skip-build']));
        return runLighthouseCommand(process.cwd(), {
          skipBuild: rest.includes('--skip-build'),
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
      default:
        throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    }
  } catch (error) {
    console.error(`repo-guard failed: ${error.message}`);
    return 1;
  }
}
