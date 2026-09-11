import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDependencyTree,
  parseEffectivePom,
  parseEnforcerRuleEvents,
  parseJacocoReport,
  parseJUnitReport,
} from "../../../../src/integrations/java/engineering/reports.js";

test("JUnit 必须具备完整且一致的实际用例证据", () => {
  const result = parseJUnitReport(
    '<testsuite tests="3" failures="1" errors="0" skipped="1"><testcase name="a" classname="A"/><testcase name="b" classname="A"><skipped/></testcase><testcase name="c" classname="A"><failure>细节</failure></testcase></testsuite>',
  );
  assert.equal(result.executed, 2);
  assert.equal(result.failed, 1);
  assert.throws(
    () =>
      parseJUnitReport(
        '<testsuite tests="3"><testcase name="a" classname="A"/></testsuite>',
      ),
    /不一致/,
  );
  assert.throws(() => parseJUnitReport('<testsuite tests="0">'), /XML/);
  assert.throws(
    () =>
      parseJUnitReport(
        '<!DOCTYPE testsuite [<!ENTITY a "x">]><testsuite tests="0"/>',
      ),
    /文档类型/,
  );
  assert.throws(
    () =>
      parseJUnitReport(
        '<testsuites tests="2" failures="1"><testsuite tests="1" failures="0"><testcase name="ok" classname="Good"/></testsuite><testcase name="bad" classname="Bad"><failure/></testcase></testsuites>',
      ),
    /聚合套件/,
  );
  assert.throws(
    () =>
      parseJUnitReport(
        '<testsuites tests="1" failures="1"><testsuite tests="1" failures="0"><testcase name="ok" classname="Good"/></testsuite></testsuites>',
      ),
    /计数/,
  );
  assert.throws(
    () =>
      parseJUnitReport(
        '<testsuite tests="1"><testcase name="x" classname="X"><failure/><skipped/></testcase></testsuite>',
      ),
    /矛盾/,
  );
});
test("JaCoCo 原生报告允许标准 DTD，但必须有计数和执行会话", () => {
  const counters =
    '<counter type="LINE" missed="2" covered="8"/><counter type="BRANCH" missed="0" covered="0"/><counter type="INSTRUCTION" missed="2" covered="18"/>';
  const report = parseJacocoReport(
    `<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="a"><sessioninfo id="a" start="100" dump="200"/><package name="app"><class name="app/App"/></package>${counters}</report>`,
  );
  assert.equal(report.counters.line.covered, 8);
  assert.throws(
    () => parseJacocoReport(`<report>${counters}</report>`),
    /会话/,
  );
  assert.throws(() => parseJacocoReport("<report/>"), /计数/);
  const withoutBranch = `<report><sessioninfo id="a" start="100" dump="200"/><package name="app"><class name="app/App"/></package><counter type="LINE" missed="0" covered="2"/><counter type="INSTRUCTION" missed="0" covered="6"/></report>`;
  assert.deepEqual(parseJacocoReport(withoutBranch).counters.branch, {
    missed: 0,
    covered: 0,
  });
  assert.throws(
    () =>
      parseJacocoReport(
        withoutBranch.replace(
          '<class name="app/App"/>',
          '<class name="app/App"><counter type="BRANCH" missed="1" covered="1"/></class>',
        ),
      ),
    /遗漏/,
  );
});
test("依赖检查解析有效 POM 的活动插件配置和真实解析树", () => {
  const pom = parseEffectivePom(
    "<project><groupId>org.a</groupId><artifactId>app</artifactId><version>1</version><build><plugins><plugin><artifactId>maven-enforcer-plugin</artifactId><version>3.5.0</version><executions><execution><id>deps</id><goals><goal>enforce</goal></goals><configuration><rules><dependencyConvergence/></rules></configuration></execution></executions></plugin></plugins></build></project>",
    "deps",
  );
  assert.equal(pom.enforcerConfigured, true);
  assert.deepEqual(pom.rules, ["dependencyConvergence"]);
  assert.deepEqual(pom.ruleLevels, { dependencyConvergence: "ERROR" });
  const tree = parseDependencyTree(
    JSON.stringify({
      groupId: "org.a",
      artifactId: "app",
      version: "1",
      children: [{ groupId: "org.b", artifactId: "lib", version: "2" }],
    }),
  );
  assert.equal(tree.dependencies[0].artifactId, "lib");
  assert.throws(() => parseDependencyTree('{"artifactId":"app"}'), /坐标/);
});
test("Enforcer 原生执行事件保留规则通过、失败和警告", () => {
  assert.deepEqual(
    parseEnforcerRuleEvents(
      "[INFO] Rule 0: org.apache.maven.enforcer.rules.dependency.DependencyConvergence passed\n[WARNING] Rule 1: org.apache.maven.enforcer.rules.BannedPlugins warned with message:\n[ERROR] Rule 2: org.apache.maven.enforcer.rules.RequirePluginVersions failed with message:\n[INFO] Rule 3: custom.BannedPlugins passed",
    ).map(({ rule, outcome }) => ({ rule, outcome })),
    [
      { rule: "dependencyConvergence", outcome: "passed" },
      { rule: "bannedPlugins", outcome: "warned" },
      { rule: "requirePluginVersions", outcome: "failed" },
      { rule: null, outcome: "passed" },
    ],
  );
});
test("Enforcer 禁用布尔量兼容大小写，并保留不可解析值", () => {
  const xml = (control) =>
    `<project><build><plugins><plugin><artifactId>maven-enforcer-plugin</artifactId><configuration>${control}</configuration><executions><execution><id>deps</id><goals><goal>enforce</goal></goals><configuration><rules><dependencyConvergence/></rules></configuration></execution></executions></plugin></plugins></build></project>`;
  assert.equal(parseEffectivePom(xml("<skip>TRUE</skip>"), "deps").skip, true);
  assert.equal(
    parseEffectivePom(xml("<fail>FALSE</fail>"), "deps").fail,
    false,
  );
  assert.equal(
    parseEffectivePom(xml("<skip>${skipCheck}</skip>"), "deps").skip,
    null,
  );
  assert.equal(
    parseEffectivePom(
      xml('<rules combine.self="override"><requireReleaseDeps/></rules>'),
      "deps",
    ).unsupportedMerging,
    true,
  );
  for (const name of ["rulesToSkip", "rulesToExecute"])
    assert.equal(
      parseEffectivePom(
        xml(`<${name}><rule>bannedPlugins</rule></${name}>`),
        "deps",
      ).selectiveRules,
      true,
    );
  assert.equal(
    parseEffectivePom(
      xml("<rules><bannedPlugins><level>WARN</level></bannedPlugins></rules>"),
      "deps",
    ).ruleLevels.bannedPlugins,
    "WARN",
  );
});
