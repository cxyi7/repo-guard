/** 判断模块公开函数；不把公开函数内的局部回调当作公开 API。 */
export function isPublicFunction(target, ast) {
  let current = target.functionPath;
  while (current.parentPath && !current.parentPath.isProgram()) {
    if (current !== target.functionPath && current.isFunction()) return false;
    if (current.node.type === 'ClassPrivateMethod' || current.node.type === 'ClassPrivateProperty'
      || current.node.accessibility === 'private' || current.node.accessibility === 'protected') return false;
    current = current.parentPath;
  }
  if (current.isExportNamedDeclaration() || current.isExportDefaultDeclaration()) return true;
  const names = new Set(ast.program.body.filter((node) => node.type === 'ExportNamedDeclaration' && !node.source)
    .flatMap((node) => node.specifiers.map((specifier) => specifier.local?.name)));
  if (current.node.id?.name && names.has(current.node.id.name)) return true;
  return current.node.type === 'VariableDeclaration'
    && current.node.declarations.some((declaration) => names.has(declaration.id?.name));
}

function description(block, parameter = false) {
  let text = block.lines.join(' ').replace(/^@[\w-]+\s*/, '').trim();
  if (text.startsWith('{')) {
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1;
      if (text[index] === '}' && --depth === 0) { text = text.slice(index + 1).trim(); break; }
    }
  }
  if (parameter) text = text.replace(/^(?:\[[^\]]+\]|\S+)\s*/, '');
  return text.replace(/^[-:：]\s*/, '').trim();
}

export function missingFunctionDocumentation({ blocks, parameters, returns, throws, config }) {
  const missing = [];
  const has = (tags, parameter = false) => blocks.some((block) => tags.includes(block.tag) && description(block, parameter));
  if (config.requireDescription && !has([null, 'description'])) missing.push('函数用途说明');
  if (config.requireParamDescription) {
    for (const parameter of parameters) {
      const found = blocks.find((block) => ['param', 'arg', 'argument'].includes(block.tag)
        && block.parameterName === parameter.normalized);
      if (!found || !description(found, true)) missing.push(`参数 ${parameter.display} 的含义、必要的单位或约束`);
    }
  }
  if (config.requireReturnsDescription && returns && !has(['returns', 'return'])) missing.push('返回值说明');
  if (config.requireThrowsDescription && throws && !has(['throws', 'exception'])) missing.push('异常说明');
  if (config.requireSideEffectsDescription && !has(['remarks'])) missing.push('@remarks 副作用说明（无副作用时明确说明）');
  return missing;
}
