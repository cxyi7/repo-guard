import { readFileSync } from 'node:fs';
import micromatch from 'micromatch';
import { collectStagedChanges } from './git-changes.js';
import { runGit } from './git.js';
import { normalizeStagedFiles } from './staged-files.js';

const DEFAULT_MODE = 'strict';
const DEFAULT_WARN_AT = 0.85;
const MATCH_OPTIONS = Object.freeze({
  dot: true,
});

export function countPhysicalLines(content) {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r\n|\n|\r/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function countSectionContentLines(content) {
  const lines = content.split(/\r\n|\n|\r/);
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines.at(-1).trim()) {
    lines.pop();
  }
  return lines.length;
}

export function analyzeVueSections(content) {
  const sections = { template: 0, script: 0, style: 0 };
  const blockPattern = /<(template|script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

  for (const match of content.matchAll(blockPattern)) {
    sections[match[1].toLowerCase()] += countSectionContentLines(match[2]);
  }

  return sections;
}

export function matchMaxFileLineRule(relativePath, config) {
  if (config.exclusions.some((pattern) => (
    micromatch.isMatch(relativePath, pattern, MATCH_OPTIONS)
  ))) {
    return null;
  }

  return config.rules.find(({ pattern }) => (
    micromatch.isMatch(relativePath, pattern, MATCH_OPTIONS)
  )) ?? null;
}

export function selectMaxFileLineFiles(files, config) {
  return files
    .filter(({ relative }) => matchMaxFileLineRule(relative, config))
    .map(({ absolute }) => absolute);
}

function readRevisionContent(root, revision, relativePath) {
  const result = runGit(['show', `${revision}:${relativePath}`], {
    allowFailure: true,
    cwd: root,
  });
  return result.status === 0 ? result.stdout : null;
}

function readBaseline(root, relativePath, stagedChanges, baselineRef = 'HEAD') {
  const currentContent = readRevisionContent(root, baselineRef, relativePath);
  if (currentContent != null) {
    return {
      lineCount: countPhysicalLines(currentContent),
      path: relativePath,
    };
  }

  const rename = stagedChanges.find((change) => (
    change.path === relativePath && change.oldPath
  ));
  if (!rename) {
    return null;
  }

  const renamedContent = readRevisionContent(root, baselineRef, rename.oldPath);
  return renamedContent == null
    ? null
    : {
        lineCount: countPhysicalLines(renamedContent),
        path: rename.oldPath,
      };
}

function fileDetails(relative, content, rule) {
  return {
    path: relative,
    lineCount: countPhysicalLines(content),
    maxLines: rule.maxLines,
    pattern: rule.pattern,
    sections: relative.toLowerCase().endsWith('.vue')
      ? analyzeVueSections(content)
      : null,
  };
}

export function evaluateMaxFileLines({ root, files, config, baselineRef = 'HEAD', changes = null }) {
  const normalizedFiles = normalizeStagedFiles(root, files, 'Maximum file lines gate');
  const mode = config.mode ?? DEFAULT_MODE;
  const warnAt = config.warnAt ?? DEFAULT_WARN_AT;
  const violations = [];
  const warnings = [];
  let stagedChanges;

  for (const { absolute, relative } of normalizedFiles) {
    const rule = matchMaxFileLineRule(relative, config);
    if (!rule) {
      continue;
    }

    const content = readFileSync(absolute, 'utf8');
    const details = fileDetails(relative, content, rule);
    if (details.lineCount > rule.maxLines) {
      if (mode === 'noRegression') {
        stagedChanges ??= changes ?? collectStagedChanges(root);
        const baseline = readBaseline(root, relative, stagedChanges, baselineRef);
        if (baseline && baseline.lineCount > rule.maxLines) {
          if (details.lineCount <= baseline.lineCount) {
            warnings.push({
              ...details,
              kind: 'legacy-over-limit',
              baselineLineCount: baseline.lineCount,
              baselinePath: baseline.path,
            });
            continue;
          }

          violations.push({
            ...details,
            mode,
            baselineLineCount: baseline.lineCount,
            baselinePath: baseline.path,
            passLineCount: baseline.lineCount,
          });
          continue;
        }
      }

      violations.push({ ...details, mode, passLineCount: rule.maxLines });
      continue;
    }

    const warningLineCount = Math.ceil(rule.maxLines * warnAt);
    if (details.lineCount >= warningLineCount) {
      warnings.push({
        ...details,
        kind: 'near-limit',
        warnAt,
        warningLineCount,
      });
    }
  }

  return { violations, warnings };
}

export function inspectMaxFileLines(options) {
  return evaluateMaxFileLines(options).violations;
}
