function signatureParameters(signature) {
  const start = signature.indexOf('(');
  if (start === -1) return [];
  let depth = 0;
  let quote = null;
  let current = '';
  const parts = [];
  for (let index = start + 1; index < signature.length; index += 1) {
    const character = signature[index];
    if (character === '\\') {
      current += character + (signature[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if ('([{'.includes(character)) depth += 1;
    else if (character === ')' && depth === 0) return [...parts, current];
    else if (')]}'.includes(character)) depth -= 1;
    else if (depth === 0 && ',;'.includes(character)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  return [];
}

function parameterNames(signature, marker) {
  return signatureParameters(signature).flatMap((parameter) => {
    const name = parameter.trim().match(/^([$@][\w-]+)(?=\s*(?::|\.\.\.|$))/)?.[1];
    return name?.startsWith(marker) ? [name] : [];
  });
}

/** 只提取声明位置的绑定，不把默认值中引用的团队变量误当成重新定义。 */
export function styleBindingNames(node, language) {
  if (language === 'sass' && node.type === 'atrule') {
    const kind = node.name.toLowerCase();
    if (['mixin', 'function'].includes(kind)) return parameterNames(node.params, '$');
    if (kind === 'for') return node.params.match(/^(\$[\w-]+)\s+from\b/)?.slice(1) ?? [];
    if (kind === 'each') {
      const binding = node.params.match(/^(.*?)\s+in\b/)?.[1] ?? '';
      return binding.split(',').map((name) => name.trim()).filter((name) => /^\$[\w-]+$/.test(name));
    }
  }
  if (language === 'less' && node.type === 'rule'
    && /^[.#][\w-]*\s*\(/.test(node.selector)) return parameterNames(node.selector, '@');
  return [];
}
