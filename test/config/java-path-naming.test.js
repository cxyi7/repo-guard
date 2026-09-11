import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import fs from "node:fs";
import {
  JAVA_PATH_NAMING_DEFAULTS,
  JAVA_PATH_NAMING_SCHEMA_PROPERTIES,
  validateJavaPathNamingChecks,
} from "../../src/config/java-path-naming.js";

const schema = new Ajv({ strict: true }).compile({
  type: "object",
  properties: JAVA_PATH_NAMING_SCHEMA_PROPERTIES,
  additionalProperties: false,
});
const configuration = (value) => ({ javaPathNaming: value });
const baseRule = {
  id: "controller",
  target: "files",
  include: ["**/controller/**/*.java"],
  basename: ["*Controller.java"],
};

test("Java 路径命名默认关闭且默认配置与 Schema 一致", () => {
  const normalized = validateJavaPathNamingChecks({});
  assert.deepEqual(normalized, JAVA_PATH_NAMING_DEFAULTS);
  assert.equal(schema(normalized), true, JSON.stringify(schema.errors));
  assert.notEqual(
    normalized.javaPathNaming.rules,
    JAVA_PATH_NAMING_DEFAULTS.javaPathNaming.rules,
  );
  normalized.javaPathNaming.rules[0].conventions.push("camelCase");
  assert.deepEqual(
    validateJavaPathNamingChecks({}).javaPathNaming.rules[0].conventions,
    ["PascalCase"],
  );
});

test("规则按字段补默认值并保持调用方配置不变", () => {
  const value = configuration({ enabled: true, rules: [baseRule] });
  const before = structuredClone(value);
  const normalized = validateJavaPathNamingChecks(value);
  assert.deepEqual(value, before);
  assert.deepEqual(normalized.javaPathNaming.rules[0].conventions, []);
  assert.deepEqual(normalized.javaPathNaming.rules[0].exclude, [
    "**/package-info.java",
    "**/module-info.java",
  ]);
  assert.equal(schema(value), true, JSON.stringify(schema.errors));
  assert.equal(schema(normalized), true, JSON.stringify(schema.errors));
});

test("关闭检查时仍拒绝未知字段、空约束、重复规则及非法类型", () => {
  for (const value of [
    null,
    [],
    false,
    { unknown: true },
    { enabled: "true" },
    { enabled: null },
    { rules: [] },
    { rules: null },
    { include: [] },
    { include: null },
    { exclude: null },
    { rules: [{ ...baseRule, customRegex: ".*" }] },
    { rules: [{ ...baseRule, id: "大写" }] },
    { rules: [{ ...baseRule, target: "all" }] },
    { rules: [{ ...baseRule, include: [] }] },
    { rules: [{ ...baseRule, basename: [] }] },
    { rules: [{ ...baseRule, conventions: ["Unknown"] }] },
    { rules: [{ ...baseRule, conventions: ["PascalCase", "PascalCase"] }] },
    { rules: [{ ...baseRule, conventions: null }] },
    { rules: [{ ...baseRule, basename: null }] },
    {
      rules: Array.from({ length: 65 }, (_, index) => ({
        ...baseRule,
        id: `rule-${index}`,
      })),
    },
  ]) {
    assert.throws(
      () => validateJavaPathNamingChecks(configuration(value)),
      (error) => error.kind === "configuration",
    );
    assert.equal(schema(configuration(value)), false, JSON.stringify(value));
  }
  assert.throws(
    () =>
      validateJavaPathNamingChecks(
        configuration({ rules: [baseRule, baseRule] }),
      ),
    /id 不得重复/,
  );
  assert.throws(
    () =>
      validateJavaPathNamingChecks(configuration({ enabled: "x" }), {
        configPath: "apps/server/project.json",
      }),
    /apps\/server\/project.json/,
  );
});

test("路径通配符限制与 Schema 一致，不接受越界路径和正则式语法", () => {
  for (const pattern of [
    "../a",
    "/a",
    "C:/a",
    "src\\a",
    "./a",
    "a/../b",
    "a//b",
    "a/",
    "!a",
    "[a-z]*",
    "{a,b}",
    "(a+)+",
    "a|b",
    "^a$",
    "**foo",
    "foo**",
    "***",
    " a",
    "a ",
    "a\n",
    "a".repeat(257),
  ]) {
    const value = configuration({ include: [pattern] });
    assert.throws(
      () => validateJavaPathNamingChecks(value),
      (error) => error.kind === "configuration",
      pattern,
    );
    assert.equal(schema(value), false, pattern);
  }
  for (const pattern of ["**", "a/b", ".", ".."]) {
    const value = configuration({
      rules: [{ ...baseRule, basename: [pattern] }],
    });
    assert.throws(() => validateJavaPathNamingChecks(value));
    assert.equal(schema(value), false, pattern);
  }
  const tooMany = configuration({
    exclude: Array.from({ length: 65 }, (_, index) => `dir-${index}/**`),
  });
  assert.throws(() => validateJavaPathNamingChecks(tooMany), /64/);
  assert.equal(schema(tooMany), false);
  assert.throws(
    () => validateJavaPathNamingChecks(configuration({ include: ["a", "a"] })),
    /重复/,
  );
});

test("功能文档完整配置示例通过路径命名 Schema 与规范化校验", () => {
  const documentation = fs.readFileSync(
    new URL("../../docs/features/java-path-naming.md", import.meta.url),
    "utf8",
  );
  const examples = [...documentation.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (match) => JSON.parse(match[1]),
  );
  assert.equal(examples.length, 1);
  const example = examples[0];
  assert.equal(example.version, 2);
  assert.equal(example.project.preset, "java-maven");
  assert.equal(schema(example.checks), true, JSON.stringify(schema.errors));
  const normalized = validateJavaPathNamingChecks(
    example.checks,
  ).javaPathNaming;
  assert.equal(normalized.rules.length, 4);
  assert.deepEqual(normalized.rules[2].basename, ["*Controller.java"]);
  assert.deepEqual(normalized.rules[3].basename, ["*Service.java"]);
});
