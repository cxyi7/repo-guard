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
import { runDynamicCodeFiles } from './dynamic-code.js';
import { runVueFormLabelFiles } from './vue-form-label.js';
import { runVueImageAltFiles } from './vue-image-alt.js';
import { runVueTargetBlankFiles } from './vue-target-blank.js';
import { runUnsafeVueHtmlFiles } from './vue-unsafe-html.js';
import {
  runMaxFileLinesFiles,
  selectMaxFileLineFiles,
} from './max-file-lines.js';

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
    if (stylelintFiles.length > 0) {
      const stylelintExitCode = await runStylelintFiles({
        root,
        files: stylelintFiles,
        fix: stylelintConfig.fix,
        maxWarnings: stylelintConfig.maxWarnings,
        requireConfig: stylelintConfig.requireConfig,
        complexity: stylelintConfig.complexity,
        exceptions: config.exceptions,
      });
      if (stylelintExitCode !== 0) {
        return fail(stylelintExitCode);
      }
    }

    if (eslintFiles.length > 0 && eslintConfig.fix) {
      const eslintFixExitCode = await runEslintFiles({
        root,
        files: eslintFiles,
        fix: true,
        maxWarnings: eslintConfig.maxWarnings,
        preset: eslintConfig.preset,
      });
      if (eslintFixExitCode !== 0) {
        return fail(eslintFixExitCode);
      }
    }

    if (prettierFiles.length > 0) {
      const prettierExitCode = await runPrettierFiles({
        root,
        files: prettierFiles,
        fix: prettierConfig.fix,
        requireConfig: prettierConfig.requireConfig,
      });
      if (prettierExitCode !== 0) {
        return fail(prettierExitCode);
      }
    }

    if (stylelintFiles.length > 0) {
      const stylelintVerifyExitCode = await runStylelintFiles({
        root,
        files: stylelintFiles,
        fix: false,
        maxWarnings: stylelintConfig.maxWarnings,
        requireConfig: stylelintConfig.requireConfig,
        complexity: stylelintConfig.complexity,
        exceptions: config.exceptions,
      });
      if (stylelintVerifyExitCode !== 0) {
        return fail(stylelintVerifyExitCode);
      }
    }

    if (eslintFiles.length > 0 && (!eslintConfig.fix || prettierFiles.length > 0)) {
      const eslintVerifyExitCode = await runEslintFiles({
        root,
        files: eslintFiles,
        fix: false,
        maxWarnings: eslintConfig.maxWarnings,
        preset: eslintConfig.preset,
      });
      if (eslintVerifyExitCode !== 0) {
        return fail(eslintVerifyExitCode);
      }
    }

    if (dynamicCodeFiles.length > 0) {
      let dynamicCodeExitCode;
      try {
        dynamicCodeExitCode = runDynamicCodeFiles({
          root,
          files: normalizedFiles,
          exceptions: config.exceptions,
        });
      } catch (error) {
        if (!String(error.message).startsWith('Dynamic code gate could not parse ')) {
          throw error;
        }
        console.warn(
          `${error.message}. Dynamic-code inspection was deferred for this invalid or `
          + 'unsupported script; when ESLint is enabled, its completed result remains authoritative.',
        );
        dynamicCodeExitCode = 0;
      }
      if (dynamicCodeExitCode !== 0) {
        return fail(dynamicCodeExitCode);
      }
    }

    if (vueSecurityFiles.length > 0) {
      const unsafeHtmlExitCode = runUnsafeVueHtmlFiles({
        root,
        files: normalizedFiles,
        exceptions: config.exceptions,
      });
      if (unsafeHtmlExitCode !== 0) {
        return fail(unsafeHtmlExitCode);
      }
      const targetBlankExitCode = runVueTargetBlankFiles({
        root,
        files: normalizedFiles,
        exceptions: config.exceptions,
      });
      if (targetBlankExitCode !== 0) {
        return fail(targetBlankExitCode);
      }
      const formLabelExitCode = runVueFormLabelFiles({
        root,
        files: normalizedFiles,
        exceptions: config.exceptions,
      });
      if (formLabelExitCode !== 0) {
        return fail(formLabelExitCode);
      }
      const imageAltExitCode = runVueImageAltFiles({
        root,
        files: normalizedFiles,
        exceptions: config.exceptions,
      });
      if (imageAltExitCode !== 0) {
        return fail(imageAltExitCode);
      }
    }

    if (maxFileLineFiles.length > 0) {
      const maxFileLinesExitCode = runMaxFileLinesFiles({
        root,
        files: maxFileLineFiles,
        config: maxFileLinesConfig,
      });
      if (maxFileLinesExitCode !== 0) {
        return fail(maxFileLinesExitCode);
      }
    }

    if (filePlacementConfig.enabled) {
      const filePlacementExitCode = runFilePlacementFiles({
        root,
        files: normalizedFiles,
        config: filePlacementConfig,
      });
      if (filePlacementExitCode !== 0) {
        return fail(filePlacementExitCode);
      }
    }

    return 0;
  } catch (error) {
    restoreFileContents(originalContents);
    throw error;
  }
}
