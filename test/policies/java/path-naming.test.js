import test from "node:test";
import assert from "node:assert/strict";
import { validateJavaPathNamingChecks } from "../../../src/config/java-path-naming.js";
import { evaluateJavaPathNaming } from "../../../src/policies/java/path-naming.js";

const config = (value = {}) =>
  validateJavaPathNamingChecks({ javaPathNaming: value }).javaPathNaming;
const check = (paths, value) => evaluateJavaPathNaming(paths, config(value));

test("默认检查多模块 Java 文件及包目录，不约束模块名前缀和其他源码", () => {
  assert.deepEqual(
    check([
      "Backend-API/src/main/java/com/example/XMLReader2.java",
      "src/test/java/com/example/AppTest.java",
      "src/main/java/com/example/package-info.java",
      "src/main/java/module-info.java",
      "web/src/components/bad_name.vue",
      "docs/Bad-Name.md",
    ]),
    [],
  );
  const findings = check(["src/main/java/com/Example/bad_name.java"]);
  assert.deepEqual(
    findings.map((finding) => finding.location.path),
    ["src/main/java/com/Example/bad_name.java", "src/main/java/com/Example"],
  );
});

test("描述符文件的例外不会跳过其包目录，重复目录只报告一次", () => {
  const findings = check([
    "src/main/java/BadPackage/package-info.java",
    "src/main/java/BadPackage/module-info.java",
    "src/main/java/BadPackage/App.java",
    "src/main/java/BadPackage/App.java",
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].location.path, "src/main/java/BadPackage");
});

test("文件和目录规则分开选择，同一文件的 PascalCase 与后缀必须同时满足", () => {
  const rules = [
    ...config().rules,
    {
      id: "controller-suffix",
      target: "files",
      include: ["**/controller/**/*.java"],
      basename: ["*Controller.java"],
    },
    {
      id: "service-suffix",
      target: "files",
      include: ["**/service/**/*.java"],
      basename: ["*Service.java"],
    },
  ];
  const findings = check(
    [
      "src/main/java/app/controller/user.java",
      "src/main/java/app/controller/UserController.java",
      "src/main/java/app/controller/package-info.java",
      "src/main/java/app/service/UserService.java",
      "src/main/java/app/service/UserRepository.java",
      "src/main/java/app/User.java",
    ],
    { rules },
  );
  assert.equal(
    findings.filter((finding) => finding.location.path.endsWith("/user.java"))
      .length,
    2,
  );
  assert.equal(
    findings.filter((finding) =>
      finding.location.path.endsWith("/UserRepository.java"),
    ).length,
    1,
  );
  assert.equal(findings.length, 3);
});

test("全局与规则排除分别生效，排除一个规则不取消其他规则", () => {
  const rules = [
    ...config().rules,
    {
      id: "suffix",
      target: "files",
      include: ["**/*.java"],
      exclude: ["**/Special.java"],
      basename: ["*Controller.java"],
    },
  ];
  const findings = check(
    [
      "src/main/java/Generated/bad_name.java",
      "src/main/java/app/Special.java",
      "src/main/java/app/bad_name.java",
    ],
    { exclude: ["**/Generated/**"], rules },
  );
  assert.equal(findings.length, 2);
  assert.ok(
    findings.every(
      (finding) =>
        finding.location.path.endsWith("/bad_name.java") &&
        !finding.location.path.includes("/Generated/"),
    ),
  );
});

test("名称候选为或关系，规则和命名约定为且关系，路径大小写保持精确", () => {
  const value = {
    include: ["**"],
    rules: [
      {
        id: "files",
        target: "files",
        include: ["**/*.java"],
        conventions: ["PascalCase"],
        basename: ["*Service.java", "*Controller.java"],
      },
      {
        id: "dirs",
        target: "directories",
        include: ["**"],
        conventions: ["snake_case"],
        basename: ["app*"],
      },
    ],
  };
  assert.deepEqual(
    check(
      ["app_code/UserService.java", "app_code/OrderController.java"],
      value,
    ),
    [],
  );
  assert.equal(check(["App_code/UserService.java"], value).length, 2);
  assert.equal(check(["app_code/userService.java"], value).length, 1);
  assert.equal(check(["src/main/java/app/app.java"]).length, 1);
  assert.deepEqual(check(["SRC/main/java/app/app.java"]), []);
});

test("简单通配符支持零层或多层目录及单字符，不将复杂名称作为正则执行", () => {
  const value = {
    include: ["**"],
    rules: [
      {
        id: "selected",
        target: "files",
        include: ["src/**/App?.java"],
        basename: ["App?.java"],
      },
    ],
  };
  assert.deepEqual(
    check(["src/App1.java", "src/a/b/App2.java", "src/Other.java"], value),
    [],
  );
  const alternating = `${"*a".repeat(80)}b.java`;
  const stress = {
    include: ["**"],
    rules: [
      {
        id: "bounded",
        target: "files",
        include: ["**/*.java"],
        basename: [alternating],
      },
    ],
  };
  assert.equal(check([`${"a".repeat(500)}c.java`], stress).length, 1);
});

test("规则可以检查源码根之外的明确目录，非法路径事实不能作为通过证据", () => {
  assert.equal(
    check(["other/BadDir/App.java"], { include: ["other/**"] }).length,
    1,
  );
  for (const paths of [
    ["../outside/App.java"],
    ["/root/App.java"],
    ["C:/root/App.java"],
    ["src\\App.java"],
    [null],
    "abc",
  ]) {
    assert.throws(
      () => evaluateJavaPathNaming(paths, config()),
      (error) => error.kind === "execution",
    );
  }
});
