import micromatch from 'micromatch';
import {
  captureFileContents,
  restoreFileContents,
} from './file-snapshot.js';
import { runEslintFiles } from './eslint-runner.js';
import { runFilePlacementFiles } from './file-placement.js';
import { runPrettierFiles } from './prettier-runner.js';
import { normalizeStagedFiles } from './staged-files.js';
import { runStylelintFiles } from './stylelint-runner.js';
import { gateRegistry } from './gates/registry.js';
import { renderDynamicCodeResult } from './dynamic-code.js';
import { runVueFormLabelFiles } from './vue-form-label.js';
import { runVueImageAltFiles } from './vue-image-alt.js';
import { runVueTargetBlankFiles } from './vue-target-blank.js';
import { runUnsafeVueHtmlFiles } from './vue-unsafe-html.js';
import {
  runMaxFileLinesFiles,
  selectMaxFileLineFiles,
} from './max-file-lines.js';
import { preCommitPlan } from './orchestration/execution-plans.js';

function selectFiles(files, pattern) {
  return files
    .filter(({ relative }) => micromatch.isMatch(relative, pattern, {
      dot: true,
      matchBase: true,
    }))
    .map(({ absolute }) => absolute);
}

function uniqueFiles(...groups) {
  return [...new Set(groups.flat())];
}

export async function runQualityFiles({ root, files, config }) {
  const normalizedFiles = normalizeStagedFiles(root, files, 'Quality gate');
  const eslintConfig = config.preCommit.eslint;
  const prettierConfig = config.preCommit.prettier;
  const stylelintConfig = config.preCommit.stylelint;
  const maxFileLinesConfig = config.preCommit.maxFileLines;
  const filePlacementConfig = config.preCommit.filePlacement;
  const dynamicCodeFiles = normalizedFiles
    .filter(({ relative }) => /\.(?:[cm]?[jt]sx?|vue)$/i.test(relative))
    .map(({ absolute }) => absolute);
  const vueSecurityFiles = normalizedFiles
    .filter(({ relative }) => relative.toLowerCase().endsWith('.vue'))
    .map(({ absolute }) => absolute);
  const eslintFiles = eslintConfig.enabled
    ? selectFiles(normalizedFiles, eslintConfig.pattern)
    : [];
  const prettierFiles = prettierConfig.enabled
    ? selectFiles(normalizedFiles, prettierConfig.pattern)
    : [];
  const stylelintFiles = stylelintConfig.enabled
    ? selectFiles(normalizedFiles, stylelintConfig.pattern)
    : [];
  const maxFileLineFiles = maxFileLinesConfig.enabled
    ? selectMaxFileLineFiles(normalizedFiles, maxFileLinesConfig)
    : [];
  const relevantFiles = uniqueFiles(
    stylelintFiles,
    eslintFiles,
    prettierFiles,
    maxFileLineFiles,
    dynamicCodeFiles,
    vueSecurityFiles,
  );

  if (relevantFiles.length === 0 && !filePlacementConfig.enabled) {
    console.log('repo-guard quality gate: no staged files matched the configured patterns.');
    return 0;
  }

  const originalContents = captureFileContents(relevantFiles);
  const fail = (exitCode) => {
    if (exitCode !== 0) {
      restoreFileContents(originalContents);
    }
    return exitCode;
  };

  try {
    for (const step of preCommitPlan.steps) {
      let exitCode = 0;
      switch (step.id) {
        case 'quality.stylelint-fix':
          if (stylelintFiles.length > 0) exitCode = await runStylelintFiles({ root, files: stylelintFiles, fix: stylelintConfig.fix, maxWarnings: stylelintConfig.maxWarnings, requireConfig: stylelintConfig.requireConfig, complexity: stylelintConfig.complexity, governance: stylelintConfig.governance, exceptions: config.exceptions });
          break;
        case 'quality.eslint-fix':
          if (eslintFiles.length > 0 && eslintConfig.fix) exitCode = await runEslintFiles({ root, files: eslintFiles, fix: true, maxWarnings: eslintConfig.maxWarnings, preset: eslintConfig.preset });
          break;
        case 'quality.prettier':
          if (prettierFiles.length > 0) exitCode = await runPrettierFiles({ root, files: prettierFiles, fix: prettierConfig.fix, requireConfig: prettierConfig.requireConfig });
          break;
        case 'quality.stylelint-verify':
          if (stylelintFiles.length > 0) exitCode = await runStylelintFiles({ root, files: stylelintFiles, fix: false, maxWarnings: stylelintConfig.maxWarnings, requireConfig: stylelintConfig.requireConfig, complexity: stylelintConfig.complexity, governance: stylelintConfig.governance, exceptions: config.exceptions });
          break;
        case 'quality.eslint-verify':
          if (eslintFiles.length > 0 && (!eslintConfig.fix || prettierFiles.length > 0)) exitCode = await runEslintFiles({ root, files: eslintFiles, fix: false, maxWarnings: eslintConfig.maxWarnings, preset: eslintConfig.preset });
          break;
        case 'security.dynamic-code':
          if (dynamicCodeFiles.length > 0) {
            try {
              const gate = gateRegistry.get(step.gateId);
              const gatePlan = gate.plan({ root, config, files: normalizedFiles });
              exitCode = renderDynamicCodeResult(gate.run({ root, config, plan: gatePlan }));
            } catch (error) {
              if (!String(error.message).startsWith('Dynamic code gate could not parse ')) throw error;
              console.warn(`${error.message}. Dynamic-code inspection was deferred for this invalid or unsupported script; when ESLint is enabled, its completed result remains authoritative.`);
            }
          }
          break;
        case 'security.vue-unsafe-html':
          if (vueSecurityFiles.length > 0) exitCode = runUnsafeVueHtmlFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'security.vue-target-blank':
          if (vueSecurityFiles.length > 0) exitCode = runVueTargetBlankFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'accessibility.vue-form-label':
          if (vueSecurityFiles.length > 0) exitCode = runVueFormLabelFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'accessibility.vue-image-alt':
          if (vueSecurityFiles.length > 0) exitCode = runVueImageAltFiles({ root, files: normalizedFiles, exceptions: config.exceptions });
          break;
        case 'repository.maximum-file-lines':
          if (maxFileLineFiles.length > 0) exitCode = runMaxFileLinesFiles({ root, files: maxFileLineFiles, config: maxFileLinesConfig });
          break;
        case 'repository.file-placement':
          if (filePlacementConfig.enabled) exitCode = runFilePlacementFiles({ root, files: normalizedFiles, config: filePlacementConfig });
          break;
        default:
          continue;
      }
      if (exitCode !== 0) return fail(exitCode);
    }

    return 0;
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }
}
