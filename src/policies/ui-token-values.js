import valueParser from "postcss-value-parser";
import selectorParser from "postcss-selector-parser";
import { configurationError } from '../core/error/repo-guard-error.js';

/** 只规范化可由语法确认的差异，不求值、换算单位或模拟层叠。 */
export function tokenValueKey(value) {
  const serialize = (nodes, normalizeColors = true) =>
    nodes
      .filter((node) => node.type !== "comment")
      .map((node) => {
        if (node.unclosed) throw configurationError('ui-token/unclosed-value', 'Token 值包含未闭合语法');
        if (node.type === "space") return ["space"];
        if (node.type === "function")
          // 任意函数参数可能是标识或自定义数据，不根据哈希写法推断颜色。
          return ["function", node.value, serialize(node.nodes, false)];
        if (node.type === "string") return ["string", node.value];
        let text = node.value;
        if (normalizeColors && node.type === "word" && /^#[\da-f]{3,8}$/i.test(text)) {
          text = text.toLowerCase();
          if ([4, 5].includes(text.length))
            text =
              "#" +
              [...text.slice(1)]
                .map((character) => character.repeat(2))
                .join("");
        }
        return [node.type, text];
      })
      .filter(
        (node, index, all) =>
          node[0] !== "space" ||
          (index > 0 &&
            index < all.length - 1 &&
            all[index - 1][0] !== "div" &&
            all[index + 1][0] !== "div"),
      );
  return JSON.stringify(serialize(valueParser(value.trim()).nodes));
}

/** 选择器按 AST 比较；不推断它会命中哪些业务元素。 */
export function tokenSelectorKeys(selector) {
  if (!selector) return [""];
  const serialize = (node) => [
    node.type,
    node.type === "combinator" ? node.value.trim() || " " : node.value,
    node.namespace,
    node.attribute,
    node.operator,
    node.insensitive ?? null,
    node.nodes?.filter(child => child.type !== 'comment').map(serialize),
  ];
  return selectorParser()
    .astSync(selector)
    .nodes.map((node) => JSON.stringify(serialize(node)));
}

function contextKey(selector, conditions) {
  return JSON.stringify([
    selector,
    (conditions ?? []).map(({ name, params }) => [name, tokenValueKey(params)]),
  ]);
}

export function tokenContexts(entry) {
  return tokenSelectorKeys(entry.selector).map((selector) =>
    contextKey(selector, entry.conditions),
  );
}

function finding(entry, rule, message) {
  return {
    rule,
    issue: rule,
    path: entry.path ?? entry.source,
    line: entry.line ?? 1,
    column: entry.column ?? 1,
    message,
    expected: "变量、定义位置、条件和指定值与 repo-guard.config.json 完全匹配",
    remediation:
      "修正样式定义或经过团队确认后调整指定值配置；不要扩大例外来隐藏不一致。",
  };
}

function decodedName(name = "") {
  return name.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\r\n\f])/gi,
    (_, hex, character) => {
      if (character !== undefined) return character;
      const point = Number.parseInt(hex, 16);
      return point === 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
        ? "\uFFFD"
        : String.fromCodePoint(point);
    },
  );
}

export const UI_TOKEN_VALUE_RULES = Object.freeze([
  "ui-token/missing-definition",
  "ui-token/value-mismatch",
  "ui-token/unexpected-definition",
]);

export function artifactPropertyName(name) {
  const decoded = decodedName(name);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
}

/** 源码与产物共享显式匹配逻辑；每项约定必须存在，重复定义也必须全部符合。 */
export function inspectTokenValueDefinitions(
  definitions,
  facts,
  { artifact = false } = {},
) {
  const expected = definitions.flatMap((entry) =>
    (artifact ? entry.outputs : [entry]).flatMap((output) =>
      tokenContexts(output).map((context) => ({
        ...entry,
        ...output,
        context,
        key: tokenValueKey(output.value ?? entry.value),
        name: artifact
          ? artifactPropertyName(output.property)
          : (entry.alias.match(/^var\((--[\w-]+)\)$/)?.[1] ?? entry.alias),
      })),
    ),
  );
  const seen = new Set();
  const findings = [];
  for (const fact of facts) {
    if (!artifact && fact.type !== "variable-definition") continue;
    if (artifact && !['variable-definition', 'declaration'].includes(fact.type)) continue;
    const name = artifact ? artifactPropertyName(fact.name ?? fact.property) : decodedName(fact.name ?? fact.property);
    const candidates = expected.filter((entry) => entry.name === name);
    if (!candidates.length) continue;
    for (const context of tokenContexts(fact)) {
      const matches = candidates.filter(
        (entry) =>
          entry.context === context &&
          (artifact ||
            (entry.source === fact.path && entry.language === fact.language)),
      );
      if (!matches.length) {
        // 普通 CSS 属性仅约束显式输出选择器；全局变量覆盖则不能漏过其他位置。
        if (!artifact || name.startsWith("--"))
          findings.push(
            finding(
              fact,
              "ui-token/unexpected-definition",
              `在未登记的位置或条件定义了 ${name}`,
            ),
          );
        continue;
      }
      for (const entry of matches) {
        seen.add(entry);
        if (
          fact.important ||
          (fact.definitionKind !== "value" &&
            fact.type === "variable-definition") ||
          tokenValueKey(fact.value) !== entry.key
        ) {
          findings.push(
            finding(
              fact,
              "ui-token/value-mismatch",
              `${name} 的值与指定值不一致：实际 ${fact.value}${fact.important ? " !important" : ""}；期望 ${entry.value}`,
            ),
          );
        }
      }
    }
  }
  for (const entry of expected) {
    if (!seen.has(entry))
      findings.push(
        finding(
          entry,
          "ui-token/missing-definition",
          `未找到指定定义：${entry.name}，选择器 ${entry.selector || "文件根级"}，条件 ${JSON.stringify(entry.conditions ?? [])}${artifact ? "（生成的 CSS）" : ""}`,
        ),
      );
  }
  return findings;
}
