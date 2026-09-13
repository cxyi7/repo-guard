import { parse } from 'parse5';
import { executionError } from '../core/error/repo-guard-error.js';
import { inspectSecurityAttributes } from './source-security-attributes.js';

/** 按 HTML 语法解析，允许标准的可省略闭合标签；不借用 Vue 模板的闭合要求。 */
export function inspectSecurityHtml(
  source,
  filename,
  options,
  add,
  inspectScript,
) {
  const errors = [];
  const ast = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => errors.push(error),
  });
  const invalid = errors.filter((error) => error.code !== 'missing-doctype');
  if (invalid.length)
    throw executionError(
      'source-security/html-parse-failed',
      `源码安全检查发现 ${filename} 的 HTML 语法错误，未完成检查。`,
    );
  const walk = (node) => {
    if (node.tagName) {
      const attributes = (node.attrs ?? []).map((attribute) => ({
        name: attribute.prefix
          ? `${attribute.prefix}:${attribute.name}`
          : attribute.name,
        value: attribute.value,
        offset:
          node.sourceCodeLocation?.attrs?.[attribute.name]?.startOffset ??
          node.sourceCodeLocation?.startOffset ??
          0,
      }));
      inspectSecurityAttributes(node.tagName, attributes, options, add);
      if (node.tagName === 'script') {
        const type =
          attributes.find((attribute) => attribute.name === 'type')?.value ??
          '';
        if (
          ['', 'module', 'text/javascript', 'application/javascript'].includes(
            type.toLowerCase(),
          )
        ) {
          for (const child of node.childNodes ?? [])
            if (child.nodeName === '#text')
              inspectScript(
                source.slice(child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset),
                child.sourceCodeLocation.startOffset,
                'js',
              );
        }
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(ast);
}
