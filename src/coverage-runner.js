import {
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { normalizeGitPath } from './config.js';
import { runGit } from './git.js';

const GLOBAL_METRICS = Object.freeze([
  'lines',
  'statements',
  'functions',
  'branches',
]);

function matches(pathname, patterns) {
  return micromatch.isMatch(pathname, patterns, { dot: true });
}

export function isStructuredCoverage(coverage) {
  return Boolean(coverage && typeof coverage === 'object' && coverage.enabled);
}

export function isCoverageEnabled(coverage) {
  return coverage === true || isStructuredCoverage(coverage);
}

export function coverageReportPaths(root, coverage) {
  const directory = path.resolve(root, coverage.reportsDirectory);
  return {
    directory,
    lcov: path.join(directory, 'lcov.info'),
    summary: path.join(directory, 'coverage-summary.json'),
  };
}

export function prepareCoverageReports(root, coverage) {
  if (!isStructuredCoverage(coverage)) {
    return;
  }
  const reports = coverageReportPaths(root, coverage);
  rmSync(reports.lcov, { force: true });
  rmSync(reports.summary, { force: true });
}

export function buildCoverageArguments(config) {
  if (!isCoverageEnabled(config.coverage)) {
    return [];
  }
  if (!isStructuredCoverage(config.coverage)) {
    return ['--coverage'];
  }
  return [
    '--coverage',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=lcov',
    `--coverage.reportsDirectory=${config.coverage.reportsDirectory}`,
    ...config.sourcePatterns.map((pattern) => `--coverage.include=${pattern}`),
    ...config.testPatterns.map((pattern) => `--coverage.exclude=${pattern}`),
    ...config.exclusions.map((pattern) => `--coverage.exclude=${pattern}`),
  ];
}

function parsePercentage(metric, label) {
  if (!metric || typeof metric !== 'object') {
    throw new Error(`coverage summary is missing total.${label}`);
  }
  const covered = Number(metric.covered);
  const total = Number(metric.total);
  const percentage = total === 0 ? 100 : Number(metric.pct);
  if (![covered, total, percentage].every(Number.isFinite)) {
    throw new Error(`coverage summary contains invalid total.${label} values`);
  }
  return { covered, percentage, total };
}

export function parseCoverageSummary(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`unable to parse coverage-summary.json: ${error.message}`);
  }
  return Object.fromEntries(GLOBAL_METRICS.map((name) => (
    [name, parsePercentage(parsed.total?.[name], name)]
  )));
}

function coverageFilePath(root, value) {
  let raw = value.trim().replace(/\\/g, '/');
  if (/^\/[A-Za-z]:\//.test(raw)) {
    raw = raw.slice(1);
  }
  const absolute = path.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)
    ? path.resolve(raw)
    : path.resolve(root, raw);
  const relative = normalizeGitPath(path.relative(root, absolute));
  if (!relative || relative === '..' || relative.startsWith('../')) {
    return null;
  }
  return relative;
}

export function parseLcov(content, root) {
  const files = new Map();
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const filePath = coverageFilePath(root, line.slice(3));
      current = filePath ? new Map() : null;
      if (filePath) {
        files.set(filePath, current);
      }
      continue;
    }
    if (line.startsWith('DA:') && current) {
      const [lineNumberText, hitsText] = line.slice(3).split(',', 2);
      const lineNumber = Number(lineNumberText);
      const hits = Number(hitsText);
      if (Number.isInteger(lineNumber) && lineNumber > 0 && Number.isFinite(hits)) {
        current.set(lineNumber, hits);
      }
    }
  }
  return files;
}

export function parseChangedLineNumbers(diff) {
  const lines = new Set();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      continue;
    }
    const start = Number(match[1]);
    const count = match[2] == null ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
  }
  return lines;
}

function allWorkingFileLines(root, filePath) {
  const absolute = path.join(root, filePath);
  if (!existsSync(absolute)) {
    return new Set();
  }
  const content = readFileSync(absolute, 'utf8');
  const count = content ? content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0) : 0;
  return new Set(Array.from({ length: count }, (_, index) => index + 1));
}

function changedLinesForFile(root, change) {
  if (change.baseSha && change.headSha) {
    const paths = [...new Set([change.oldPath, change.path].filter(Boolean))];
    const diff = runGit([
      'diff',
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      change.baseSha,
      change.headSha,
      '--',
      ...paths,
    ], { cwd: root }).stdout;
    return parseChangedLineNumbers(diff);
  }
  if (change.status === '??' || change.status.startsWith('A')) {
    return allWorkingFileLines(root, change.path);
  }
  const diff = runGit([
    'diff',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    'HEAD',
    '--',
    change.path,
  ], { cwd: root }).stdout;
  return parseChangedLineNumbers(diff);
}

function relevantSourceChanges(changes, config) {
  const combined = new Map();
  for (const change of changes) {
    const filePath = normalizeGitPath(change.path);
    if (
      change.status.startsWith('D')
      || matches(filePath, config.testPatterns)
      || matches(filePath, config.exclusions)
      || !matches(filePath, config.sourcePatterns)
    ) {
      continue;
    }
    if (!combined.has(filePath)) {
      combined.set(filePath, []);
    }
    combined.get(filePath).push(change);
  }
  return combined;
}

function inspectChangedCoverage(root, changes, config, lcovFiles) {
  const uncovered = [];
  const missingFiles = [];
  let covered = 0;
  let total = 0;
  const sourceChanges = relevantSourceChanges(changes, config);

  for (const [filePath, fileChanges] of sourceChanges) {
    const lineHits = lcovFiles.get(filePath);
    if (!lineHits) {
      missingFiles.push(filePath);
      continue;
    }
    const changedLines = new Set();
    for (const change of fileChanges) {
      for (const line of changedLinesForFile(root, change)) {
        changedLines.add(line);
      }
    }
    for (const line of [...changedLines].sort((left, right) => left - right)) {
      if (!lineHits.has(line)) {
        continue;
      }
      total += 1;
      if (lineHits.get(line) > 0) {
        covered += 1;
      } else {
        uncovered.push(`${filePath}:${line}`);
      }
    }
  }

  const percentage = total === 0 ? 100 : (covered / total) * 100;
  const threshold = config.coverage.thresholds.changedLines;
  return {
    covered,
    eligibleFiles: sourceChanges.size,
    missingFiles,
    passed: missingFiles.length === 0 && percentage >= threshold,
    percentage,
    threshold,
    total,
    uncovered,
  };
}

export function inspectCoverageReports({ root, config, changes = [] }) {
  if (!isStructuredCoverage(config.coverage)) {
    return null;
  }
  const reports = coverageReportPaths(root, config.coverage);
  if (!existsSync(reports.summary) || !existsSync(reports.lcov)) {
    const missing = [
      !existsSync(reports.summary) ? path.relative(root, reports.summary) : null,
      !existsSync(reports.lcov) ? path.relative(root, reports.lcov) : null,
    ].filter(Boolean);
    throw new Error(`coverage reports were not generated: ${missing.join(', ')}`);
  }
  const summary = parseCoverageSummary(readFileSync(reports.summary, 'utf8'));
  const global = Object.fromEntries(GLOBAL_METRICS.map((name) => {
    const threshold = config.coverage.thresholds[name];
    return [name, {
      ...summary[name],
      passed: summary[name].percentage >= threshold,
      threshold,
    }];
  }));
  const lcovFiles = parseLcov(readFileSync(reports.lcov, 'utf8'), root);
  const changed = inspectChangedCoverage(root, changes, config, lcovFiles);
  return {
    changed,
    global,
    passed: Object.values(global).every(({ passed }) => passed) && changed.passed,
    reports,
  };
}

function metricLine(label, metric) {
  const status = metric.passed ? 'PASS' : 'FAIL';
  return `  ${status}  ${label}: ${metric.percentage.toFixed(2)}% `
    + `(${metric.covered}/${metric.total}, threshold=${metric.threshold}%)`;
}

export function formatCoverageReport(result, root) {
  const lines = ['repo-guard coverage report:'];
  for (const name of GLOBAL_METRICS) {
    lines.push(metricLine(name, result.global[name]));
  }
  lines.push(metricLine('changed lines', result.changed));
  if (result.changed.missingFiles.length > 0) {
    lines.push('  Missing LCOV data:');
    lines.push(...result.changed.missingFiles.map((filePath) => `  - ${filePath}`));
  }
  if (result.changed.uncovered.length > 0) {
    lines.push('  Uncovered changed lines:');
    lines.push(...result.changed.uncovered.slice(0, 30).map((entry) => `  - ${entry}`));
    if (result.changed.uncovered.length > 30) {
      lines.push(`  - ... and ${result.changed.uncovered.length - 30} more`);
    }
  }
  lines.push(
    `  Reports: ${normalizeGitPath(path.relative(root, result.reports.directory))}`,
  );
  return lines.join('\n');
}
