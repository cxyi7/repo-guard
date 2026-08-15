import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import micromatch from 'micromatch';
import { DEFAULT_UNIT_TEST_CONFIG } from '../../config/defaults.js';
import { normalizeGitPath } from '../../config/path-matching.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { runGit } from '../../git/execution.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { analyzeUnitTestContent } from '../../integrations/vitest/source-analysis.js';
import {
  analyzeVueComponentInteractionTest,
  findVueInteractionEntries,
} from '../../integrations/vue/component-interaction.js';

function matches(pathname, patterns) {
  return micromatch.isMatch(pathname, patterns, { dot: true });
}

function isDeleted(change) {
  return change.status.startsWith('D');
}

function isNew(change) {
  return change.status === '??'
    || change.status.startsWith('A')
    || change.status.startsWith('C');
}

function requiresTest(change, mode) {
  return mode === 'changedFiles' ? !isDeleted(change) : isNew(change);
}

export function expectedUnitTestPaths(
  sourcePath,
  mappings = DEFAULT_UNIT_TEST_CONFIG.mappings,
) {
  const normalizedSource = normalizeGitPath(sourcePath);
  const mapping = mappings.find(({ sourcePattern }) => (
    matches(normalizedSource, [sourcePattern])
  ));
  if (!mapping) {
    throw configurationError(
      'unit-test/missing-source-mapping',
      `Unit test source mapping was not found for: ${normalizedSource}.`,
      {
        details: { location: { path: normalizedSource } },
        expected: '每个受单元测试策略约束的源文件都匹配一条 unitTest.mappings 规则。',
      },
    );
  }

  const parsed = path.posix.parse(normalizedSource);
  const variables = {
    dir: parsed.dir || '.',
    ext: parsed.ext.replace(/^\./, ''),
    name: parsed.name,
    path: path.posix.join(parsed.dir, parsed.name),
  };
  return [...new Set(mapping.testTemplates.map((template) => (
    normalizeGitPath(path.posix.normalize(template.replace(
      /\{(dir|ext|name|path)\}/g,
      (_, key) => variables[key],
    )))
  )))];
}

export function expectedUnitTestPath(sourcePath) {
  return expectedUnitTestPaths(sourcePath)[0];
}

function readPolicyFile(root, filePath, headSha) {
  if (headSha) {
    try {
      return runGit(['show', `${headSha}:${filePath}`], { cwd: root }).stdout;
    } catch {
      return null;
    }
  }
  const absolute = path.join(root, filePath);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

function interactionSourceChanges(root, changes, config) {
  if (!config.componentInteraction.enabled) return [];
  const sourceChanges = new Map();
  for (const change of changes) {
    if (!isDeleted(change)
      && change.path.toLowerCase().endsWith('.vue')
      && matches(change.path, config.componentInteraction.componentPatterns)
      && matches(change.path, config.sourcePatterns)
      && !matches(change.path, config.exclusions)) {
      sourceChanges.set(`${change.headSha ?? ''}\0${change.path}`, change);
    }
  }
  for (const change of changes) {
    if (isDeleted(change) || !matches(change.path, config.testPatterns)) continue;
    const projectFiles = change.headSha
      ? runGit(
        ['ls-tree', '-r', '--name-only', change.headSha],
        { cwd: root },
      ).stdout.split(/\r?\n/).filter(Boolean)
      : collectProjectFiles(root);
    for (const sourcePath of projectFiles) {
      if (!sourcePath.toLowerCase().endsWith('.vue')
        || !matches(sourcePath, config.componentInteraction.componentPatterns)
        || !matches(sourcePath, config.sourcePatterns)
        || matches(sourcePath, config.exclusions)
        || !expectedUnitTestPaths(sourcePath, config.mappings).includes(change.path)) {
        continue;
      }
      sourceChanges.set(`${change.headSha ?? ''}\0${sourcePath}`, {
        ...change,
        path: sourcePath,
      });
    }
  }
  return [...sourceChanges.values()];
}

function inspectComponentInteractions({ root, changes, config }) {
  const issues = [];
  for (const change of interactionSourceChanges(root, changes, config)) {
    const sourcePath = change.path;
    const componentSource = readPolicyFile(root, sourcePath, change.headSha);
    const entries = componentSource == null
      ? []
      : findVueInteractionEntries(componentSource, sourcePath);
    if (entries.length === 0) continue;
    const tests = expectedUnitTestPaths(sourcePath, config.mappings)
      .map((testPath) => ({
        content: readPolicyFile(root, testPath, change.headSha),
        testPath,
      }))
      .filter(({ content }) => content != null && analyzeUnitTestContent(content).hasTestCase);
    if (tests.length === 0) continue;
    const analyses = tests.map(({ content, testPath }) => ({
      ...analyzeVueComponentInteractionTest({
        componentSourcePath: sourcePath,
        testPath,
        testSource: content,
      }),
      testPath,
    }));
    if (!analyses.some(({ valid }) => valid)) {
      issues.push({
        analyses,
        entries,
        sourcePath,
        testPaths: tests.map(({ testPath }) => testPath),
      });
    }
  }
  return issues;
}

export function inspectUnitTestPolicy({ root, changes, config }) {
  changes = changeSetEntries(changes, 'Unit test policy changes');
  const missingTests = [];
  const bypasses = [];

  for (const change of changes) {
    const filePath = change.path;
    if (
      isDeleted(change)
      || matches(filePath, config.exclusions)
      || matches(filePath, config.testPatterns)
      || !matches(filePath, config.sourcePatterns)
      || !requiresTest(change, config.requireTests)
    ) {
      continue;
    }
    const expectedPaths = expectedUnitTestPaths(filePath, config.mappings);
    const existingTests = expectedPaths
      .map((testPath) => ({
        content: readPolicyFile(root, testPath, change.headSha),
        testPath,
      }))
      .filter(({ content }) => content != null);
    const effectiveTests = existingTests.filter(({ content }) => (
      analyzeUnitTestContent(content).hasTestCase
    ));
    if (existingTests.length === 0) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: expectedPaths[0],
        expectedTestPaths: expectedPaths,
        reason: 'missing',
      });
    } else if (effectiveTests.length === 0) {
      missingTests.push({
        sourcePath: filePath,
        expectedTestPath: existingTests[0].testPath,
        expectedTestPaths: expectedPaths,
        reason: 'empty',
      });
    }
  }

  for (const change of changes) {
    if (isDeleted(change) || !matches(change.path, config.testPatterns)) {
      continue;
    }
    const content = readPolicyFile(root, change.path, change.headSha);
    if (content == null) {
      continue;
    }
    const analysis = analyzeUnitTestContent(content);
    if (
      !analysis.hasTestCase
      && !missingTests.some(({ expectedTestPath }) => expectedTestPath === change.path)
    ) {
      missingTests.push({
        sourcePath: null,
        expectedTestPath: change.path,
        reason: 'empty',
      });
    }
    for (const bypass of analysis.bypasses) {
      bypasses.push({ filePath: change.path, ...bypass });
    }
  }

  return {
    bypasses,
    componentInteractions: inspectComponentInteractions({ root, changes, config }),
    missingTests,
  };
}

export function unitTestPolicyFindings({
  bypasses,
  componentInteractions = [],
  missingTests,
}) {
  return [
    ...missingTests.map((missing) => ({
      ruleId: missing.reason === 'empty' ? 'unit-test/non-empty-test' : 'unit-test/required-test',
      severity: 'error',
      message: missing.sourcePath
        ? `${missing.sourcePath} requires an effective unit test`
        : `${missing.expectedTestPath} does not contain an effective unit test`,
      location: { path: missing.sourcePath ?? missing.expectedTestPath },
      evidence: missing.expectedTestPaths?.length
        ? `Accepted test paths: ${missing.expectedTestPaths.join(', ')}`
        : null,
      remediation: `Add an executable test at ${missing.expectedTestPath} with meaningful assertions.`,
    })),
    ...bypasses.map((bypass) => ({
      ruleId: 'unit-test/no-bypass',
      severity: 'error',
      message: `Unit test bypass detected: ${bypass.expression}`,
      location: {
        path: bypass.filePath,
        ...(bypass.line ? { line: bypass.line } : {}),
      },
      remediation: 'Remove the skip, todo, or only bypass and make the test pass normally.',
    })),
    ...componentInteractions.map((issue) => ({
      ruleId: 'unit-test/vue-component-interaction',
      severity: 'error',
      message: `${issue.sourcePath} lacks a complete component interaction test`,
      location: { path: issue.sourcePath },
      evidence: issue.testPaths.length > 0
        ? `Inspected tests: ${issue.testPaths.join(', ')}`
        : null,
      remediation: 'Import and mount the component, perform a real user interaction, then assert its observable result in the same test.',
    })),
  ];
}
