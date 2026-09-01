import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const SAFE_PRESET_FACTORIES = new Map([
  ['unocss', new Set([
    'presetAttributify',
    'presetMini',
    'presetUno',
    'presetWind',
    'presetWind3',
    'presetWind4',
  ])],
  ['@unocss/preset-attributify', new Set(['default', 'presetAttributify'])],
  ['@unocss/preset-mini', new Set(['default', 'presetMini'])],
  ['@unocss/preset-uno', new Set(['default', 'presetUno'])],
  ['@unocss/preset-wind', new Set(['default', 'presetWind'])],
  ['@unocss/preset-wind3', new Set(['default', 'presetWind3'])],
  ['@unocss/preset-wind4', new Set(['default', 'presetWind4'])],
]);
const SAFE_TRANSFORMER_FACTORIES = new Map([
  ['unocss', new Set(['transformerVariantGroup'])],
  ['@unocss/transformer-variant-group', new Set(['default', 'transformerVariantGroup'])],
]);
const UNSAFE_EXTENSION_PROPERTIES = new Set([
  'content',
  'extractors',
  'hooks',
  'postprocess',
  'preflights',
  'safelist',
  'separators',
  'variants',
]);

function relativeFile(root, file) {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  return {
    absolute,
    relative: (path.isAbsolute(file) ? path.relative(root, file) : file).replaceAll('\\', '/'),
  };
}

function location(node) {
  return {
    line: node?.loc?.start.line ?? 1,
    column: (node?.loc?.start.column ?? 0) + 1,
  };
}

function unwrapExpression(node) {
  let current = node;
  while (['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression'].includes(current?.type)) {
    current = current.expression;
  }
  return current;
}

function staticText(node) {
  const current = unwrapExpression(node);
  if (current?.type === 'StringLiteral') return current.value;
  if (current?.type === 'TemplateLiteral' && current.expressions.length === 0) {
    return current.quasis[0]?.value.cooked ?? current.quasis[0]?.value.raw ?? '';
  }
  return null;
}

function propertyName(property) {
  if (property.computed) return staticText(property.key);
  if (property.key?.type === 'Identifier') return property.key.name;
  return staticText(property.key);
}

function configurationObject(program) {
  const bindings = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type === 'Identifier') bindings.set(declaration.id.name, declaration.init);
    }
  }
  const exported = program.body.find(({ type }) => type === 'ExportDefaultDeclaration')?.declaration;
  let current = unwrapExpression(exported);
  if (current?.type === 'Identifier') current = unwrapExpression(bindings.get(current.name));
  if (current?.type === 'CallExpression') current = unwrapExpression(current.arguments[0]);
  return current?.type === 'ObjectExpression' ? current : null;
}

function importedFactories(program) {
  const factories = new Map();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const source = statement.source.value;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') continue;
      const imported = specifier.type === 'ImportDefaultSpecifier'
        ? 'default'
        : (specifier.imported.name ?? specifier.imported.value);
      factories.set(specifier.local.name, { imported, source });
    }
  }
  return factories;
}

function staticData(node) {
  const current = unwrapExpression(node);
  if (!current) return true;
  if ([
    'BooleanLiteral',
    'NullLiteral',
    'NumericLiteral',
    'StringLiteral',
  ].includes(current.type)) return true;
  if (current.type === 'TemplateLiteral') return current.expressions.length === 0;
  if (current.type === 'UnaryExpression') return staticData(current.argument);
  if (current.type === 'ArrayExpression') {
    return current.elements.every((element) => element?.type !== 'SpreadElement' && staticData(element));
  }
  if (current.type === 'ObjectExpression') {
    return current.properties.every((property) => (
      property.type === 'ObjectProperty'
      && propertyName(property) !== null
      && staticData(property.value)
    ));
  }
  return false;
}

function safeFactoryCall(node, factories, allowlist) {
  const current = unwrapExpression(node);
  if (current?.type !== 'CallExpression' || current.callee.type !== 'Identifier') return false;
  const factory = factories.get(current.callee.name);
  if (!factory || !allowlist.get(factory.source)?.has(factory.imported)) return false;
  return current.arguments.every((argument) => argument.type !== 'SpreadElement' && staticData(argument));
}

function extensionFactoriesAreSafe(node, factories, allowlist) {
  const current = unwrapExpression(node);
  return current?.type === 'ArrayExpression' && current.elements.every((element) => (
    element !== null && safeFactoryCall(element, factories, allowlist)
  ));
}

function staticallyEmptyArray(node) {
  const current = unwrapExpression(node);
  return current?.type === 'ArrayExpression' && current.elements.length === 0;
}

function dynamicFact(pathName, node, value) {
  return {
    type: 'configuration-dynamic',
    value,
    path: pathName,
    ...location(node),
  };
}

function shortcutFact(pathName, node, name, expandsTo) {
  return {
    type: 'shortcut-declaration',
    name,
    expandsTo,
    path: pathName,
    ...location(node),
  };
}

function configurationFileFact(pathName) {
  return {
    type: 'configuration-file',
    path: pathName,
    line: 1,
    column: 1,
  };
}

function breakpointFact(pathName, node, name, value) {
  return {
    type: 'breakpoint-declaration',
    name,
    value,
    path: pathName,
    ...location(node),
  };
}

function expansionTokens(node) {
  const text = staticText(node);
  if (text !== null) return text.split(/\s+/).filter(Boolean);
  const current = unwrapExpression(node);
  if (current?.type !== 'ArrayExpression') return null;
  const values = current.elements.map((element) => staticText(element));
  return values.every((value) => value !== null) ? values.flatMap((value) => (
    value.split(/\s+/).filter(Boolean)
  )) : null;
}

function objectShortcutFacts(pathName, object) {
  return object.properties.flatMap((property) => {
    if (property.type !== 'ObjectProperty') {
      return [dynamicFact(pathName, property, 'shortcut 使用了展开、方法或访问器')];
    }
    const name = propertyName(property);
    const expandsTo = expansionTokens(property.value);
    if (!name || !expandsTo || expandsTo.length === 0) {
      return [dynamicFact(pathName, property, 'shortcut 名称或展开值不是静态字符串')];
    }
    return [shortcutFact(pathName, property, name, expandsTo)];
  });
}

function arrayShortcutFacts(pathName, array) {
  return array.elements.flatMap((element) => {
    const current = unwrapExpression(element);
    if (current?.type === 'ObjectExpression') return objectShortcutFacts(pathName, current);
    if (current?.type !== 'ArrayExpression' || current.elements.length !== 2) {
      return [dynamicFact(pathName, current ?? array, 'shortcut 数组项不是静态二元组')];
    }
    const name = staticText(current.elements[0]);
    const expandsTo = expansionTokens(current.elements[1]);
    if (!name || !expandsTo || expandsTo.length === 0) {
      return [dynamicFact(pathName, current, 'shortcut 二元组包含动态匹配器或展开函数')];
    }
    return [shortcutFact(pathName, current, name, expandsTo)];
  });
}

function shortcutFacts(pathName, node) {
  const current = unwrapExpression(node);
  if (current?.type === 'ObjectExpression') return objectShortcutFacts(pathName, current);
  if (current?.type === 'ArrayExpression') return arrayShortcutFacts(pathName, current);
  return [dynamicFact(pathName, current, 'shortcuts 不是静态对象或数组')];
}

function breakpointFacts(pathName, node) {
  const current = unwrapExpression(node);
  if (current?.type !== 'ObjectExpression') {
    return [dynamicFact(pathName, current, 'theme.breakpoints 不是静态对象')];
  }
  return current.properties.flatMap((property) => {
    if (property.type !== 'ObjectProperty') {
      return [dynamicFact(pathName, property, 'theme.breakpoints 使用了无法静态证明的展开或方法')];
    }
    const name = propertyName(property);
    const value = staticText(property.value);
    if (!name || value === null) {
      return [dynamicFact(pathName, property, 'breakpoint 名称或值不是静态字符串')];
    }
    return [breakpointFact(pathName, property, name, value)];
  });
}

function themeFacts(pathName, node) {
  const current = unwrapExpression(node);
  if (current?.type !== 'ObjectExpression') {
    return [dynamicFact(pathName, current, 'theme 无法静态还原，不能证明 breakpoint 契约')];
  }
  return current.properties.flatMap((property) => {
    if (property.type === 'SpreadElement') {
      return [dynamicFact(pathName, property, 'theme 使用了无法静态证明的展开')];
    }
    const name = property.type === 'ObjectProperty' ? propertyName(property) : null;
    return name === 'breakpoints' ? breakpointFacts(pathName, property.value) : [];
  });
}

function inspectConfiguration(source, pathName) {
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
    });
  } catch (error) {
    return [
      configurationFileFact(pathName),
      dynamicFact(pathName, null, `配置无法解析：${error.message}`),
    ];
  }
  const object = configurationObject(ast.program);
  if (!object) {
    return [
      configurationFileFact(pathName),
      dynamicFact(pathName, ast.program, '默认导出无法静态还原为配置对象'),
    ];
  }
  const factories = importedFactories(ast.program);
  const facts = [configurationFileFact(pathName)];
  for (const property of object.properties) {
    const name = property.type === 'ObjectProperty' ? propertyName(property) : null;
    if (name === 'shortcuts') {
      facts.push(...shortcutFacts(pathName, property.value));
    }
    if (name === 'rules') {
      const rules = unwrapExpression(property.value);
      if (rules?.type !== 'ArrayExpression' || rules.elements.length > 0) {
        facts.push({
          type: 'custom-rule',
          value: 'rules',
          path: pathName,
          ...location(property),
        });
      }
    }
    if (name === 'theme') {
      facts.push(...themeFacts(pathName, property.value));
    }
    if (
      name === 'presets'
      && !extensionFactoriesAreSafe(property.value, factories, SAFE_PRESET_FACTORIES)
    ) {
      facts.push(dynamicFact(
        pathName,
        property,
        'presets 包含未受信工厂、动态参数或无法静态证明的配置',
      ));
    }
    if (
      name === 'transformers'
      && !extensionFactoriesAreSafe(property.value, factories, SAFE_TRANSFORMER_FACTORIES)
    ) {
      facts.push(dynamicFact(
        pathName,
        property,
        'transformers 只允许官方 variant-group transformer 的静态调用',
      ));
    }
    if (UNSAFE_EXTENSION_PROPERTIES.has(name) && !staticallyEmptyArray(property.value)) {
      facts.push(dynamicFact(
        pathName,
        property,
        `${name} 可以绕过受控 utility 静态检查`,
      ));
    }
    if (property.type === 'SpreadElement' || property.type === 'ObjectMethod') {
      facts.push(dynamicFact(pathName, property, '顶层配置使用了无法静态证明的展开或方法'));
    }
  }
  return facts;
}

export function collectUnoCssConfigurationFacts({ root, files }) {
  return Object.freeze(files.flatMap((file) => {
    const resolved = relativeFile(root, file);
    const source = readFileSync(resolved.absolute, 'utf8');
    return inspectConfiguration(source, resolved.relative).map((fact) => Object.freeze(fact));
  }));
}
