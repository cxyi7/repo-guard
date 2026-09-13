import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenValueKey,
  tokenSelectorKeys,
  inspectTokenValueDefinitions,
} from "../../src/policies/ui-token-values.js";

test("值只消除明确语法差异，不把单位、字符串内容、变量大小写混同", () => {
  assert.equal(tokenValueKey("#FFF"), tokenValueKey("#ffffff"));
  assert.equal(tokenValueKey("rgb(1, 2, 3)"), tokenValueKey("rgb(1,2,3)"));
  assert.equal(tokenValueKey('"Arial"'), tokenValueKey("'Arial'"));
  for (const [a, b] of [
    ["1rem", "16px"],
    ["var(--A)", "var(--a)"],
    ['"a b"', '"a  b"'],
    ["0", "0px"],
    ["calc(1px + 1px)", "2px"],
  ])
    assert.notEqual(tokenValueKey(a), tokenValueKey(b));
  assert.throws(() => tokenValueKey("var(--a"));
  assert.deepEqual(
    tokenSelectorKeys('[data-theme="dark"]'),
    tokenSelectorKeys("[data-theme=dark]"),
  );
  assert.notDeepEqual(tokenSelectorKeys(".a .b"), tokenSelectorKeys(".a.b"));
  assert.notEqual(tokenValueKey('url(#fff)'), tokenValueKey('url(#ffffff)'));
  assert.notDeepEqual(tokenSelectorKeys('[type=TEXT]'), tokenSelectorKeys('[type=TEXT s]'));
});

test("合并选择器检查每个分支，重复产物定义不能靠最后一个正确值掩盖", () => {
  const definitions = [
    {
      value: "#ffffff",
      source: "styles/tokens.css",
      outputs: [{ selector: ":root", property: "--c" }],
    },
  ];
  const facts = [
    {
      type: "variable-definition",
      definitionKind: "value",
      name: "--c",
      selector: ":root",
      value: "#123456",
      path: "out/a.css",
    },
    {
      type: "variable-definition",
      definitionKind: "value",
      name: "--c",
      selector: ":root,.override",
      value: "#fff",
      path: "out/b.css",
    },
    {
      type: "variable-definition",
      definitionKind: "value",
      name: "--\\63",
      selector: ".escaped",
      value: "#fff",
      path: "out/b.css",
    },
  ];
  const findings = inspectTokenValueDefinitions(definitions, facts, {
    artifact: true,
  });
  assert.ok(findings.some((item) => item.rule === "ui-token/value-mismatch"));
  assert.ok(
    findings.some((item) => item.rule === "ui-token/unexpected-definition"),
  );
  assert.equal(
    findings.filter((item) => item.rule === "ui-token/unexpected-definition")
      .length,
    2,
  );
});

test('函数参数中的哈希标识不能被猜成颜色', () => {
  for (const name of ['u\\72l', 'element', 'paint']) {
    assert.notEqual(tokenValueKey(`${name}(#fff)`), tokenValueKey(`${name}(#ffffff)`), name);
  }
});

test('选择器注释不改变约定的位置，但后代关系仍然不同', () => {
  assert.deepEqual(tokenSelectorKeys('.card/*说明*/.active'), tokenSelectorKeys('.card.active'));
  assert.notDeepEqual(tokenSelectorKeys('.card .active'), tokenSelectorKeys('.card.active'));
});

test('产物属性大小写不能隐藏错值，媒体规则不能冒充声明', () => {
  const definitions = [{ value: '16px', source: 'styles/tokens.css', outputs: [{ selector: '.card', property: 'padding' }] }];
  const facts = [
    { type: 'declaration', path: 'output/a.css', selector: '.card', property: 'PADDING', value: '99px' },
    { type: 'declaration', path: 'output/a.css', selector: '.card', property: 'padding', value: '16px' },
  ];
  assert.equal(inspectTokenValueDefinitions(definitions, facts, { artifact: true })[0]?.rule, 'ui-token/value-mismatch');
  const container = [{ ...definitions[0], value: 'layout', outputs: [{ selector: '.card', property: 'container' }] }];
  assert.deepEqual(inspectTokenValueDefinitions(container, [
    { ...facts[0], property: 'container', value: 'layout' },
    { type: 'responsive-rule', name: 'container', selector: '.card', value: '(width > 1px)', path: 'output/a.css' },
  ], { artifact: true }), []);
});

test('编译后值单独明确配置，不把 Sass 表达式假定为输出字面量', () => {
  const definitions = [{ source: 'styles/tokens.scss', value: '8px * 2', outputs: [{ selector: '.card', property: 'padding', value: '16px' }] }];
  const facts = [{ type: 'declaration', path: 'output/main.css', property: 'padding', selector: '.card', value: '16px' }];
  assert.deepEqual(inspectTokenValueDefinitions(definitions, facts, { artifact: true }), []);
  assert.equal(inspectTokenValueDefinitions(definitions, [{ ...facts[0], value: '8px' }], { artifact: true })[0].rule, 'ui-token/value-mismatch');
});
