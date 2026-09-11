import { SaxesParser } from "saxes";
import {
  executionError,
  toRepoGuardError,
} from "../../../core/error/repo-guard-error.js";

function invalid(message) {
  throw executionError(
    "java/invalid-native-report",
    `Java 原生报告无效：${message}`,
  );
}
export function parseJavaXml(content, expected) {
  const stack = [];
  let root;
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", (value) => {
    if (
      expected !== "report" ||
      !/^report\s+PUBLIC\s+"-\/\/JACOCO\/\/DTD Report 1\.1\/\/EN"\s+"report\.dtd"\s*$/.test(
        value.trim(),
      )
    )
      invalid("不接受自定义文档类型或实体");
  });
  parser.on("opentag", (tag) => {
    if (++nodes > 300000 || stack.length > 128) invalid("结构超过读取上限");
    const node = {
      name: tag.name.split(":").at(-1),
      attributes: tag.attributes,
      children: [],
      text: "",
    };
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (value) => {
    if (stack.length) stack.at(-1).text += value;
  });
  parser.on("closetag", () => stack.pop());
  parser.on("error", () => invalid("XML 结构不完整或格式错误"));
  try {
    parser
      .write(
        Buffer.isBuffer(content)
          ? new TextDecoder("utf-8", { fatal: true }).decode(content)
          : content,
      )
      .close();
  } catch (error) {
    if (error.kind) throw toRepoGuardError(error);
    invalid("XML 编码或格式错误");
  }
  if (!root || (expected && root.name !== expected))
    invalid(`缺少 ${expected} 根元素`);
  return root;
}
function descendants(node, name) {
  return node.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
}
function count(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    invalid(`${label} 必须是非负整数`);
  return Number(value);
}

export function parseJUnitReport(content) {
  const root = parseJavaXml(content);
  if (!["testsuite", "testsuites"].includes(root.name))
    invalid("缺少 JUnit 测试套件");
  function parseCase(item) {
    const types = item.children
      .filter((node) => ["failure", "error", "skipped"].includes(node.name))
      .map((node) => node.name);
    if (types.length > 1) invalid("同一测试用例的失败或跳过状态相互矛盾");
    if (!item.attributes.name || !item.attributes.classname)
      invalid("测试用例缺少名称或类名");
    return {
      name: item.attributes.name,
      classname: item.attributes.classname,
      failed: types.includes("failure") || types.includes("error"),
      failure: types.includes("failure"),
      error: types.includes("error"),
      skipped: types.includes("skipped"),
    };
  }
  function parseSuite(suite) {
    const nested = suite.children.filter((node) =>
      ["testsuite", "testsuites"].includes(node.name),
    );
    const direct = suite.children.filter((node) => node.name === "testcase");
    if (
      (suite.name === "testsuites" && direct.length) ||
      (nested.length && direct.length)
    )
      invalid("聚合套件不能混入直接测试用例");
    if (
      suite.children.some((node) =>
        ["failure", "error", "skipped"].includes(node.name),
      )
    )
      invalid("测试结果出现在用例外部");
    if (suite.name === "testsuites" && !nested.length) invalid("没有测试套件");
    const items = nested.length
      ? nested.flatMap(parseSuite)
      : direct.map(parseCase);
    if (suite.name === "testsuite" || suite.attributes.tests !== undefined) {
      if (count(suite.attributes.tests, "tests") !== items.length)
        invalid("测试总数与测试用例不一致");
    }
    for (const [field, key] of [
      ["failures", "failure"],
      ["errors", "error"],
      ["skipped", "skipped"],
    ]) {
      if (
        suite.attributes[field] !== undefined &&
        count(suite.attributes[field], field) !==
          items.filter((item) => item[key]).length
      )
        invalid(`${field} 计数与用例不一致`);
    }
    return items;
  }
  const cases = parseSuite(root);
  return {
    cases,
    total: cases.length,
    executed: cases.filter((item) => !item.skipped).length,
    failed: cases.filter((item) => item.failed).length,
    skipped: cases.filter((item) => item.skipped).length,
  };
}

export function parseJacocoReport(content) {
  const root = parseJavaXml(content, "report");
  const counterTypes = new Set([
    "LINE",
    "BRANCH",
    "INSTRUCTION",
    "METHOD",
    "CLASS",
    "COMPLEXITY",
  ]);
  for (const node of descendants(root, "counter")) {
    if (!counterTypes.has(node.attributes.type)) invalid("JaCoCo 计数类型无效");
    count(node.attributes.covered, "covered");
    count(node.attributes.missed, "missed");
  }
  const counterNodes = root.children.filter((node) => node.name === "counter");
  if (
    counterNodes.some((node) => !node.attributes.type) ||
    new Set(counterNodes.map((node) => node.attributes.type)).size !==
      counterNodes.length
  )
    invalid("JaCoCo 计数类型缺失或重复");
  const counters = Object.fromEntries(
    counterNodes.map((node) => [
      node.attributes.type.toLowerCase(),
      {
        missed: count(node.attributes.missed, "missed"),
        covered: count(node.attributes.covered, "covered"),
      },
    ]),
  );
  for (const type of ["line", "instruction"])
    if (!counters[type]) invalid(`缺少 JaCoCo ${type} 计数`);
  if (!counters.branch) {
    const subordinateBranches = root.children
      .flatMap((node) => descendants(node, "counter"))
      .filter((node) => node.attributes.type === "BRANCH");
    if (
      subordinateBranches.some(
        (node) =>
          count(node.attributes.covered, "covered") +
            count(node.attributes.missed, "missed") >
          0,
      )
    )
      invalid("JaCoCo 汇总遗漏了子级分支计数");
    counters.branch = { missed: 0, covered: 0 };
  }
  const sessions = root.children
    .filter((node) => node.name === "sessioninfo")
    .map((node) => ({
      start: count(node.attributes.start, "session start"),
      dump: count(node.attributes.dump, "session dump"),
    }));
  if (!sessions.length) invalid("缺少 JaCoCo 执行会话");
  const classes = descendants(root, "class");
  if (!classes.length || classes.some((node) => !node.attributes.name))
    invalid("缺少 JaCoCo 生产类数据");
  return { counters, sessions };
}

function child(node, name) {
  return node?.children.find((item) => item.name === name);
}
function text(node, name) {
  return child(node, name)?.text.trim() ?? "";
}
function configuredBoolean(primary, fallback, name, defaultValue) {
  const node = child(primary, name) ?? child(fallback, name);
  if (!node) return defaultValue;
  const value = node.text.trim().toLowerCase();
  return value === "true" ? true : value === "false" ? false : null;
}
function hasMergeControls(node) {
  return Boolean(
    node &&
      (Object.keys(node.attributes).some((name) =>
        name.startsWith("combine."),
      ) ||
        node.children.some(hasMergeControls)),
  );
}
export function parseEffectivePom(content, executionId) {
  const project = parseJavaXml(content, "project");
  const plugins =
    child(child(project, "build"), "plugins")?.children.filter(
      (node) => node.name === "plugin",
    ) ?? [];
  const enforcer = plugins.find(
    (node) =>
      text(node, "artifactId") === "maven-enforcer-plugin" &&
      ["org.apache.maven.plugins", ""].includes(text(node, "groupId")),
  );
  const execution = child(enforcer, "executions")?.children.find(
    (node) => text(node, "id") === executionId,
  );
  const configuration = child(execution, "configuration");
  const pluginConfiguration = child(enforcer, "configuration");
  const configuredRules = [
    ...(child(pluginConfiguration, "rules")?.children ?? []),
    ...(child(configuration, "rules")?.children ?? []),
  ];
  const rules = [...new Set(configuredRules.map((node) => node.name))];
  return {
    groupId: text(project, "groupId"),
    artifactId: text(project, "artifactId"),
    version: text(project, "version"),
    enforcerConfigured: Boolean(
      enforcer &&
        execution &&
        child(execution, "goals")?.children.some(
          (node) => node.text.trim() === "enforce",
        ),
    ),
    enforcerVersion: text(enforcer, "version"),
    rules,
    ruleLevels: Object.fromEntries(
      configuredRules.map((node) => [
        node.name,
        (text(node, "level") || "ERROR").toUpperCase(),
      ]),
    ),
    selectiveRules: [configuration, pluginConfiguration].some((node) =>
      ["rulesToSkip", "rulesToExecute"].some((name) =>
        Boolean(child(node, name)),
      ),
    ),
    unsupportedMerging: hasMergeControls(enforcer),
    skip: configuredBoolean(configuration, pluginConfiguration, "skip", false),
    fail: configuredBoolean(configuration, pluginConfiguration, "fail", true),
    dependencies: (child(project, "dependencies")?.children ?? []).map(
      (node) => ({
        groupId: text(node, "groupId"),
        artifactId: text(node, "artifactId"),
        version: text(node, "version"),
      }),
    ),
  };
}
const enforcerRuleClasses = Object.freeze({
  "org.apache.maven.enforcer.rules.dependency.DependencyConvergence":
    "dependencyConvergence",
  "org.apache.maven.enforcer.rules.dependency.RequireUpperBoundDeps":
    "requireUpperBoundDeps",
  "org.apache.maven.enforcer.rules.BanDuplicatePomDependencyVersions":
    "banDuplicatePomDependencyVersions",
  "org.apache.maven.enforcer.rules.dependency.BannedDependencies":
    "bannedDependencies",
  "org.apache.maven.enforcer.rules.dependency.RequireReleaseDeps":
    "requireReleaseDeps",
  "org.apache.maven.enforcer.rules.RequirePluginVersions":
    "requirePluginVersions",
  "org.apache.maven.enforcer.rules.BannedPlugins": "bannedPlugins",
  "org.apache.maven.enforcer.rules.dependency.BanDynamicVersions":
    "banDynamicVersions",
});
export function parseEnforcerRuleEvents(output) {
  return [
    ...output.matchAll(/\bRule\s+\d+:\s+([\w.$]+)\s+(passed|failed|warned)\b/g),
  ].map((match) => {
    return {
      className: match[1],
      rule: enforcerRuleClasses[match[1]] ?? null,
      outcome: match[2],
    };
  });
}
export function parseDependencyTree(content) {
  let root;
  try {
    root = JSON.parse(
      Buffer.isBuffer(content)
        ? new TextDecoder("utf-8", { fatal: true }).decode(content)
        : content,
    );
  } catch {
    invalid("依赖树不是有效 UTF-8 JSON");
  }
  const nodes = [];
  function visit(node, depth) {
    if (
      depth > 128 ||
      nodes.length > 100000 ||
      !node ||
      Array.isArray(node) ||
      ["groupId", "artifactId", "version"].some(
        (field) => typeof node[field] !== "string" || !node[field],
      )
    )
      invalid("依赖树节点缺少解析后的坐标");
    if (node.children !== undefined && !Array.isArray(node.children))
      invalid("依赖树 children 必须是数组");
    nodes.push({
      groupId: node.groupId,
      artifactId: node.artifactId,
      version: node.version,
      scope: node.scope ?? "",
    });
    for (const item of node.children ?? []) visit(item, depth + 1);
  }
  visit(root, 0);
  return { root: nodes[0], dependencies: nodes.slice(1) };
}
