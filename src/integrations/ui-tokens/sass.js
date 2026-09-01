import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  executeProjectStylelintRules,
  inspectProjectStylelintRuleInputs,
} from '../stylelint/execution.js';
import { findVueStyleBlocks } from '../vue/template-parser.js';

const FACT_RULE = 'repo-guard/ui-token-sass-facts';

function location(node) {
  return {
    line: node.source?.start?.line ?? 1,
    column: node.source?.start?.column ?? 1,
  };
}

function factPlugin(stylelint, file, facts, includesNode) {
  const rule = () => (root) => {
    root.walkDecls((declaration) => {
      if (!includesNode(declaration)) return;
      let ancestor = declaration.parent;
      while (ancestor && ancestor.type !== 'rule') ancestor = ancestor.parent;
      facts.push({
        type: 'declaration',
        path: file,
        property: declaration.prop,
        selector: ancestor?.selector ?? null,
        value: declaration.value,
        ...location(declaration),
      });
    });
    root.walkAtRules((atRule) => {
      if (includesNode(atRule) && ['media', 'container'].includes(atRule.name.toLowerCase())) {
        facts.push({
          type: 'responsive-rule',
          path: file,
          name: atRule.name,
          value: atRule.params,
          ...location(atRule),
        });
      }
    });
  };
  rule.ruleName = FACT_RULE;
  rule.messages = {};
  rule.meta = { url: 'https://www.npmjs.com/package/@cxyi7/repo-guard' };
  return stylelint.createPlugin(FACT_RULE, rule);
}

function lineAtOffset(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

export function sassVueStyleLineRanges(source) {
  return findVueStyleBlocks(source)
    .filter(({ attributes }) => attributes.some(({ name, value }) => (
      name === 'lang' && ['sass', 'scss'].includes(value?.toLowerCase())
    )))
    .map(({ contentStart, contentEnd }) => ({
      end: lineAtOffset(source, contentEnd),
      start: lineAtOffset(source, contentStart),
    }));
}

function sassNodeFilter(file) {
  if (!file.toLowerCase().endsWith('.vue')) return () => true;
  const source = readFileSync(file, 'utf8');
  const ranges = sassVueStyleLineRanges(source);
  return (node) => ranges.some(({ start, end }) => {
    const line = node.source?.start?.line ?? 1;
    return line >= start && line <= end;
  });
}

export async function collectSassStyleFacts({ project, root, files }) {
  const inputs = await inspectProjectStylelintRuleInputs({ project, root, files });
  const facts = [];
  await executeProjectStylelintRules({
    project,
    root,
    bypassProjectIgnores: true,
    ignoreDisables: true,
    inputs: inputs.map((input) => {
      const relative = path.relative(root, input.file).replaceAll('\\', '/');
      return {
        ...input,
        config: {
          ...(input.projectConfig?.customSyntax
            ? { customSyntax: input.projectConfig.customSyntax }
            : {}),
          plugins: [factPlugin(
            project.stylelint,
            relative,
            facts,
            sassNodeFilter(input.file),
          )],
          rules: { [FACT_RULE]: true },
        },
      };
    }),
  });
  return Object.freeze(facts.map((fact) => Object.freeze(fact)));
}
