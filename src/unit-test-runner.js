import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, executionError, toRepoGuardError } from './core/error/repo-guard-error.js';
import micromatch from 'micromatch';
import { DEFAULT_UNIT_TEST_CONFIG, normalizeGitPath } from './config.js';
import {
  buildCoverageArguments,
  coverageFindings,
  inspectCoverageReports,
  isCoverageEnabled,
  isStructuredCoverage,
  prepareCoverageReports,
} from './coverage-runner.js';
import { changeSetEntries } from './core/capability/gate-context.js';
import { processOutputDiagnostics } from './core/execution/process-output.js';
import { processFailureFinding } from './core/report/guidance-catalog.js';
import { createGateResult } from './core/result/gate-result.js';
import { runGit } from './git.js';
import { collectProjectFiles } from './file-placement.js';
import { resolveProjectPackageMetadata } from './project-package.js';
import {
  analyzeVueComponentInteractionTest,
  findVueInteractionEntries,
} from './vue-component-interaction.js';

const TEST_API_BASE_PATTERN = /(?<![\w$.])\b(describe|it|test)\b/g;
const DISABLED_TEST_PROPERTIES = new Set(['only', 'skip', 'skipIf', 'todo']);
const EXECUTING_TEST_PROPERTIES = new Set([
  'concurrent',
  'each',
  'fails',
  'for',
  'runIf',
  'sequential',
]);

function readProjectPackage(root) {
  const target = path.join(root, 'package.json');
  if (!existsSync(target)) {
    throw configurationError('unit-test/missing-package-json', 'package.json was not found in repository root');
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

export function validateUnitTestSetup(root, config) {
  const packageJson = readProjectPackage(root);
  const command = packageJson.scripts?.[config.script];
  if (typeof command !== 'string' || !command.trim()) {
    throw configurationError(
      'unit-test/missing-script',
      `Unit test gate requires package.json script "${config.script}"`,
    );
  }
  const vitest = resolveProjectPackageMetadata(root, 'vitest', 'Vitest');
  const vueTestUtils = config.componentInteraction.enabled
    ? resolveProjectPackageMetadata(root, '@vue/test-utils', 'Vue Test Utils')
    : null;
  return { command: command.trim(), vitest, vueTestUtils };
}

export function detectProjectUnitTestSetup(root, config) {
  try {
    return { ready: true, setup: validateUnitTestSetup(root, config) };
  } catch (error) {
    return { ready: false, error };
  }
}

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

function previousNonWhitespace(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) {
      return value[index];
    }
  }
  return '';
}

function masksRegexLiteral(output) {
  const previous = previousNonWhitespace(output);
  if (!previous || /[([{:,;=!?&|+\-*%^~<>]/.test(previous)) {
    return true;
  }
  let index = output.length - 1;
  while (index >= 0 && /\s/.test(output[index])) {
    index -= 1;
  }
  let word = '';
  while (index >= 0 && /[\w$]/.test(output[index])) {
    word = output[index] + word;
    index -= 1;
  }
  return new Set([
    'await',
    'case',
    'delete',
    'in',
    'instanceof',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]).has(word);
}

function maskNonCode(content) {
  const output = [];
  let state = 'code';
  let stringQuote = '';
  let inCharacterClass = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    const masked = character === '\n' || character === '\r' ? character : ' ';

    if (state === 'line-comment') {
      output.push(masked);
      if (character === '\n') {
        state = 'code';
      }
      continue;
    }
    if (state === 'block-comment') {
      output.push(masked);
      if (character === '*' && next === '/') {
        output.push(' ');
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string' || state === 'template') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(next === '\n' || next === '\r' ? next : ' ');
          index += 1;
        }
        continue;
      }
      if (
        (state === 'string' && character === stringQuote)
        || (state === 'template' && character === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (state === 'regex') {
      output.push(masked);
      if (character === '\\') {
        if (next != null) {
          output.push(' ');
          index += 1;
        }
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        state = 'regex-flags';
      }
      continue;
    }
    if (state === 'regex-flags') {
      if (/[A-Za-z]/.test(character)) {
        output.push(' ');
        continue;
      }
      state = 'code';
    }

    if (character === '/' && next === '/') {
      output.push(' ', ' ');
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output.push(' ', ' ');
      index += 1;
      state = 'block-comment';
    } else if (character === '/' && masksRegexLiteral(output)) {
      output.push(' ');
      state = 'regex';
      inCharacterClass = false;
    } else if (character === "'" || character === '"') {
      output.push(' ');
      state = 'string';
      stringQuote = character;
    } else if (character === '`') {
      output.push(' ');
      state = 'template';
    } else {
      output.push(character);
    }
  }

  return output.join('');
}

export function analyzeUnitTestContent(content) {
  const code = maskNonCode(content);
  const bypasses = [];
  let hasTestCase = false;

  for (const match of code.matchAll(TEST_API_BASE_PATTERN)) {
    const base = match[1];
    const properties = [];
    let cursor = match.index + match[0].length;
    let hasCall = false;

    while (cursor < code.length) {
      while (cursor < code.length && /\s/.test(code[cursor])) {
        cursor += 1;
      }
      if (code[cursor] === '.') {
        cursor += 1;
        while (cursor < code.length && /\s/.test(code[cursor])) {
          cursor += 1;
        }
        const propertyStart = cursor;
        if (cursor >= code.length || !/[A-Za-z_$]/.test(code[cursor])) {
          break;
        }
        cursor += 1;
        while (cursor < code.length && /[\w$]/.test(code[cursor])) {
          cursor += 1;
        }
        properties.push({
          index: propertyStart,
          name: code.slice(propertyStart, cursor),
        });
        continue;
      }
      if (code[cursor] === '(') {
        hasCall = true;
        let depth = 1;
        cursor += 1;
        while (cursor < code.length && depth > 0) {
          if (code[cursor] === '(') {
            depth += 1;
          } else if (code[cursor] === ')') {
            depth -= 1;
          }
          cursor += 1;
        }
        continue;
      }
      break;
    }

    if (!hasCall) {
      continue;
    }
    const knownProperties = properties.every(({ name }) => (
      EXECUTING_TEST_PROPERTIES.has(name)
      || DISABLED_TEST_PROPERTIES.has(name)
    ));
    if (base !== 'describe' && knownProperties) {
      hasTestCase = true;
    }
    for (const property of properties) {
      if (!DISABLED_TEST_PROPERTIES.has(property.name)) {
        continue;
      }
      const line = code.slice(0, property.index).split(/\r?\n/).length;
      bypasses.push({ line, expression: `${base}.${property.name}` });
    }
  }

  return { bypasses, hasTestCase };
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

function runNpmScript(root, config) {
  const scriptArgs = ['run', config.script];
  const coverageArgs = buildCoverageArguments(config);
  if (coverageArgs.length > 0) {
    scriptArgs.push('--', ...coverageArgs);
  }
  const command = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${scriptArgs.map((argument) => (
      /[\s&|<>^()]/.test(argument) ? `"${argument.replaceAll('"', '""')}"` : argument
    )).join(' ')}`]
    : scriptArgs;
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: config.timeoutMs,
    windowsHide: true,
  });
}

export function runUnitTestGate({ root, config, changes }) {
  changeSetEntries(changes, 'Unit test gate changes');
  const setup = validateUnitTestSetup(root, config);
  const policy = inspectUnitTestPolicy({ root, changes, config });
  if (policy.missingTests.length > 0
    || policy.bypasses.length > 0
    || policy.componentInteractions.length > 0) {
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'violation',
      summary: 'Unit test policy failed',
      findings: unitTestPolicyFindings(policy),
      metrics: {
        missingTests: policy.missingTests.length,
        bypasses: policy.bypasses.length,
        componentInteractions: policy.componentInteractions.length,
      },
    });
  }

  const diagnostics = [{ level: 'info', message:
    `repo-guard unit tests: Vitest ${setup.vitest.version}, `
    + `running npm script "${config.script}"`
    + `${isCoverageEnabled(config.coverage) ? ' with coverage' : ''}...` }];
  prepareCoverageReports(root, config.coverage);
  const result = runNpmScript(root, config);
  diagnostics.push(...processOutputDiagnostics(result, { source: 'vitest', root }));
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'execution-error',
        summary: `Unit tests exceeded ${config.timeoutMs}ms`,
        error: executionError(
          'unit-test/timeout',
          `Unit tests exceeded ${config.timeoutMs}ms`,
          { cause: result.error },
        ),
        diagnostics,
      });
    }
    const error = executionError(
      'unit-test/process-start-failed',
      `Unable to run unit tests: ${result.error.message}`,
      { cause: result.error },
    );
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'execution-error',
      summary: error.message,
      error,
      diagnostics,
    });
  }
  if (result.status !== 0) {
    return createGateResult({
      gateId: 'quality.unit-test',
      status: 'violation',
      summary: `Unit tests failed with exit code ${result.status ?? 1}`,
      diagnostics,
      findings: [processFailureFinding('quality.unit-test', {
        exitCode: result.status ?? 1,
        script: config.script,
      })],
    });
  }
  if (isStructuredCoverage(config.coverage)) {
    let coverageResult;
    try {
      coverageResult = inspectCoverageReports({ root, config, changes });
    } catch (error) {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'execution-error',
        summary: 'Coverage report inspection failed',
        error: toRepoGuardError(error, {
          kind: 'execution',
          code: 'coverage/report-inspection-failed',
        }),
        diagnostics,
        findings: [processFailureFinding('quality.unit-test', {
          phase: 'coverage-report',
          script: config.script,
        })],
      });
    }
    const findings = coverageFindings(coverageResult, root);
    if (!coverageResult.passed) {
      return createGateResult({
        gateId: 'quality.unit-test',
        status: 'violation',
        summary: 'Coverage threshold failed',
        diagnostics,
        findings,
      });
    }
  }
  diagnostics.push({ level: 'info', message: 'repo-guard unit tests passed.' });
  return createGateResult({
    gateId: 'quality.unit-test',
    status: 'passed',
    summary: `Unit tests passed with Vitest ${setup.vitest.version}`,
    diagnostics,
    metrics: { coverageEnabled: isCoverageEnabled(config.coverage) ? 1 : 0 },
  });
}
