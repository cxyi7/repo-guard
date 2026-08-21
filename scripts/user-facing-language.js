import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const HAN_TEXT = /\p{Script=Han}/u;
const LATIN_TEXT = /[A-Za-z]/u;
const MACHINE_TEXT = /^(?=[A-Za-z0-9_./:<>{}@-]*[./:_<>{}@-])[A-Za-z0-9_./:<>{}@-]+$/u;
const MACHINE_VALUES = new Set(['build', 'eslint', 'prettier', 'stylelint']);
const MACHINE_COMMAND = /\b(?:npm\s+run\s+[A-Za-z0-9:_-]+|npm\s+pkg\s+(?:delete|get|set)\s+[A-Za-z0-9._:-]+|npm\s+(?:audit|login|pack|publish|test|whoami)|npx\s+[A-Za-z0-9@/._-]+|node\s+[A-Za-z0-9./_:-]+|git\s+[A-Za-z-]+|repo-guard\s+[A-Za-z-]+)(?:\s+--?[A-Za-z0-9][A-Za-z0-9=./:_-]*)*/giu;
const MACHINE_FRAGMENT = /(?:\$\{…\}|https?:\/\/\S+|`[^`]*`|\b[A-Za-z_][\w-]*=(?:"[^"]*"|'[^']*'|[A-Za-z_][\w-]*)|(?:\.?[A-Za-z0-9_{}<>@]+)(?:[./:_@][A-Za-z0-9_{}<>@-]+)+)/gu;
const ALLOWED_LATIN_WORDS = new Set([
  'api',
  'artifact',
  'ast',
  'authorization',
  'babel',
  'canceled',
  'ci',
  'cookie',
  'css',
  'decision',
  'dependency-cruiser',
  'diagnostic',
  'doctor',
  'dom',
  'error',
  'evidence',
  'eslint',
  'failed',
  'finding',
  'gate',
  'gateresult',
  'git',
  'github',
  'gitlab',
  'head',
  'hook',
  'html',
  'id',
  'issue',
  'javascript',
  'job',
  'json',
  'kind',
  'lcov',
  'level',
  'lighthouse',
  'location',
  'message',
  'node',
  'npm',
  'npx',
  'null',
  'prettier',
  'promise',
  'remediation',
  'runner',
  'schema',
  'script',
  'scripts',
  'severity',
  'stderr',
  'stdout',
  'stream',
  'stylelint',
  'success',
  'token',
  'test',
  'typescript',
  'undefined',
  'unknown',
  'url',
  'utils',
  'vue',
  'webhook',
  'yaml',
]);
const UNTRANSLATED_PROSE_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'cannot',
  'configuration',
  'has',
  'have',
  'invalid',
  'is',
  'line',
  'missing',
  'must',
  'not',
  'or',
  'required',
  'should',
  'the',
  'unterminated',
  'value',
  'values',
  'was',
  'were',
]);
const USER_TEXT_PROPERTIES = new Set([
  'summary',
  'message',
  'comment',
  'description',
  'evidence',
  'expected',
  'remediation',
  'goal',
  'steps',
  'constraints',
  'verification',
]);
const SECOND_ARGUMENT_MESSAGE_CALLS = new Set([
  'configurationError',
  'executionError',
  'rangeError',
  'securityError',
  'internalError',
  'cancellationError',
  'externalReportError',
  'externalReportSecurityError',
  'localEnvironmentError',
  'malformedNameStatusError',
  'passedResult',
  'skippedResult',
  'violationResult',
]);
const FIRST_ARGUMENT_MESSAGE_CALLS = new Set([
  'configValidationError',
  'ready',
  'readyGateSetup',
  'writeConsoleMessage',
]);
const MESSAGE_COLLECTIONS = new Set([
  'checks',
  'errors',
  'problems',
  'repairs',
  'repairErrors',
  'warnings',
]);
const CONSOLE_METHODS = new Set(['error', 'log', 'warn']);
const USER_TEXT_VARIABLE = /(?:^HELP_TEXT$|guidance|helpText|message|remediation|summary|usage)$/iu;

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function propertyName(node) {
  if (node?.computed) return null;
  if (node?.key?.type === 'Identifier') return node.key.name;
  if (node?.key?.type === 'StringLiteral') return node.key.value;
  return null;
}

function calleeName(node) {
  return node?.callee?.type === 'Identifier' ? node.callee.name : null;
}

function memberCall(node, objectNames, property) {
  return node?.callee?.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object.type === 'Identifier'
    && objectNames.has(node.callee.object.name)
    && node.callee.property.type === 'Identifier'
    && node.callee.property.name === property;
}

function namedMemberCall(node, objectName, properties) {
  return node?.callee?.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object.type === 'Identifier'
    && node.callee.object.name === objectName
    && node.callee.property.type === 'Identifier'
    && properties.has(node.callee.property.name);
}

function staticFragments(node) {
  if (node == null) return [];
  if (node.type === 'StringLiteral') return [node.value];
  if (node.type === 'TemplateLiteral') {
    return [
      node.quasis.map(({ value }) => value.cooked ?? value.raw).join('${…}'),
      ...node.expressions.flatMap(staticFragments),
    ];
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...staticFragments(node.left), ...staticFragments(node.right)];
  }
  if (node.type === 'LogicalExpression') {
    return [...staticFragments(node.left), ...staticFragments(node.right)];
  }
  if (node.type === 'ConditionalExpression') {
    return [...staticFragments(node.consequent), ...staticFragments(node.alternate)];
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.flatMap(staticFragments);
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.flatMap((property) => (
      property.type === 'ObjectProperty' ? staticFragments(property.value) : []
    ));
  }
  if (node.type === 'ParenthesizedExpression') return staticFragments(node.expression);
  return [];
}

function isMachineIdentifier(word) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(word)
    && (/[A-Z]/u.test(word.slice(1)) || /[_$]/u.test(word));
}

function hasUntranslatedEnglishUserText(text) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized === '' || !LATIN_TEXT.test(normalized)
    || MACHINE_TEXT.test(normalized) || MACHINE_VALUES.has(normalized)) {
    return false;
  }
  if (!HAN_TEXT.test(normalized)) return true;

  const prose = normalized
    .replace(MACHINE_COMMAND, ' ')
    .replace(MACHINE_FRAGMENT, ' ');
  const phrases = prose.match(
    /[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)*/gu,
  ) ?? [];
  return phrases.some((phrase) => {
    const words = phrase.split(/\s+/u);
    if (words.some((word) => UNTRANSLATED_PROSE_WORDS.has(word.toLowerCase()))) {
      return true;
    }
    return words.filter((word) => (
      !ALLOWED_LATIN_WORDS.has(word.toLowerCase()) && !isMachineIdentifier(word)
    )).length >= 2;
  });
}

function candidateFingerprint({ file, context, text }) {
  return createHash('sha256')
    .update([file, context, text].join('\u0000'))
    .digest('hex');
}

function addCandidates(candidates, { file, node, context }) {
  for (const text of staticFragments(node)) {
    const normalized = text.replace(/\s+/gu, ' ').trim();
    if (!hasUntranslatedEnglishUserText(normalized)) continue;
    candidates.push(Object.freeze({
      file,
      line: node?.loc?.start?.line ?? 1,
      context,
      text: normalized,
      fingerprint: candidateFingerprint({ file, context, text: normalized }),
    }));
  }
}

export function collectEnglishUserFacingText(root = process.cwd()) {
  const sourceRoot = path.join(root, 'src');
  const candidates = [];
  for (const absoluteFile of collectJavaScriptFiles(sourceRoot)) {
    const file = path.relative(root, absoluteFile).replaceAll('\\', '/');
    const source = readFileSync(absoluteFile, 'utf8');
    const ast = parse(source, {
      sourceType: 'module',
      plugins: ['importAttributes'],
    });
    traverse(ast, {
      ObjectProperty(nodePath) {
        const name = propertyName(nodePath.node);
        if (!USER_TEXT_PROPERTIES.has(name)) return;
        if ((name === 'remediation' || name === 'evidence')
          && (nodePath.node.value.type === 'ObjectExpression'
            || nodePath.node.value.type === 'ArrayExpression')) return;
        addCandidates(candidates, {
          file,
          node: nodePath.node.value,
          context: `property:${name}`,
        });
      },
      CallExpression(nodePath) {
        const name = calleeName(nodePath.node);
        if (name === 'finding' || name === 'addFinding') {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[1],
            context: `call:${name}:message`,
          });
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[3],
            context: `call:${name}:remediation`,
          });
        }
        if (name === 'governanceViolation') {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[2],
            context: 'call:governanceViolation:message',
          });
        }
        if (name === 'changeSetEntries') {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[1],
            context: 'call:changeSetEntries:label',
          });
        }
        if (name === 'normalizeStagedFiles') {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[2],
            context: 'call:normalizeStagedFiles:label',
          });
        }
        const labelArgumentByCall = new Map([
          ['gitValue', 1],
          ['nonEmptyString', 1],
          ['publicText', 1],
          ['requireNonEmptyString', 1],
          ['requireNonNegativeNumber', 1],
          ['resolveProjectPackageMetadata', 2],
          ['stringArray', 1],
          ['stringList', 1],
        ]);
        if (labelArgumentByCall.has(name)) {
          const argumentIndex = labelArgumentByCall.get(name);
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[argumentIndex],
            context: `call:${name}:label`,
          });
        }
        if (name === 'toRepoGuardError') {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[0],
            context: 'call:toRepoGuardError:fallback',
          });
        }
        if (FIRST_ARGUMENT_MESSAGE_CALLS.has(name)) {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[0],
            context: `call:${name}`,
          });
        }
        if (SECOND_ARGUMENT_MESSAGE_CALLS.has(name)) {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[1],
            context: `call:${name}`,
          });
        }
        if (memberCall(nodePath.node, MESSAGE_COLLECTIONS, 'push')) {
          const collection = nodePath.node.callee.object.name;
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[0],
            context: `collection:${collection}`,
          });
        }
        if (namedMemberCall(nodePath.node, 'console', CONSOLE_METHODS)) {
          addCandidates(candidates, {
            file,
            node: nodePath.node.arguments[0],
            context: `console:${nodePath.node.callee.property.name}`,
          });
        }
      },
      NewExpression(nodePath) {
        const name = calleeName(nodePath.node);
        if (name !== 'Error' && name !== 'TypeError' && name !== 'AggregateError') return;
        addCandidates(candidates, {
          file,
          node: nodePath.node.arguments[name === 'AggregateError' ? 1 : 0],
          context: `new:${name}`,
        });
      },
      VariableDeclarator(nodePath) {
        if (nodePath.node.id.type !== 'Identifier'
          || !USER_TEXT_VARIABLE.test(nodePath.node.id.name)) return;
        addCandidates(candidates, {
          file,
          node: nodePath.node.init,
          context: `variable:${nodePath.node.id.name}`,
        });
      },
      StringLiteral(nodePath) {
        if (!/repo-guard (?:failed|warning|error)/iu.test(nodePath.node.value)) return;
        addCandidates(candidates, {
          file,
          node: nodePath.node,
          context: 'generated:repo-guard-shell-message',
        });
      },
    });
  }
  return Object.freeze(candidates);
}

export function createLanguageDebtBaseline(candidates) {
  const counts = new Map();
  for (const candidate of candidates) {
    counts.set(candidate.fingerprint, (counts.get(candidate.fingerprint) ?? 0) + 1);
  }
  return Object.freeze({
    schemaVersion: 1,
    debtCount: candidates.length,
    entries: Object.freeze(Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    )),
  });
}

export function compareLanguageDebt(candidates, baseline) {
  if (baseline?.schemaVersion !== 1 || baseline.entries == null
    || typeof baseline.entries !== 'object' || Array.isArray(baseline.entries)) {
    throw new TypeError('中文文案迁移基线格式无效。');
  }
  const allowed = new Map(Object.entries(baseline.entries));
  if ([...allowed.values()].some((count) => !Number.isInteger(count) || count < 1)) {
    throw new TypeError('中文文案迁移基线包含无效的条目数量。');
  }
  const baselineCount = [...allowed.values()].reduce((total, count) => total + count, 0);
  if (baselineCount !== baseline.debtCount) {
    throw new TypeError('中文文案迁移基线的债务总数与条目不一致。');
  }
  const seen = new Map();
  const additions = [];
  for (const candidate of candidates) {
    const count = (seen.get(candidate.fingerprint) ?? 0) + 1;
    seen.set(candidate.fingerprint, count);
    if (count > (allowed.get(candidate.fingerprint) ?? 0)) additions.push(candidate);
  }
  return Object.freeze({
    additions: Object.freeze(additions),
    currentDebtCount: candidates.length,
    baselineDebtCount: baseline.debtCount,
    resolvedDebtCount: [...allowed.entries()].reduce(
      (total, [fingerprint, count]) => total + Math.max(
        0,
        count - (seen.get(fingerprint) ?? 0),
      ),
      0,
    ),
  });
}

export function pruneLanguageDebtBaseline(candidates, baseline) {
  const comparison = compareLanguageDebt(candidates, baseline);
  if (comparison.additions.length > 0) {
    throw new TypeError('存在新增英文用户文案，不能裁剪中文迁移基线。');
  }
  return createLanguageDebtBaseline(candidates);
}
