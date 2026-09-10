import { findStructuredException } from './exception-registry.js';

export const UI_TOKEN_RULES = Object.freeze([
  'ui-token/raw-value',
  'ui-token/unknown-token',
  'ui-token/category-mismatch',
  'ui-token/stale-manifest',
  'ui-token/unapproved-definition',
  'ui-token/unapproved-breakpoint',
  'ui-token/unprovable-dynamic-usage',
]);

const SAFE_CONSTANTS = new Set([
  '0',
  'auto',
  'inherit',
  'initial',
  'unset',
  'normal',
  'transparent',
  'currentcolor',
  'none',
]);
const CSS_NAMED_COLORS = new Set(`
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
  blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue
  cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
  darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
  darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
  lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey
  lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite
  navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell
  sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
  teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas
  canvastext field fieldtext graytext highlight highlighttext linktext mark marktext
  selecteditem selecteditemtext visitedtext
`.trim().split(/\s+/));

function aliasesByLanguage(manifest, language) {
  const entries = manifest.tokens.flatMap((token) => (token.aliases[language] ?? []).map((alias) => [
    alias,
    token,
  ]));
  const shared = language === 'css' ? [] : manifest.tokens
    .filter(({ category }) => category !== 'breakpoint')
    .flatMap((token) => (token.aliases.css ?? []).map((alias) => [alias, token]));
  return new Map([...shared, ...entries]);
}

function policyFinding(fact, rule, message, expected, remediation, evidence = null) {
  return {
    rule,
    issue: rule,
    path: fact.path,
    line: fact.line,
    column: fact.column,
    message,
    expected,
    remediation,
    ...(evidence ? { evidence } : {}),
  };
}

function directPropertyCategories(property, iconContext = false) {
  const normalized = property.toLowerCase();
  if (/^(?:color|background-color|border(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?-color|outline-color|text-decoration-color|caret-color|column-rule-color|fill|stroke)$/.test(normalized)) return ['color'];
  if (/^(?:margin|padding)(?:-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end))?$/.test(normalized)) return ['spacing'];
  if (/^(?:gap|row-gap|column-gap|top|right|bottom|left|inset|inset-inline(?:-(?:start|end))?|inset-block(?:-(?:start|end))?|scroll-margin(?:-.+)?|scroll-padding(?:-.+)?)$/.test(normalized)) return ['spacing'];
  if (normalized === 'font-family') return ['font-family'];
  if (normalized === 'font-size') return ['font-size'];
  if (normalized === 'line-height') return ['line-height'];
  if (normalized === 'font-weight') return ['font-weight'];
  if (/^border(?:(?:-(?:top|right|bottom|left)-(?:left|right))|(?:-(?:start|end)-(?:start|end)))?-radius$/.test(normalized)) return ['radius'];
  if (['box-shadow', 'text-shadow'].includes(normalized)) return ['shadow'];
  if (normalized === 'z-index') return ['z-index'];
  if (['transition-duration', 'animation-duration'].includes(normalized)) {
    return ['animation-duration'];
  }
  if (iconContext && ['width', 'height', 'inline-size', 'block-size'].includes(normalized)) {
    return ['icon-size'];
  }
  return [];
}

function hasRawColorSyntax(value) {
  const inspectable = value
    .replace(/\burl\((?:[^()]|\([^()]*\))*\)/gi, ' ')
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, ' ');
  if (/#(?:[\da-f]{3,8})\b/i.test(inspectable)) return true;
  if (/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\(/i.test(inspectable)) return true;
  if (/\bvar\(/i.test(inspectable)) return true;
  return [...inspectable.matchAll(/\b[a-z][a-z0-9-]*\b/gi)]
    .some(([word]) => CSS_NAMED_COLORS.has(word.toLowerCase()));
}

function embeddedCategories(property, value) {
  const normalized = property.toLowerCase();
  const categories = [];
  if (/^(?:background|border(?:-.+)?|outline|text-decoration|column-rule)$/.test(normalized)
    && (hasRawColorSyntax(value) || /[$@](?:[\w-]+)/.test(value)
      || /\b[a-z][\w.-]*\(/i.test(value))) {
    categories.push('color');
  }
  if (normalized === 'font') {
    categories.push('font-family', 'font-size', 'line-height', 'font-weight');
  }
  if (['animation', 'transition'].includes(normalized)
    && /[$@][\w-]+|\b\d*\.?\d+(?:ms|s)\b|\b(?:var|calc|min|max|clamp)\(/i.test(value)) {
    categories.push('animation-duration');
  }
  if (normalized === 'filter' && /drop-shadow\(/i.test(value)) categories.push('shadow');
  return categories;
}

function escapeExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectorMatches(selector, matcher) {
  const escaped = escapeExpression(matcher);
  if (/^[a-z][a-z0-9-]*$/i.test(matcher)) {
    return new RegExp(`(?:^|[\\s>+~,(])${escaped}(?=$|[\\s>+~.#[:)])`).test(selector);
  }
  const prefix = ['.', '#', '['].some((marker) => matcher.startsWith(marker))
    ? ''
    : '(?:^|[^a-zA-Z0-9_-])';
  return new RegExp(`${prefix}${escaped}(?=$|[^a-zA-Z0-9_-])`).test(selector);
}

function isIconContext(fact, iconSelectors) {
  return typeof fact.selector === 'string' && iconSelectors.some((selector) => (
    selectorMatches(fact.selector, selector)
  ));
}

function styleVariables(value) {
  value = value.replace(/\burl\((?:[^()]|\([^()]*\))*\)/gi, ' ')
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, ' ');
  const css = [...value.matchAll(/\bvar\(\s*(--[\w-]+)/g)]
    .map(([, name]) => 'var(' + name + ')');
  const preprocessors = [...value.matchAll(/(?:[\w-]+\.)?\$[\w-]+|@[\w-]+/g)].map(([name]) => name);
  return [...css, ...preprocessors];
}

function matchingAliases(value, aliasMap) {
  let remaining = value;
  const matches = [];
  const entries = [...aliasMap.entries()]
    .sort(([left], [right]) => right.length - left.length);
  for (const entry of entries) {
    const [alias] = entry;
    if (!aliasExpression(alias).test(remaining)) continue;
    matches.push(entry);
    remaining = remaining.replace(aliasExpression(alias), ' ');
  }
  return matches;
}

function aliasExpression(alias) {
  const cssVariable = alias.match(/^var\((--[\w-]+)\)$/);
  if (cssVariable) return new RegExp('(?<![a-z0-9_-])var\\(\\s*' + escapeExpression(cssVariable[1]) + '\\s*\\)', 'g');
  const firstBoundary = /^(?:[a-z0-9_-]|[$@])/i.test(alias) ? '(?<![a-z0-9_$@.-])' : '';
  const lastBoundary = /[a-z0-9_-]$/i.test(alias) ? '(?![a-z0-9_-])' : '';
  return new RegExp(firstBoundary + escapeExpression(alias) + lastBoundary, 'g');
}

function removeAliases(value, matches) {
  return matches.reduce(
    (remaining, [alias]) => remaining.replace(aliasExpression(alias), ' '),
    value,
  );
}

function unmanagedVariables(value, matches) {
  return styleVariables(removeAliases(value, matches));
}

function directRemainderIsSafe(value, matches) {
  const withoutAliases = removeAliases(value, matches);
  const withoutConstants = withoutAliases.replace(
    /\b(?:auto|inherit|initial|unset|normal|transparent|currentcolor|none)\b|\b0\b/gi,
    ' ',
  );
  return !/[^\s,/]/.test(withoutConstants);
}

function directValueIsConstant(value, categories) {
  const parts = value.split(/[\s,/]+/).filter(Boolean);
  if (categories.includes('shadow')) {
    return parts.length === 1 && ['inherit', 'initial', 'unset', 'none'].includes(
      parts[0].toLowerCase(),
    );
  }
  return parts.every((part) => SAFE_CONSTANTS.has(part.toLowerCase()));
}

function rawValueMessage(fact, categories) {
  return policyFinding(
    fact,
    'ui-token/raw-value',
    `${fact.property} 使用了未受 UI Token 管理的值：${fact.value}`,
    `${categories.join('、')} 类样式必须引用 UI Token Manifest 中声明的 样式 Token`,
    '将原始值替换为对应的 样式 Token；不得使用计算、原始 fallback 或等值字面量绕过。',
  );
}

function fontRemainderIsSafe(value) {
  const withoutObliqueAngle = value.replace(
    /\boblique(?:\s+-?\d*\.?\d+(?:deg|grad|rad|turn)){0,2}\b/gi,
    ' ',
  );
  const withoutKeywords = withoutObliqueAngle.replace(
    /\b(?:auto|inherit|initial|unset|normal|none|italic|small-caps|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded)\b/gi,
    ' ',
  );
  return !/[^\s,/]/.test(withoutKeywords);
}

function inspectStyleFact(fact, aliasMap, iconSelectors) {
  fact = { ...fact, value: decodeStyleEscapes(fact.value), property: decodeStyleEscapes(fact.property ?? '') };
  if (fact.type === 'responsive-rule') return inspectResponsiveFact(fact, aliasMap);
  if (/#\{|@\{|@@/.test(fact.property)) return [dynamicFinding(fact)];
  const direct = directPropertyCategories(
    fact.property,
    isIconContext(fact, iconSelectors),
  );
  const embedded = direct.length > 0 ? [] : embeddedCategories(fact.property, fact.value);
  const categories = [...new Set([...direct, ...embedded])];
  if (categories.length === 0) return [];
  if (/#\{|@\{|@@|`/.test(fact.value)) return [dynamicFinding(fact)];
  if (direct.length > 0 && directValueIsConstant(fact.value, categories)) return [];
  const matches = matchingAliases(fact.value, aliasMap);
  for (const [alias, token] of matches) {
    if (!categories.includes(token.category)) {
      return [policyFinding(
        fact,
        'ui-token/category-mismatch',
        `${alias} 是 ${token.category} Token，不能用于 ${fact.property}`,
        `${fact.property} 只使用 ${categories.join('、')} 类 Token`,
        '改用与当前样式属性类别一致的 样式 Token。',
      )];
    }
  }
  if (direct.length > 0) {
    const unknown = unmanagedVariables(fact.value, matches)[0];
    if (unknown) {
      return [policyFinding(
        fact,
        'ui-token/unknown-token',
        `${fact.property} 使用了 Manifest 未声明的 样式 Token：${unknown}`,
        `${categories.join('、')} 类样式只使用已声明 Token`,
        '在 Manifest 中登记已有设计 Token，或改用已经批准的 样式 Token。',
      )];
    }
    if (matches.length === 0 || !directRemainderIsSafe(fact.value, matches)) {
      return [rawValueMessage(fact, categories)];
    }
    return [];
  }
  const embeddedUnknown = unmanagedVariables(fact.value, matches)[0];
  if (embeddedUnknown) {
    return [policyFinding(
      fact,
      'ui-token/unknown-token',
      `${fact.property} 使用了 Manifest 未声明的 样式 Token：${embeddedUnknown}`,
      `${categories.join('、')} 类样式只使用已声明 Token`,
      '将简写中的受控值改为 Manifest 中已批准的 样式 Token，或拆分为可验证的长属性。',
    )];
  }
  const valueWithoutAliases = removeAliases(fact.value, matches);
  const hasRawFont = categories.some((category) => [
    'font-family',
    'font-size',
    'line-height',
    'font-weight',
  ].includes(category)) && !fontRemainderIsSafe(valueWithoutAliases);
  const hasRawShadow = categories.includes('shadow') && (
    /\b\d*\.?\d+(?:[a-z%]+)?\b/i.test(valueWithoutAliases)
    || hasRawColorSyntax(valueWithoutAliases)
  );
  const hasRawDuration = categories.includes('animation-duration')
    && /\b\d*\.?\d+(?:ms|s)\b|\b(?:var|calc|min|max|clamp)\(/i.test(valueWithoutAliases);
  const hasRawColor = categories.includes('color') && (
    hasRawColorSyntax(valueWithoutAliases) || hasUnapprovedColorFunction(valueWithoutAliases)
  );
  if (
    hasRawFont
    || hasRawShadow
    || hasRawDuration
    || hasRawColor
    || /\bcalc\(/i.test(valueWithoutAliases)
  ) {
    return [rawValueMessage(fact, categories)];
  }
  return [];
}

function applyExceptions(findings, exceptions) {
  const approved = [];
  const violations = findings.filter((finding) => {
    const exception = findStructuredException(exceptions, finding);
    if (!exception) return true;
    approved.push({ ...finding, exception });
    return false;
  });
  return { approved, violations };
}

function dynamicFinding(fact) {
  return policyFinding(
    fact,
    'ui-token/unprovable-dynamic-usage',
    `受控样式包含无法静态确认的动态表达式：${fact.name ?? fact.property ?? ''} ${fact.value}`,
    '受控值使用清单登记的完整引用，不通过插值或动态求值拼接',
    '将动态样式拆分为明确的变量引用，并分别登记允许的 Token。',
  );
}

function inspectResponsiveFact(fact, aliasMap) {
  if (/#\{|@\{|@@|`/.test(fact.value)) return [dynamicFinding(fact)];
  const matches = matchingAliases(fact.value, aliasMap);
  const invalid = matches.find(([, token]) => token.category !== 'breakpoint');
  if (invalid) return [policyFinding(
    fact, 'ui-token/category-mismatch',
    `${invalid[0]} 是 ${invalid[1].category} Token，不能作为响应式断点`,
    '响应式条件只使用 breakpoint 类 Token',
    '改用当前语言已登记的断点引用。',
  )];
  const unknown = unmanagedVariables(fact.value, matches)[0];
  if (unknown) return [policyFinding(
    fact, 'ui-token/unknown-token',
    `响应式条件使用了未批准的变量：${unknown}`,
    'CSS 断点使用登记的正长度值，Sass 和 Less 使用登记的断点变量',
    'CSS 的 var() 不适用于媒体查询条件；请使用清单中允许的断点写法。',
  )];
  const remaining = removeAliases(fact.value, matches);
  if (/\b\d*\.?\d+(?:[a-z][a-z0-9-]*|%)?\b|\b(?:var|calc|min|max|clamp)\(/i.test(remaining)) {
    return [policyFinding(
      fact, 'ui-token/unapproved-breakpoint',
      `响应式条件使用了未批准的断点：${fact.value}`,
      '所有断点与当前语言的 breakpoint 清单完全匹配',
      'CSS 使用登记的 px、em 或 rem 值；Sass 和 Less 使用登记的断点变量。',
    )];
  }
  return [];
}

function inspectDefinition(fact, aliasMap, sourcePaths) {
  if (sourcePaths.has(fact.path)) return [];
  if (/#\{|@\{|@@/.test(fact.name)) return [dynamicFinding(fact)];
  const registeredNames = new Set([...aliasMap.keys()].flatMap((alias) => (
    styleVariables(alias).map((reference) => reference.match(/^var\((.+)\)$/)?.[1] ?? reference)
  )));
  if (!registeredNames.has(decodeStyleEscapes(fact.name))) return [];
  return [policyFinding(
    fact, 'ui-token/unapproved-definition',
    `在 Token 来源文件之外重新定义了已登记变量：${fact.name}`,
    '团队设计变量只在 Manifest sources 中声明的文件内定义',
    '删除局部覆盖并引用团队变量；调整设计值时修改来源文件并重新生成清单。',
  )];
}

function decodeStyleEscapes(value) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi, (_, hex, character) => {
    if (character !== undefined) return character;
    const point = Number.parseInt(hex, 16);
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
      ? '\uFFFD' : String.fromCodePoint(point);
  }).replace(/\bvar\(/gi, 'var(');
}

function hasUnapprovedColorFunction(value) {
  const remainder = value.replace(/\burl\((?:[^()]|\([^()]*\))*\)/gi, ' ')
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, ' ');
  const allowed = new Set(['linear-gradient', 'radial-gradient', 'conic-gradient',
    'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
    'image-set', 'cross-fade', 'image', 'type']);
  return [...remainder.matchAll(/\b([a-z][\w.-]*)\(/gi)]
    .some(([, name]) => !allowed.has(name.toLowerCase()));
}

export function inspectUiTokens({ config, manifest, deletedContractPaths = [], styleFacts = [] }) {
  const findings = [];
  for (const deletedPath of new Set(deletedContractPaths)) {
    findings.push(policyFinding(
      { path: deletedPath, line: 1, column: 1 }, 'ui-token/stale-manifest',
      `UI Token 契约文件已在暂存区删除：${deletedPath}`,
      '启用 UI Token 门禁时，清单和来源文件必须存在于提交后的 Git 快照',
      '恢复该文件并同步清单；调整来源时一并修改项目生成器和清单。',
    ));
  }
  for (const source of manifest.sources) {
    if (source.sha256 === source.actualSha256) continue;
    findings.push(policyFinding(
      { path: source.path, line: 1, column: 1 }, 'ui-token/stale-manifest',
      `UI Token 来源文件与 Manifest 指纹不一致：${source.path}`,
      '清单中每个来源指纹对应当前检查快照',
      '运行项目的 Token 清单生成脚本，检查结果后重新暂存来源文件和清单。',
    ));
  }
  const sourcePaths = new Set(manifest.sources.map(({ path }) => path));
  const aliasMaps = new Map(config.languages.map((language) => [
    language, aliasesByLanguage(manifest, language),
  ]));
  for (const fact of styleFacts) {
    const aliasMap = aliasMaps.get(fact.language);
    if (!aliasMap) continue;
    findings.push(...(fact.type === 'variable-definition'
      ? inspectDefinition(fact, aliasMap, sourcePaths)
      : inspectStyleFact(fact, aliasMap, config.iconSelectors)));
  }
  return { ...applyExceptions(findings, config.exceptions), checkedStyleFacts: styleFacts.length };
}
