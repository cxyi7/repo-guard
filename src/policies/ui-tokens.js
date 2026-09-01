import { findStructuredException } from './exception-registry.js';

export const UI_TOKEN_RULES = Object.freeze([
  'ui-token/raw-value',
  'ui-token/unknown-token',
  'ui-token/category-mismatch',
  'ui-token/stale-manifest',
  'ui-token/untracked-unocss-config',
  'ui-token/unapproved-shortcut',
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
`.trim().split(/\s+/));

function aliasesByAdapter(manifest, adapter) {
  const entries = manifest.tokens.flatMap((token) => token.aliases[adapter].map((alias) => [
    alias,
    token,
  ]));
  return new Map(entries);
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
    && (hasRawColorSyntax(value) || /\$(?:[\w-]+)/.test(value))) {
    categories.push('color');
  }
  if (normalized === 'font') {
    categories.push('font-family', 'font-size', 'line-height', 'font-weight');
  }
  if (['animation', 'transition'].includes(normalized)
    && /\$[\w-]+|\b\d*\.?\d+(?:ms|s)\b|\b(?:var|calc|min|max|clamp)\(/i.test(value)) {
    categories.push('animation-duration');
  }
  if (normalized === 'filter' && /drop-shadow\(/i.test(value)) categories.push('shadow');
  return categories;
}

function escapeExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sassSelectorMatches(selector, matcher) {
  const escaped = escapeExpression(matcher);
  if (/^[a-z][a-z0-9-]*$/i.test(matcher)) {
    return new RegExp(`(?:^|[\\s>+~,(])${escaped}(?=$|[\\s>+~.#[:)])`).test(selector);
  }
  const prefix = ['.', '#', '['].some((marker) => matcher.startsWith(marker))
    ? ''
    : '(?:^|[^a-zA-Z0-9_-])';
  return new RegExp(`${prefix}${escaped}(?=$|[^a-zA-Z0-9_-])`).test(selector);
}

function isSassIconContext(fact, iconConfig) {
  return typeof fact.selector === 'string' && iconConfig.sassSelectors.some((selector) => (
    sassSelectorMatches(fact.selector, selector)
  ));
}

function sassVariables(value) {
  return [...value.matchAll(/\$[\w-]+/g)].map(([variable]) => variable);
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
  const firstBoundary = /^[a-z0-9_-]/i.test(alias) ? '(?<![a-z0-9_-])' : '';
  const lastBoundary = /[a-z0-9_-]$/i.test(alias) ? '(?![a-z0-9_-])' : '';
  return new RegExp(`${firstBoundary}${escapeExpression(alias)}${lastBoundary}`, 'g');
}

function removeAliases(value, matches) {
  return matches.reduce(
    (remaining, [alias]) => remaining.replace(aliasExpression(alias), ' '),
    value,
  );
}

function unmanagedVariables(value, matches) {
  return sassVariables(removeAliases(value, matches));
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
    `${categories.join('、')} 类样式必须引用 UI Token Manifest 中声明的 Sass Token`,
    '将原始值替换为对应的 Sass Token；不得使用计算、原始 fallback 或等值字面量绕过。',
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

function inspectSassFact(fact, aliasMap, iconConfig) {
  if (fact.type === 'responsive-rule') {
    const matches = matchingAliases(fact.value, aliasMap);
    const invalid = matches.find(([, token]) => token.category !== 'breakpoint');
    if (invalid) {
      const [alias, token] = invalid;
      return [policyFinding(
        fact,
        'ui-token/category-mismatch',
        `${alias} 是 ${token.category} Token，不能作为响应式断点`,
        '响应式条件只使用 breakpoint 类 Token',
        '改用 UI Token Manifest 中声明的 breakpoint Sass 别名。',
      )];
    }
    const unknown = unmanagedVariables(fact.value, matches)[0];
    if (unknown) {
      return [policyFinding(
        fact,
        'ui-token/unknown-token',
        `响应式条件使用了未声明的 Sass Token：${unknown}`,
        '响应式条件只使用 breakpoint 类 Token',
        '改用 UI Token Manifest 中声明的 breakpoint Sass 别名。',
      )];
    }
    const withoutAliases = removeAliases(fact.value, matches);
    const hasRawBreakpoint = /\b\d*\.?\d+(?:[a-z%]+)?\b|\b(?:var|calc|min|max|clamp)\(/i
      .test(withoutAliases);
    if (!hasRawBreakpoint && matches.length === 0) return [];
    return hasRawBreakpoint || matches.length === 0 ? [policyFinding(
      fact,
      'ui-token/raw-value',
      `响应式条件使用了原始断点：${fact.value}`,
      '响应式断点必须引用 UI Token Manifest 中的 breakpoint Token',
      '将原始断点替换为批准的 Sass breakpoint Token。',
    )] : [];
  }
  const direct = directPropertyCategories(
    fact.property,
    isSassIconContext(fact, iconConfig),
  );
  const embedded = embeddedCategories(fact.property, fact.value);
  const categories = [...new Set([...direct, ...embedded])];
  if (categories.length === 0) return [];
  if (direct.length > 0 && directValueIsConstant(fact.value, categories)) return [];
  const matches = matchingAliases(fact.value, aliasMap);
  for (const [alias, token] of matches) {
    if (!categories.includes(token.category)) {
      return [policyFinding(
        fact,
        'ui-token/category-mismatch',
        `${alias} 是 ${token.category} Token，不能用于 ${fact.property}`,
        `${fact.property} 只使用 ${categories.join('、')} 类 Token`,
        '改用与当前样式属性类别一致的 Sass Token。',
      )];
    }
  }
  if (direct.length > 0) {
    const unknown = unmanagedVariables(fact.value, matches)[0];
    if (unknown) {
      return [policyFinding(
        fact,
        'ui-token/unknown-token',
        `${fact.property} 使用了 Manifest 未声明的 Sass Token：${unknown}`,
        `${categories.join('、')} 类样式只使用已声明 Token`,
        '在 Manifest 中登记已有设计 Token，或改用已经批准的 Sass Token。',
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
      `${fact.property} 使用了 Manifest 未声明的 Sass Token：${embeddedUnknown}`,
      `${categories.join('、')} 类样式只使用已声明 Token`,
      '将简写中的受控值改为 Manifest 中已批准的 Sass Token，或拆分为可验证的长属性。',
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
  const hasRawColor = categories.includes('color') && hasRawColorSyntax(valueWithoutAliases);
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

function splitVariants(token) {
  const segments = [];
  let current = '';
  let squareDepth = 0;
  let roundDepth = 0;
  for (const character of token) {
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth -= 1;
    if (character === ':' && squareDepth === 0 && roundDepth === 0) {
      segments.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  segments.push(current);
  return { base: segments.at(-1).replace(/^!/, ''), variants: segments.slice(0, -1) };
}

function isIconContext(fact, iconConfig) {
  if (!fact.tagName) return false;
  const tagName = fact.tagName.toLowerCase();
  return (iconConfig.nativeSvg && tagName === 'svg')
    || iconConfig.components.some((component) => component.toLowerCase() === tagName);
}

function suffixUsesScale(suffix) {
  return /^(?:\d+(?:\.\d+)?|px|full)$/.test(suffix);
}

function utilityCategories(base, iconContext) {
  const normalized = base.replace(/^-/, '');
  const arbitraryProperty = normalized.match(/^\[([a-z-]+):(.+)\]$/i);
  if (arbitraryProperty) {
    return [...new Set([
      ...directPropertyCategories(arbitraryProperty[1], iconContext),
      ...embeddedCategories(arbitraryProperty[1], arbitraryProperty[2]),
    ])];
  }
  if (/^(?:bg|text|border|outline|ring|divide|placeholder)-opacity-/.test(normalized)) return [];
  if (/^bg-(?:fixed|local|scroll|bottom|center|left(?:-bottom|-top)?|right(?:-bottom|-top)?|top|auto|cover|contain|repeat(?:-x|-y|-round|-space)?|no-repeat|clip-.+|origin-.+|blend-.+|gradient-.+|none)$/.test(normalized)) return [];
  if (/^text-(?:left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(normalized)) return [];
  if (/^border-(?:collapse|separate|solid|dashed|dotted|double|hidden|none)$/.test(normalized)) return [];
  if (/^outline-(?:none|solid|dashed|dotted|double)$/.test(normalized)) return [];
  if (/^ring-inset$/.test(normalized) || /^(?:fill|stroke)-none$/.test(normalized)) return [];
  if (/^(?:bg|from|via|to|caret|accent|placeholder)-/.test(normalized)) return ['color'];
  if (/^text-/.test(normalized)) {
    const suffix = normalized.slice('text-'.length);
    if (/^[[(]/.test(suffix)) return ['color', 'font-size'];
    return /^(?:xs|sm|base|lg|xl|[2-9]xl)$/.test(suffix) || suffixUsesScale(suffix)
      ? ['font-size']
      : ['color', 'font-size'];
  }
  if (/^font-/.test(normalized)) {
    const suffix = normalized.slice('font-'.length);
    return /^(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\d+)$/.test(suffix)
      ? ['font-weight']
      : ['font-family', 'font-weight'];
  }
  const border = normalized.match(/^border(?:-[trblxy])?-(.+)$/);
  if (border && /^[[(]/.test(border[1])) return ['color'];
  if (border) return suffixUsesScale(border[1]) ? [] : ['color'];
  const divide = normalized.match(/^divide(?:-[xy])?-(.+)$/);
  if (divide && /^[[(]/.test(divide[1])) return ['color'];
  if (divide) return suffixUsesScale(divide[1]) ? [] : ['color'];
  const outline = normalized.match(/^outline-(?:offset-)?(.+)$/);
  if (outline && /^[[(]/.test(outline[1])) return ['color'];
  if (outline) return suffixUsesScale(outline[1]) ? [] : ['color'];
  const ring = normalized.match(/^ring-(?:offset-)?(.+)$/);
  if (ring && /^[[(]/.test(ring[1])) return ['color', 'shadow'];
  if (ring) return suffixUsesScale(ring[1]) ? ['shadow'] : ['color', 'shadow'];
  const decoration = normalized.match(/^decoration-(.+)$/);
  if (decoration && /^[[(]/.test(decoration[1])) return ['color'];
  if (decoration) return suffixUsesScale(decoration[1]) ? [] : ['color'];
  const stroke = normalized.match(/^stroke-(.+)$/);
  if (stroke && /^[[(]/.test(stroke[1])) return ['color'];
  if (stroke) return suffixUsesScale(stroke[1]) ? [] : ['color'];
  if (/^fill-/.test(normalized)) return ['color'];
  if (/^(?:m[trblxy]?|p[trblxy]?|gap|gap-[xy]|space-[xy]|inset|inset-[xy]|top|right|bottom|left)-/.test(normalized)) return ['spacing'];
  if (/^leading-/.test(normalized)) return ['line-height'];
  if (/^rounded(?:-|$)/.test(normalized)) return ['radius'];
  if (/^(?:shadow|drop-shadow)(?:-|$)/.test(normalized)) return ['shadow', 'color'];
  if (/^z-/.test(normalized)) return ['z-index'];
  if (/^duration-/.test(normalized)) return ['animation-duration'];
  if (iconContext && /^(?:size|w|h)-/.test(normalized)) return ['icon-size'];
  return [];
}

function validateVariants(fact, variants, breakpointAliases) {
  for (const variant of variants) {
    const normalized = variant.replace(/^!/, '');
    if (breakpointAliases.has(normalized)) continue;
    const derivedBreakpoint = normalized.match(/^(?:lt|at|min|max)-(.+)$/)?.[1]
      ?? normalized.match(/^@(.+)$/)?.[1];
    if (derivedBreakpoint && breakpointAliases.has(derivedBreakpoint)) continue;
    if (
      /^(?:sm|md|lg|xl|2xl)$/.test(normalized)
      || /^(?:lt|at|min|max)-/.test(normalized)
      || /^@/.test(normalized)
      || /^\[@(?:media|container)\b/i.test(normalized)
    ) {
      return policyFinding(
        fact,
        'ui-token/unapproved-breakpoint',
        `UnoCSS 使用了未批准的响应式断点：${normalized}`,
        '响应式 variant 必须来自 breakpoint Token',
        '改用 Manifest 中声明的 UnoCSS breakpoint 别名。',
      );
    }
  }
  return null;
}

function expandShortcut(base, shortcutMap, visited = new Set()) {
  const shortcut = shortcutMap.get(base);
  if (!shortcut) return null;
  if (visited.has(base)) return { cycle: true, utilities: [] };
  const nextVisited = new Set([...visited, base]);
  let cycle = false;
  const utilities = shortcut.expandsTo.flatMap((utility) => {
    const parsed = splitVariants(utility);
    const nested = expandShortcut(parsed.base, shortcutMap, nextVisited);
    if (nested?.cycle) cycle = true;
    return nested
      ? nested.utilities.map((expanded) => [...parsed.variants, expanded].join(':'))
      : [utility];
  });
  return { cycle, utilities };
}

function inspectUnoUtility(fact, context) {
  const { base, variants } = splitVariants(fact.token);
  const variantViolation = validateVariants(fact, variants, context.breakpointAliases);
  if (variantViolation) return [variantViolation];
  const shortcut = expandShortcut(base, context.shortcutMap);
  if (shortcut) {
    if (shortcut.cycle) {
      return [policyFinding(
        fact,
        'ui-token/unapproved-shortcut',
        `UnoCSS shortcut ${base} 存在循环展开`,
        '每个受管 shortcut 必须有限展开为批准的 Token utility',
        '修正 Manifest shortcut 展开关系并重新生成 Manifest。',
      )];
    }
    return shortcut.utilities.flatMap((utility) => inspectUnoUtility(
      { ...fact, token: [...variants, utility].join(':') },
      context,
    ));
  }
  const approved = context.aliasMap.get(base);
  const categories = utilityCategories(base, isIconContext(fact, context.iconConfig));
  if (approved) {
    if (categories.length > 0 && !categories.includes(approved.category)) {
      return [policyFinding(
        fact,
        'ui-token/category-mismatch',
        `${fact.token} 映射的是 ${approved.category} Token，不能用于 ${categories.join('、')} 类 utility`,
        'UnoCSS utility 的语义类别必须与 Manifest Token 类别一致',
        '改用与当前 utility 类别一致的 Manifest 别名。',
      )];
    }
    return [];
  }
  if (categories.length === 0) return [];
  const arbitrary = base.includes('[') || base.includes('(');
  return [policyFinding(
    fact,
    arbitrary ? 'ui-token/raw-value' : 'ui-token/unknown-token',
    arbitrary
      ? `UnoCSS utility 使用了任意值：${fact.token}`
      : `UnoCSS utility 未映射到 UI Token：${fact.token}`,
    `${categories.join('、')} 类 utility 必须精确映射到 Manifest Token`,
    '改用 Manifest 中批准的 UnoCSS utility；不得使用默认刻度、任意值或未登记 shortcut 绕过。',
  )];
}

function attributifyUtilities(fact) {
  const name = fact.name.replace(/^:/, '');
  if (!fact.value) {
    return [{
      ...fact,
      type: 'utility',
      token: name,
    }];
  }
  const prefix = name.includes(':') ? name : `${name}`;
  return fact.value.split(/\s+/).filter(Boolean).map((value) => ({
    ...fact,
    type: 'utility',
    token: `${prefix}-${value}`,
  }));
}

function dynamicUsesControlledUtility(value, iconContext) {
  const iconPrefix = iconContext ? '|size|w|h' : '';
  const controlledPrefix = String.raw`-?(?:bg|text|border|outline|ring|fill|stroke|m[trblxy]?|p[trblxy]?|gap|space-[xy]|inset|top|right|bottom|left|font|leading|rounded|shadow|drop-shadow|z|duration${iconPrefix})-`;
  if (new RegExp(`${controlledPrefix}[^\\s'"\\\`]*(?:\\$\\{|['"]?\\s*\\+)`, 'i').test(value)) {
    return true;
  }
  const iconProperty = iconContext ? '|width|height|inline-size|block-size' : '';
  const controlledProperty = String.raw`(?:color|background(?:-color)?|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?|text-decoration(?:-[a-z-]+)?|caret-color|column-rule(?:-[a-z-]+)?|fill|stroke|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|gap|row-gap|column-gap|inset(?:-[a-z-]+)?|top|right|bottom|left|font(?:-[a-z-]+)?|line-height|box-shadow|text-shadow|filter|z-index|transition(?:-duration)?|animation(?:-duration)?${iconProperty})`;
  return new RegExp(`\\[${controlledProperty}:[^\\]]*(?:\\$\\{|['"]?\\s*\\+)`, 'i')
    .test(value);
}

function dynamicBreakpointViolation(fact, breakpointAliases) {
  const variants = [...fact.value.matchAll(
    /(?:^|[\s'"`])((?:sm|md|lg|xl|2xl|(?:lt|at|min|max)-[a-z0-9_[\].-]+|@[a-z0-9_-]+|\[@(?:media|container)[^\]]*\])):/gi,
  )].map((match) => match[1]);
  return validateVariants(fact, variants, breakpointAliases);
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

function inspectUnoConfigurationFact(fact, shortcutMap, breakpointAliases) {
  if (fact.type === 'configuration-file') return [];
  if (fact.type === 'breakpoint-declaration') {
    if (breakpointAliases.has(fact.name)) return [];
    return [policyFinding(
      fact,
      'ui-token/unapproved-breakpoint',
      `UnoCSS 配置声明了 Manifest 未批准的 breakpoint：${fact.name}`,
      'UnoCSS theme.breakpoints 中的每个名称都必须来自 breakpoint Token 别名',
      '在设计系统中登记该 breakpoint 并重新生成 Manifest，或删除未批准的配置项。',
      { value: fact.value },
    )];
  }
  if (fact.type === 'shortcut-declaration') {
    const approved = shortcutMap.get(fact.name);
    const exactExpansion = approved
      && approved.expandsTo.length === fact.expandsTo.length
      && approved.expandsTo.every((utility, index) => utility === fact.expandsTo[index]);
    if (exactExpansion) return [];
    return [policyFinding(
      fact,
      'ui-token/unapproved-shortcut',
      approved
        ? `UnoCSS shortcut ${fact.name} 的实际展开与 Manifest 不一致`
        : `UnoCSS 配置声明了 Manifest 未批准的 shortcut：${fact.name}`,
      'UnoCSS 配置中的每个 shortcut 都必须在 Manifest 中登记完全相同的静态展开',
      '修改 shortcut 或 Manifest 后重新生成来源指纹；不得使用动态 shortcut。',
      { actual: fact.expandsTo, approved: approved?.expandsTo ?? null },
    )];
  }
  const message = fact.type === 'custom-rule'
    ? 'UnoCSS 自定义 rules 无法静态证明只生成受 Token 管理的样式'
    : `UnoCSS 配置无法静态证明：${fact.value}`;
  return [policyFinding(
    fact,
    'ui-token/unprovable-dynamic-usage',
    message,
    '启用 UI Token 门禁时，UnoCSS 只允许可静态证明的配置、官方基础 preset 和 variant-group transformer，不允许自定义样式生成扩展',
    '将动态生成逻辑改为 Manifest 登记的静态 shortcut；移除自定义 rules、preset、variant、preflight、extractor、safelist 或 transformer。',
  )];
}

export function inspectUiTokens({
  config,
  manifest,
  deletedContractPaths = [],
  sassFacts = [],
  unocssFacts = [],
  unocssConfigurationFacts = [],
}) {
  const findings = [];
  for (const deletedPath of new Set(deletedContractPaths)) {
    findings.push(policyFinding(
      { path: deletedPath, line: 1, column: 1 },
      'ui-token/stale-manifest',
      `UI Token 契约文件已在暂存区删除：${deletedPath}`,
      '启用 UI Token 门禁时，Manifest、来源文件和 UnoCSS 配置必须存在于提交后的 Git 快照',
      '恢复该文件并同步 Manifest；如果确实要移除来源或配置，先更新项目生成器、Manifest 和 repo-guard 配置。',
    ));
  }
  for (const source of manifest.sources) {
    if (source.sha256 !== source.actualSha256) {
      findings.push(policyFinding(
        { path: source.path, line: 1, column: 1 },
        'ui-token/stale-manifest',
        `UI Token 来源文件与 Manifest 指纹不一致：${source.path}`,
        'Manifest 中的每个来源指纹必须对应当前 Git 快照',
        '运行项目的 Token Manifest 生成脚本，检查结果后重新暂存来源文件和 Manifest。',
      ));
    }
  }
  const sourcePaths = new Set(manifest.sources.map(({ path }) => path));
  if (config.adapters.unocss.enabled) {
    for (const configFile of config.adapters.unocss.configFiles) {
      if (!sourcePaths.has(configFile)) {
        findings.push(policyFinding(
          { path: configFile, line: 1, column: 1 },
          'ui-token/untracked-unocss-config',
          `UnoCSS 配置文件没有纳入 Manifest 来源指纹：${configFile}`,
          '所有启用的 UnoCSS 配置文件都必须是 Manifest 来源',
          '将配置文件加入 Manifest sources 并重新生成 Manifest。',
        ));
      }
    }
  }
  const sassAliases = aliasesByAdapter(manifest, 'sass');
  findings.push(...sassFacts.flatMap((fact) => inspectSassFact(
    fact,
    sassAliases,
    config.icon,
  )));
  const unocssAliases = aliasesByAdapter(manifest, 'unocss');
  const unoContext = {
    aliasMap: unocssAliases,
    breakpointAliases: new Set(manifest.tokens
      .filter(({ category }) => category === 'breakpoint')
      .flatMap(({ aliases }) => aliases.unocss)),
    iconConfig: config.icon,
    shortcutMap: new Map(manifest.shortcuts.map((shortcut) => [shortcut.name, shortcut])),
  };
  if (config.adapters.unocss.enabled) {
    findings.push(...manifest.shortcuts.flatMap((shortcut) => inspectUnoUtility({
      type: 'utility',
      token: shortcut.name,
      tagName: null,
      path: manifest.file?.relative ?? config.manifestFile,
      line: 1,
      column: 1,
    }, unoContext)));
  }
  findings.push(...unocssConfigurationFacts.flatMap((fact) => (
    inspectUnoConfigurationFact(fact, unoContext.shortcutMap, unoContext.breakpointAliases)
  )));
  const inspectedConfigFiles = new Set(unocssConfigurationFacts
    .filter(({ type }) => type === 'configuration-file')
    .map(({ path: configPath }) => configPath));
  const declaredShortcuts = new Set(unocssConfigurationFacts
    .filter(({ type }) => type === 'shortcut-declaration')
    .map(({ name }) => name));
  const configurationIsStatic = !unocssConfigurationFacts.some(({ type }) => (
    type === 'configuration-dynamic'
  ));
  if (
    config.adapters.unocss.enabled
    && configurationIsStatic
    && config.adapters.unocss.configFiles.every((file) => inspectedConfigFiles.has(file))
  ) {
    for (const shortcut of manifest.shortcuts) {
      if (declaredShortcuts.has(shortcut.name)) continue;
      findings.push(policyFinding(
        {
          path: manifest.file?.relative ?? config.manifestFile,
          line: 1,
          column: 1,
        },
        'ui-token/unapproved-shortcut',
        `Manifest shortcut 没有对应的 UnoCSS 静态配置：${shortcut.name}`,
        'Manifest shortcuts 必须与所有已启用 UnoCSS 配置中的静态 shortcut 双向一致',
        '从 Manifest 删除不存在的 shortcut，或在 UnoCSS 配置中加入完全一致的静态声明后重新生成 Manifest。',
      ));
    }
  }
  for (const fact of unocssFacts) {
    if (fact.type === 'dynamic') {
      const breakpointViolation = dynamicBreakpointViolation(
        fact,
        unoContext.breakpointAliases,
      );
      if (breakpointViolation) {
        findings.push(breakpointViolation);
        continue;
      }
      if (fact.opaque || dynamicUsesControlledUtility(
        fact.value,
        isIconContext(fact, config.icon),
      )) {
        findings.push(policyFinding(
          fact,
          'ui-token/unprovable-dynamic-usage',
          'UnoCSS 动态 utility 无法静态证明只使用批准 Token',
          '受控 utility 必须是静态字符串、有限条件分支或受管 shortcut',
          '改为静态可枚举映射，并确保每个分支都出现在 Manifest 中。',
        ));
      }
      continue;
    }
    const utilities = fact.type === 'attributify' ? attributifyUtilities(fact) : [fact];
    findings.push(...utilities.flatMap((utility) => inspectUnoUtility(utility, unoContext)));
  }
  const result = applyExceptions(findings, config.exceptions);
  return {
    ...result,
    checkedSassFacts: sassFacts.length,
    checkedUnoCssFacts: unocssFacts.length,
    checkedUnoCssConfigurationFacts: unocssConfigurationFacts.length,
  };
}
