import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { JAVA_ENGINEERING_SCHEMA_PROPERTIES } from "../../src/config/java-engineering-schema.js";
import { validateJavaEngineeringChecks } from "../../src/config/java-engineering.js";

test("默认配置全部关闭，工程门禁启用时必须明确必需模块", () => {
  assert.ok(
    Object.values(validateJavaEngineeringChecks({})).every(
      (value) => value.enabled === false,
    ),
  );
  assert.throws(
    () => validateJavaEngineeringChecks({ javaTest: { enabled: true } }),
    /必需模块/,
  );
  assert.throws(
    () =>
      validateJavaEngineeringChecks({
        javaBuild: {
          enabled: true,
          modules: [{ name: "a", outputs: ["target"] }],
        },
      }),
    /产物文件/,
  );
});
test("配置禁止报告越界、通配符和跳过验证的参数", () => {
  for (const report of ["../test.xml", "/test.xml", "target/*.xml"]) {
    assert.throws(() =>
      validateJavaEngineeringChecks({
        javaTest: { modules: [{ name: "a", reports: [report] }] },
      }),
    );
  }
  for (const argument of [
    "-DskipTests=true",
    "-Dtest=One",
    "-pl",
    "clean",
    "-Dmaven.test.failure.ignore=true",
    "-DoutputFile=a",
  ])
    assert.throws(() =>
      validateJavaEngineeringChecks({ javaTest: { arguments: [argument] } }),
    );
  assert.throws(
    () =>
      validateJavaEngineeringChecks({
        javaTest: {
          modules: [
            { name: "a", directory: "a", reports: ["b/target/TEST.xml"] },
          ],
        },
      }),
    /所属模块/,
  );
  assert.throws(
    () =>
      validateJavaEngineeringChecks({
        javaTest: {
          modules: [
            { name: "a", reports: ["target/TEST.xml"] },
            { name: "b", reports: ["target/TEST.xml"] },
          ],
        },
      }),
    /不同的项目目录/,
  );
  assert.throws(
    () =>
      validateJavaEngineeringChecks({ javaTest: { executable: "./mvnw.cmd" } }),
    /Wrapper/,
  );
  assert.throws(
    () =>
      validateJavaEngineeringChecks({
        javaDependencies: {
          modules: [
            {
              name: "app",
              effectivePom: "pom.xml",
              dependencyTree: "reports/tree.json",
            },
          ],
        },
      }),
    /依赖输出/,
  );
});
test("配置 schema 接受规范化的七项默认值", () => {
  const validate = new Ajv({ strict: true }).compile({
    type: "object",
    properties: JAVA_ENGINEERING_SCHEMA_PROPERTIES,
    additionalProperties: false,
  });
  const defaults = validateJavaEngineeringChecks({});
  assert.equal(validate(defaults), true, JSON.stringify(validate.errors));
});
