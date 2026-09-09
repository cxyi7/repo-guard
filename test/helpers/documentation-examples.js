import { parse } from '@babel/parser';

export function parseJsonExample(source, language) {
  if (language === 'json') return JSON.parse(source);
  // 只利用已安装的语法解析器定位注释；去注释后仍必须是严格 JSON，不执行示例。
  const wrapped = `(${source})`;
  const syntax = parse(wrapped, { sourceType: 'module' });
  const characters = wrapped.split('');
  for (const comment of syntax.comments) {
    for (let index = comment.start; index < comment.end; index += 1) characters[index] = ' ';
  }
  return JSON.parse(characters.join('').slice(1, -1));
}

export function jsonExamples(body) {
  return [...body.matchAll(/```(jsonc?)\r?\n([\s\S]*?)```/g)].map((match, index) => ({
    index: index + 1,
    offset: match.index,
    value: parseJsonExample(match[2], match[1]),
  }));
}

export function configurationSchemaField(schema, node, field) {
  if (node?.$ref?.startsWith('#/')) {
    const referenced = node.$ref.slice(2).split('/').reduce((value, part) => value?.[part], schema);
    return configurationSchemaField(schema, referenced, field);
  }
  if (!node) return null;
  const remaining = field.replace(/^\./, '');
  if (!remaining) return node;
  if (remaining.startsWith('[]')) return configurationSchemaField(schema, node.items, remaining.slice(2));
  for (const [property, child] of Object.entries(node.properties ?? {})) {
    if (remaining === property || remaining.startsWith(`${property}.`) || remaining.startsWith(`${property}[`)) {
      return configurationSchemaField(schema, child, remaining.slice(property.length));
    }
  }
  if (remaining.startsWith('*.')) {
    for (const child of Object.values(node.properties ?? {})) {
      const found = configurationSchemaField(schema, child, remaining.slice(2));
      if (found) return found;
    }
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    for (let index = 0; index <= remaining.length; index += 1) {
      if (index !== remaining.length && remaining[index] !== '.') continue;
      const found = configurationSchemaField(schema, node.additionalProperties, remaining.slice(index));
      if (found) return found;
    }
  }
  return null;
}
