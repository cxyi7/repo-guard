import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import {
  executeProjectStylelintRules,
  inspectProjectStylelintRuleInputs,
} from '../stylelint/execution.js';
import { findVueStyleBlocks } from '../vue/template-parser.js';
import { styleBindingNames } from './style-bindings.js';

const FACT_RULE = 'repo-guard/ui-token-style-facts';
const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.css': 'css', '.scss': 'sass', '.sass': 'sass', '.less': 'less',
});
const LANGUAGE_BY_ATTRIBUTE = Object.freeze({ css: 'css', scss: 'sass', sass: 'sass', less: 'less' });

function vueRanges(source) {
  return findVueStyleBlocks(source).map((block) => {
    const lang = block.attributes.find(({ name }) => name === 'lang')?.value;
    return { ...block, language: lang == null ? 'css' : LANGUAGE_BY_ATTRIBUTE[lang.toLowerCase()] };
  });
}

export function isUiTokenStyleFile(file, languages) {
  const extension = path.extname(file).toLowerCase();
  if (extension !== '.vue') return languages.includes(LANGUAGE_BY_EXTENSION[extension]);
  return vueRanges(readFileSync(file, 'utf8')).some(({ language }) => languages.includes(language));
}

function offsetAtLocation(source, { line = 1, column = 1 } = {}) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf('\n', offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return offset + column - 1;
}

function location(node) {
  return { line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1 };
}

function nodeLanguage(node, input, ranges) {
  if (!ranges) return LANGUAGE_BY_EXTENSION[path.extname(input.file).toLowerCase()];
  const offset = offsetAtLocation(input.code, node.source?.start);
  return ranges.find(({ contentStart, contentEnd }) => offset >= contentStart && offset < contentEnd)?.language;
}

function variableName(declaration, language) {
  if (declaration.prop.startsWith('--')) return declaration.prop;
  if (language === 'sass' && /^(?:[\w-]+\.)?\$/.test(declaration.prop)) return declaration.prop;
  if (language === 'less' && declaration.prop.startsWith('@')) return declaration.prop;
  return null;
}

function factPlugin(stylelint, input, file, facts, languages, parsed) {
  const ranges = input.file.toLowerCase().endsWith('.vue') ? vueRanges(input.code) : null;
  const languageOf = (node) => {
    const language = nodeLanguage(node, input, ranges);
    return languages.includes(language) ? language : null;
  };
  const rule = () => (root) => {
    parsed.add(input.file);
    root.walkDecls((declaration) => {
      const language = languageOf(declaration);
      if (!language) return;
      const base = { path: file, language, value: declaration.value, ...location(declaration) };
      const name = variableName(declaration, language);
      if (name) {
        facts.push({ ...base, type: 'variable-definition', name });
        return;
      }
      let ancestor = declaration.parent;
      while (ancestor && ancestor.type !== 'rule') ancestor = ancestor.parent;
      facts.push({
        ...base, type: 'declaration', property: declaration.prop, selector: ancestor?.selector ?? null,
      });
    });
    root.walkAtRules((atRule) => {
      const language = languageOf(atRule);
      if (!language) return;
      const base = { path: file, language, value: atRule.params, ...location(atRule) };
      for (const name of styleBindingNames(atRule, language)) {
        facts.push({ ...base, type: 'variable-definition', name });
      }
      if (['media', 'container'].includes(atRule.name.toLowerCase())) {
        facts.push({ ...base, type: 'responsive-rule', name: atRule.name });
      } else if (atRule.name.toLowerCase() === 'property' && atRule.params.trim().startsWith('--')) {
        facts.push({ ...base, type: 'variable-definition', name: atRule.params.trim() });
      } else if (language === 'less' && (atRule.variable || atRule.name.endsWith(':'))) {
        facts.push({ ...base, type: 'variable-definition', name: `@${atRule.name.replace(/:$/, '')}` });
      }
    });
    root.walkRules((styleRule) => {
      const language = languageOf(styleRule);
      if (!language) return;
      for (const name of styleBindingNames(styleRule, language)) {
        facts.push({
          path: file, language, value: styleRule.selector, ...location(styleRule),
          type: 'variable-definition', name,
        });
      }
    });
  };
  rule.ruleName = FACT_RULE;
  rule.messages = {};
  rule.meta = { url: 'https://www.npmjs.com/package/@cxyi7/repo-guard' };
  return stylelint.createPlugin(FACT_RULE, rule);
}

function configuredInput(input, root, stylelint, facts, languages, parsed) {
  const relative = path.relative(root, input.file).replaceAll('\\', '/');
  const extension = path.extname(input.file).toLowerCase();
  if (extension !== '.css' && !input.projectConfig?.customSyntax) {
    throw configurationError(
      'ui-token/missing-style-syntax',
      `UI Token 无法检查 ${relative}：请在项目 Stylelint 配置中为该文件设置 customSyntax，保留样式变量的原始语法。`,
    );
  }
  // 未选择的样式块不参与解析；保留原始偏移，避免多块 Vue 样式与脚本发生混淆。
  const code = extension === '.vue'
    ? vueRanges(input.code).reduce((source, block) => {
      if (languages.includes(block.language)) return source;
      return source.slice(0, block.contentStart)
        + source.slice(block.contentStart, block.contentEnd).replace(/[^\r\n]/g, ' ')
        + source.slice(block.contentEnd);
    }, input.code)
    : input.code;
  return {
    ...input,
    code,
    config: {
      ...(input.projectConfig?.customSyntax ? { customSyntax: input.projectConfig.customSyntax } : {}),
      plugins: [factPlugin(stylelint, input, relative, facts, languages, parsed)],
      rules: { [FACT_RULE]: true },
    },
  };
}

function assertParsed(report, inputs, parsed, root) {
  const failures = report.results.filter((result) => result.errored || result.ignored
    || (result.parseErrors?.length ?? 0) > 0
    || result.warnings?.some(({ rule }) => rule === 'CssSyntaxError'));
  const missing = inputs.filter(({ file }) => !parsed.has(file));
  if (failures.length === 0 && missing.length === 0) return;
  const files = [...new Set([
    ...failures.map(({ source }) => source), ...missing.map(({ file }) => file),
  ].filter(Boolean))].map((file) => path.relative(root, file).replaceAll('\\', '/'));
  throw configurationError(
    'ui-token/style-parse-failed',
    `UI Token 无法完整解析样式文件：${files.join('、')}。请修正样式语法或项目 Stylelint 的 customSyntax 配置后重试。`,
    { details: { diagnosticSource: 'Stylelint 原始诊断', diagnostics: failures } },
  );
}

export async function collectStyleFacts({ project, root, files, languages }) {
  const selected = files.filter((file) => isUiTokenStyleFile(file, languages));
  if (selected.length === 0) return Object.freeze([]);
  const facts = [];
  const parsed = new Set();
  try {
    const inputs = await inspectProjectStylelintRuleInputs({ project, root, files: selected });
    const report = await executeProjectStylelintRules({
      project, root, bypassProjectIgnores: true, ignoreDisables: true,
      inputs: inputs.map((input) => configuredInput(input, root, project.stylelint, facts, languages, parsed)),
    });
    assertParsed(report, inputs, parsed, root);
  } catch (error) {
    throw toRepoGuardError(error, {
      kind: 'configuration',
      code: 'ui-token/style-parse-failed',
      message: 'UI Token 样式解析失败；请检查项目 Stylelint 配置、customSyntax 安装情况和样式语法。',
      details: { diagnosticSource: 'Stylelint 原始诊断', diagnostic: error.message },
    });
  }
  return Object.freeze(facts.map((fact) => Object.freeze(fact)));
}
