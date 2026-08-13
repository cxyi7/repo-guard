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

export function buildVueTargetBlankAiInstructions(violations) {
  const lines = ['Vue target="_blank" 安全门禁失败，可将以下指令分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
    const relProblems = violation.relKind === 'dynamic'
      ? ['当前 rel 是动态表达式，门禁无法证明其安全性。']
      : [
        violation.missing.length > 0
          ? `缺少 rel token：${violation.missing.join(', ')}。`
          : '',
        violation.forbidden.length > 0
          ? `存在冲突的 rel token：${violation.forbidden.join(', ')}。`
          : '',
      ].filter(Boolean);
    lines.push(
      '',
      `${index + 1}. 请修复 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的 target="_blank"。`,
      `   规则：${violation.rule}`,
      `   标签：<${violation.tagName}>；${relProblems.join(' ')}`,
      '   修复要求：在同一标签使用可静态验证的 rel="noopener noreferrer"；已有其他 rel token 可以保留。',
      '   禁止绕过：AI 不得删除必要的 target、改成不可分析的动态绑定、关闭门禁，或新增、延期、修改结构化例外。',
      '   验证要求：确认新窗口行为、来源页安全和业务跳转保持正确，并运行项目已有的 lint、测试和构建命令。',
    );
  });
  lines.push('', `共 ${violations.length} 处不安全的 target="_blank"，提交已停止。`);
  return lines.join('\n');
}
