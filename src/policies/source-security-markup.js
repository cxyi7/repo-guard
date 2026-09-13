import { inspectSecurityHtml } from './source-security-html.js';
import { parse, parserOptions } from '@vue/compiler-dom';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { executionError } from '../core/error/repo-guard-error.js';
import { expressionString } from './source-security-syntax.js';
import { inspectSecurityAttributes } from './source-security-attributes.js';

function markupFailure(filename, cause) {
  return executionError(
    'source-security/markup-parse-failed',
    `源码安全检查无法完整解析 ${filename} 的模板，未完成检查。`,
    { cause },
  );
}

function inspectMarkup(content, filename, options, add, vue) {
  let ast;
  try {
    ast = parse(content, { comments: true });
  } catch (cause) {
    throw markupFailure(filename, cause);
  }
  const walk = (node) => {
    if (node.type === 1) {
      const attributes = [];
      let spread = false;
      for (const prop of node.props) {
        if (prop.type === 6)
          attributes.push({
            name: prop.name.toLowerCase(),
            value: prop.value?.content ?? '',
            offset: prop.loc.start.offset,
          });
        if (vue && prop.type === 7) {
          if (prop.name === 'html')
            attributes.push({
              name: 'v-html',
              value: null,
              offset: prop.loc.start.offset,
            });
          if (prop.name === 'bind') {
            if (!prop.arg?.isStatic) {
              spread = true;
              continue;
            }
            attributes.push({
              name: prop.arg.content.toLowerCase(),
              value: expressionString(prop.exp?.content ?? ''),
              offset: prop.loc.start.offset,
            });
          }
        }
      }
      const native =
        parserOptions.isNativeTag(vue ? node.tag : node.tag.toLowerCase()) &&
        (!vue || node.tagType === 0);
      inspectSecurityAttributes(
        node.tag.toLowerCase(),
        attributes,
        options,
        add,
        { vue, native, spread },
      );
      if (spread)
        add(
          'source-security/unconfirmed',
          node.loc.start.offset,
          '模板存在动态属性名或属性展开，未检查运行时生成的属性。',
          true,
        );
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(ast);
  return ast;
}

export function inspectSecurityMarkup(
  source,
  filename,
  options,
  add,
  inspectScript,
) {
  if (/\.vue$/i.test(filename)) {
    const { descriptor, errors } = parseSfc(source, { filename });
    if (errors.length) throw markupFailure(filename, errors[0]);
    if (descriptor.template) {
      const template = descriptor.template;
      if ((template.lang && template.lang !== 'html') || template.src)
        add(
          'source-security/unconfirmed',
          template.loc.start.offset,
          '外部模板或非 HTML 模板不在当前解析范围内。',
          true,
        );
      else
        inspectMarkup(
          template.content,
          filename,
          options,
          (rule, offset, message, unknown) =>
            add(rule, offset + template.loc.start.offset, message, unknown),
          true,
        );
    }
    for (const block of [descriptor.script, descriptor.scriptSetup].filter(
      Boolean,
    )) {
      if (
        block.src ||
        (block.lang && !['js', 'ts', 'jsx', 'tsx'].includes(block.lang))
      )
        add(
          'source-security/unconfirmed',
          block.loc.start.offset,
          '外部脚本或不支持的脚本语言未在此文件中检查。',
          true,
        );
      else
        inspectScript(block.content, block.loc.start.offset, block.lang ?? '');
    }
  } else {
    inspectSecurityHtml(source, filename, options, add, inspectScript);
  }
}
