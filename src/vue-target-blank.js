import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import {
  findVueTemplateAttributes,
  sourceLocation,
} from './vue-template-parser.js';

export const VUE_TARGET_BLANK_RULE = 'vue/target-blank-security';
const REQUIRED_REL_TOKENS = Object.freeze(['noopener', 'noreferrer']);
const FORBIDDEN_REL_TOKENS = Object.freeze(['opener']);

function isBinding(name, attribute) {
  return name === `:${attribute}`
    || name === `v-bind:${attribute}`
    || name.startsWith(`:${attribute}.`)
    || name.startsWith(`v-bind:${attribute}.`);
}

function expressionLiteral(value) {
  const text = value?.trim();
  if (!text || text.length < 2) return null;
  const quote = text[0];
  if ((quote !== '"' && quote !== "'" && quote !== '`') || text.at(-1) !== quote) {
    return null;
  }
  return text.slice(1, -1);
}

function resolvedAttributeValue(attribute, name) {
  if (attribute.name === name) return { kind: 'static', value: attribute.value };
  if (isBinding(attribute.name, name)) {
    const value = expressionLiteral(attribute.value);
    return value == null
      ? { kind: 'dynamic', value: null }
      : { kind: 'bound-literal', value };
  }
  return null;
}

function groupAttributesByTag(attributes) {
  const groups = new Map();
  for (const attribute of attributes) {
    if (!groups.has(attribute.tagStart)) groups.set(attribute.tagStart, []);
    groups.get(attribute.tagStart).push(attribute);
  }
  return [...groups.values()];
}

export function findVueTargetBlankIssues(source, relativePath = 'component.vue') {
  const findings = [];
  const tagGroups = groupAttributesByTag(findVueTemplateAttributes(source));
  for (const attributes of tagGroups) {
    const blankTargets = attributes.filter((attribute) => {
      const resolved = resolvedAttributeValue(attribute, 'target');
      return resolved?.value?.toLowerCase() === '_blank';
    });
    if (blankTargets.length === 0) continue;

    const relAttribute = attributes.find((attribute) => (
      attribute.name === 'rel' || isBinding(attribute.name, 'rel')
    ));
    const resolvedRel = relAttribute
      ? resolvedAttributeValue(relAttribute, 'rel')
      : null;
    const relTokens = new Set(
      (resolvedRel?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean),
    );
    const missing = REQUIRED_REL_TOKENS.filter((token) => !relTokens.has(token));
    const forbidden = FORBIDDEN_REL_TOKENS.filter((token) => relTokens.has(token));
    if (missing.length === 0 && forbidden.length === 0) continue;

    for (const target of blankTargets) {
      const location = sourceLocation(source, target.offset);
      findings.push({
        ...location,
        forbidden,
        missing,
        offset: target.offset,
        path: relativePath,
        relKind: resolvedRel?.kind ?? 'missing',
        rule: VUE_TARGET_BLANK_RULE,
        tagName: target.tagName,
      });
    }
  }
  return findings;
}

function normalizeFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replace(/\\/g, '/'),
    };
  });
}

export function inspectVueTargetBlank({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    if (!file.relative.toLowerCase().endsWith('.vue')) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findVueTargetBlankIssues(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}
