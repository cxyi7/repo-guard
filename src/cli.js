import { readFileSync } from 'node:fs';
import { runAccessibilityTestCommand } from './commands/accessibility-test.js';
import { runArchitectureCommand } from './commands/architecture.js';
import { runBuildCommand } from './commands/build.js';
import { runCheck } from './commands/check.js';
import { runCiCommand } from './commands/ci.js';
import { runDisable, runEnable, runMigrate } from './commands/configure.js';
import { runDoctor } from './commands/doctor.js';
import { gateRegistry } from './gates/registry.js';
import { runRegisteredManualGate } from './orchestration/cli/manual-gates.js';
import { runDependenciesCommand } from './commands/dependencies.js';
import { runExceptionsCommand } from './commands/exceptions.js';
import { runFilePlacementCommand } from './commands/file-placement.js';
import { runFormLabelsCommand } from './commands/form-labels.js';
import { runGate } from './commands/gate.js';
import { runHookMessage } from './commands/hook-message.js';
import { runImageAltCommand } from './commands/image-alt.js';
import { runInit, runInstallHooks } from './commands/init.js';
import { runInstallCiCommand } from './commands/install-ci.js';
import { runLighthouseCommand } from './commands/lighthouse.js';
import { runPrePush } from './commands/pre-push.js';
import { runTargetBlankCommand } from './commands/target-blank.js';
import { runStyleComplexityCommand } from './commands/style-complexity.js';
import { runStyleGovernanceCommand } from './commands/style-governance.js';
import { runTypeCheckCommand } from './commands/typecheck.js';
import { runUnitTestCommand } from './commands/unit-test.js';
import { runUnsafeHtmlCommand } from './commands/unsafe-html.js';
import {
  runLintFiles,
  runPreCommit,
  runQualityFileCommand,
} from './commands/pre-commit.js';

const REGISTERED_MANUAL_HELP = gateRegistry.all
  .filter(({ manualCommand }) => manualCommand)
  .map(({ manualCommand }) => `  repo-guard ${manualCommand}`)
  .join('\n');

const HELP_TEXT = `
repo-guard - protected repository file guard

Usage:
  repo-guard init
  repo-guard install-hooks
  repo-guard migrate
  repo-guard enable <eslint|prettier|stylelint|styleComplexity|styleGovernance|maxFileLines|filePlacement|dependencies|architecture|typeCheck|unitTest|componentInteraction|accessibilityTest|coverage|build|lighthouse|notification|ci> [...]
  repo-guard disable <eslint|prettier|stylelint|styleComplexity|styleGovernance|maxFileLines|filePlacement|dependencies|architecture|typeCheck|unitTest|componentInteraction|accessibilityTest|coverage|build|lighthouse|notification|ci> [...]
  repo-guard doctor [--fix|--ci]
  repo-guard install-ci --provider gitlab [--profile policy|full] [--stage <name>] [--dry-run]
  repo-guard ci [--profile policy|full] [--base <sha>] [--head <sha>] [--report-json <path>]
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
${REGISTERED_MANUAL_HELP}
  repo-guard unsafe-html
  repo-guard target-blank
  repo-guard form-labels
  repo-guard image-alt
  repo-guard accessibility-test
  repo-guard style-complexity
  repo-guard style-governance
  repo-guard file-placement
  repo-guard lighthouse [--skip-build]
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
      case 'form-labels':
        ensureSupportedOptions(rest, new Set());
        return runFormLabelsCommand();
      case 'image-alt':
        ensureSupportedOptions(rest, new Set());
        return runImageAltCommand();
      case 'accessibility-test':
        ensureSupportedOptions(rest, new Set());
        return runAccessibilityTestCommand();
      case 'style-complexity':
        ensureSupportedOptions(rest, new Set());
        return await runStyleComplexityCommand();
      case 'style-governance':
        ensureSupportedOptions(rest, new Set());
        return await runStyleGovernanceCommand();
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
        if (gateRegistry.findByManualCommand(command)) {
          ensureSupportedOptions(rest, new Set());
          return runRegisteredManualGate(command);
        }
        throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    }
  } catch (error) {
    console.error(`repo-guard failed: ${error.message}`);
    return 1;
  }
}
