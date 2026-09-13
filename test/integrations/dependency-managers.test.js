import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateDependencyPolicyConfiguration } from "../../src/config/dependency-policy-validation.js";
import {
  inspectDependencyPolicy,
  inspectStagedDependencyPolicy,
} from "../../src/gates/repository/dependency-policy.js";
import { inspectLockfile } from "../../src/integrations/dependencies/lockfile.js";
import { normalizeProjectDocument } from "../../src/config/project-configuration.js";
import { PROJECT_CHECK_PATHS } from "../../src/config/project-feature-paths.js";
import { inspectDependencyToolReadiness } from "../../src/gates/repository/dependency-tool-readiness.js";
import { dependencyInstallation } from "../../src/operations/gitlab/dependency-installation.js";
import { frozenInstallArguments } from "../../src/integrations/dependencies/package-manager.js";
import { resolveProjectPackageMetadata } from "../../src/core/project/package.js";

const base = path.resolve("test/.tmp");
mkdirSync(base, { recursive: true });
const exceptions = { entries: [], maxDays: 90, warningDays: 14 };
function settings(value = {}) {
  return validateDependencyPolicyConfiguration(
    { dependencyPolicy: value },
    "repo-guard.config.json",
  );
}
function fixture(t, manifest = {}) {
  const root = mkdtempSync(path.join(base, "manager-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init");
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  write("package.json", {
    name: "fixture",
    version: "1.0.0",
    packageManager: "npm@10.9.8",
    ...manifest,
  });
  return {
    root,
    write,
    git,
    inspect: (config = {}) =>
      inspectDependencyPolicy({ root, config: settings(config), exceptions }),
  };
}

test("三个包管理器配置、独立开关与特殊引用旧入口校验", () => {
  for (const [name, file] of [
    ["npm", "package-lock.json"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
  ])
    assert.equal(settings({ packageManager: { name } }).lockfile.path, file);
  for (const value of [
    { allowedProtocols: [] },
    { packageManager: null },
    { lockfile: null },
    { toolReadiness: null },
    { lockfile: { path: null } },
    { packageManager: { name: "auto" } },
    { packageManager: { root: "C:/elsewhere" } },
    { lockfile: { path: "../lock" } },
    { toolReadiness: { checkPeerDependencies: "yes" } },
  ])
    assert.throws(
      () => settings(value),
      (error) => error.kind === "configuration",
    );
});
for (const [version, accepted] of [
  ["1.2.3", true],
  ["1.2.3-beta.1", true],
  ["1.2.3+build.2", true],
  ["01.2.3", false],
  ["1.2.3-01", false],
  ["1.2.3-..", false],
  ["v1.2.3", false],
  ["=1.2.3", false],
  ["^1.2.3", false],
  ["~1.2.3", false],
  ["1.2", false],
  ["latest", false],
  ["*", false],
]) {
  test(`严格版本声明 ${version}`, (t) => {
    const f = fixture(t, { dependencies: { sample: version } });
    const result = f.inspect({ requireLockfile: false });
    assert.equal(
      result.violations.length === 0,
      accepted,
      JSON.stringify(result),
    );
  });
}
test("特殊引用不产生违规，与精确版本开关无关", (t) => {
  const f = fixture(t, {
    dependencies: Object.fromEntries(
      [
        "npm:x@1.0.0",
        "workspace:*",
        "catalog:",
        "file:../x",
        "../local",
        "./local",
        "C:/local",
        "owner/repository#main",
        "link:../x",
        "https://x/a.tgz",
        "git+https://x/a.git",
        "patch:x",
      ].map((v, i) => [`sample-${i}`, v]),
    ),
  });
  for (const requireExactVersions of [true, false]) {
    assert.deepEqual(
      f.inspect({ requireLockfile: false, requireExactVersions }).violations,
      [],
    );
  }
});
test("peer 范围与可选依赖覆盖不误报，不同普通声明版本冲突会报告", (t) => {
  const f = fixture(t, {
    dependencies: { sample: "1.0.0" },
    optionalDependencies: { sample: "2.0.0" },
    peerDependencies: { sample: "^1 || ^2" },
    devDependencies: { sample: "2.0.0" },
  });
  assert.equal(f.inspect({ requireLockfile: false }).violations.length, 0);
  f.write("package.json", {
    packageManager: "npm@10.9.8",
    dependencies: { sample: "1.0.0" },
    devDependencies: { sample: "2.0.0" },
  });
  assert.ok(
    f
      .inspect({ requireLockfile: false })
      .violations.some(
        (item) => item.rule === "dependencies/duplicate-declaration",
      ),
  );
});
test("npm 核对直接依赖解析记录，不只比较根声明", (t) => {
  const f = fixture(t, { dependencies: { sample: "1.2.3" } });
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { sample: "1.2.3" } },
      "node_modules/sample": { version: "1.2.3" },
    },
  };
  f.write("package-lock.json", lock);
  assert.equal(f.inspect().violations.length, 0);
  delete lock.packages["node_modules/sample"];
  f.write("package-lock.json", lock);
  assert.ok(
    f
      .inspect()
      .violations.some(
        (item) => item.rule === "dependencies/lockfile-mismatch",
      ),
  );
});
test("最终索引与工作区分开检查，并拒绝冲突锁文件", (t) => {
  const f = fixture(t, { dependencies: { sample: "1.2.3" } });
  f.write("package-lock.json", {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { sample: "1.2.3" } },
      "node_modules/sample": { version: "1.2.3" },
    },
  });
  f.git("add", ".");
  f.write("package-lock.json", "{}");
  assert.equal(
    inspectStagedDependencyPolicy({
      root: f.root,
      config: settings(),
      exceptions,
    }).violations.length,
    0,
  );
  assert.throws(
    () => f.inspect(),
    (error) => error.kind === "configuration",
  );
  f.write("yarn.lock", "# yarn lockfile v1");
  f.git("add", "yarn.lock");
  assert.ok(
    inspectStagedDependencyPolicy({
      root: f.root,
      config: settings(),
      exceptions,
    }).violations.some(
      (item) => item.rule === "dependencies/conflicting-lockfile",
    ),
  );
});
test("pnpm 普通依赖按 importer 和 packages 核对，未知格式或缺失记录不能通过", () => {
  const source =
    "lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n      sample:\n        specifier: 1.2.3\n        version: 1.2.3\npackages:\n  sample@1.2.3:\n    resolution: {integrity: test}\n";
  const run = (text) =>
    inspectLockfile({
      source: text,
      manager: "pnpm",
      file: "pnpm-lock.yaml",
      manifest: { dependencies: { sample: "1.2.3" } },
    });
  assert.equal(run(source).length, 0);
  assert.equal(run(source.replace("sample@1.2.3:", "sample@2.0.0:")).length, 1);
  assert.throws(() => run(source.replace("9.0", "999.0")), /格式/);
  assert.throws(() => run(source + "packages: {}\n"), /解析/);
});
test("两代 Yarn 按描述符验证版本，不能只搜索相同包名", () => {
  for (const source of [
    '# yarn lockfile v1\n\nsample@1.2.3:\n  version "1.2.3"\n  resolved "https://registry.npmjs.org/sample/-/sample-1.2.3.tgz"\n',
    '__metadata:\n  version: 8\n"sample@npm:1.2.3":\n  version: 1.2.3\n  resolution: "sample@npm:1.2.3"\n',
  ]) {
    const run = (manifest) =>
      inspectLockfile({ source, manager: "yarn", file: "yarn.lock", manifest });
    assert.equal(run({ dependencies: { sample: "1.2.3" } }).length, 0);
    assert.equal(run({ dependencies: { sample: "2.0.0" } }).length, 1);
  }
});
test("共享锁文件只检查已声明的工作区应用，拒绝越界目录", (t) => {
  const f = fixture(t, { workspaces: ["apps/*"] });
  f.write("apps/web/package.json", {
    name: "web",
    dependencies: { sample: "1.2.3" },
  });
  f.write("package-lock.json", {
    lockfileVersion: 3,
    packages: {
      "apps/web": { dependencies: { sample: "1.2.3" } },
      "node_modules/sample": { version: "1.2.3" },
    },
  });
  const run = (directory) =>
    inspectDependencyPolicy({
      root: path.join(f.root, "apps/web"),
      config: settings({ packageManager: { root: directory } }),
      exceptions,
    });
  assert.equal(run("../..").violations.length, 0);
  assert.throws(() => run("../../.."), /根目录/);
});
test("工具就绪检查识别未声明工具、实际工具版本和所配置脚本", async (t) => {
  const f = fixture(t);
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: "web",
      role: "frontend",
      stack: "node",
      preset: "vue-javascript",
    },
    checks: Object.fromEntries(
      Object.keys(PROJECT_CHECK_PATHS).map((name) => [
        name,
        { enabled: false },
      ]),
    ),
    repository: {
      dependencyPolicy: {
        packageManager: { checkInstalledVersion: false },
        toolReadiness: { checkConfigLoading: false },
      },
    },
  });
  config.checks.prettier.enabled = true;
  await assert.rejects(
    inspectDependencyToolReadiness({ root: f.root, config }),
    /显式声明/,
  );
  f.write("package.json", {
    packageManager: "npm@10.9.8",
    devDependencies: { prettier: "3.0.0" },
  });
  f.write("node_modules/prettier/package.json", {
    name: "prettier",
    version: "2.0.0",
    engines: { node: ">=22" },
  });
  await assert.rejects(
    inspectDependencyToolReadiness({ root: f.root, config }),
    /不满足/,
  );
  f.write("node_modules/prettier/package.json", {
    name: "prettier",
    version: "3.0.0",
    peerDependencies: { missing: "^1" },
    peerDependenciesMeta: { missing: { optional: true } },
  });
  assert.equal(
    (await inspectDependencyToolReadiness({ root: f.root, config }))
      .checkedTools,
    1,
  );
  f.write("node_modules/prettier/package.json", {
    name: "prettier",
    version: "3.1.0",
  });
  await assert.rejects(
    inspectDependencyToolReadiness({ root: f.root, config }),
    /项目声明/,
  );
  f.write("node_modules/prettier/package.json", {
    name: "prettier",
    version: "3.0.0",
  });
  config.checks.build.enabled = true;
  config.checks.build.script = "custom-build";
  await assert.rejects(
    inspectDependencyToolReadiness({ root: f.root, config }),
    /custom-build/,
  );
});
test("CI 按声明选择准确包管理器及冻结安装，Yarn 不回退到 npm ci", (t) => {
  const f = fixture(t);
  for (const [name, version, flag] of [
    ["npm", "10.9.8", "ci"],
    ["pnpm", "10.34.5", "--frozen-lockfile"],
    ["yarn", "1.22.22", "--frozen-lockfile"],
    ["yarn", "4.18.0", "--immutable"],
  ]) {
    f.write("package.json", { packageManager: `${name}@${version}` });
    const result = dependencyInstallation(f.root, {
      repository: { dependencyPolicy: settings({ packageManager: { name } }) },
    });
    assert.ok(result.commands.at(-1).includes(flag));
    assert.ok(result.commands[0].endsWith(`@${version}`));
    assert.deepEqual(
      frozenInstallArguments(name, version),
      name === "npm" ? ["ci"] : ["install", flag],
    );
  }
});

test("真实 Prettier 配置加载尊重用户值，并拒绝语法错误与缺失插件", async (t) => {
  const f = fixture(t, { devDependencies: { prettier: "3.6.2" } });
  mkdirSync(path.join(f.root, "node_modules"), { recursive: true });
  symlinkSync(
    path.resolve("node_modules/prettier"),
    path.join(f.root, "node_modules/prettier"),
    "junction",
  );
  f.write("src/value.js", "export const value = 1;");
  f.write(".prettierrc.json", { singleQuote: false });
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: "web",
      role: "frontend",
      stack: "node",
      preset: "vue-javascript",
    },
    checks: {
      ...Object.fromEntries(
        Object.keys(PROJECT_CHECK_PATHS).map((name) => [
          name,
          { enabled: false },
        ]),
      ),
      prettier: { enabled: true },
    },
    repository: {
      dependencyPolicy: { packageManager: { checkInstalledVersion: false } },
    },
  });
  const run = () =>
    inspectDependencyToolReadiness({
      root: f.root,
      config,
      files: ["src/value.js"],
    });
  assert.equal((await run()).checkedConfigurations, 1);
  f.write(".prettierrc.json", "{ broken");
  await assert.rejects(run(), /配置加载失败/);
  f.write(".prettierrc.json", { plugins: ["prettier-plugin-does-not-exist"] });
  await assert.rejects(run(), /配置加载失败/);
});

test("pnpm 6 带 peer 上下文的普通依赖记录可以核对", () => {
  const source =
    "lockfileVersion: 6.0\nimporters:\n  .:\n    dependencies:\n      sample:\n        specifier: 1.2.3\n        version: 1.2.3(peer@2.0.0)\npackages:\n  /sample@1.2.3(peer@2.0.0):\n    resolution: {integrity: test}\n";
  assert.deepEqual(
    inspectLockfile({
      source,
      manager: "pnpm",
      file: "pnpm-lock.yaml",
      manifest: { dependencies: { sample: "1.2.3" } },
    }),
    [],
  );
});

test("关闭精确声明允许标签，但仍必须存在有效锁定版本", (t) => {
  const f = fixture(t, { dependencies: { sample: "latest" } });
  f.write("package-lock.json", {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { sample: "latest" } },
      "node_modules/sample": { version: "1.2.3" },
    },
  });
  assert.equal(f.inspect({ requireExactVersions: false }).violations.length, 0);
  assert.ok(f.inspect().violations.length > 0);
});

test("PnP 环境未加载时不能回退到祖先目录依赖", (t) => {
  const f = fixture(t);
  f.write(".pnp.cjs", "");
  assert.throws(
    () => resolveProjectPackageMetadata(f.root, "prettier", "格式工具"),
    (error) => error.code === "project-package/pnp-environment",
  );
});

test("根管理仓库采用显式 pnpm 声明，托管 CI 拒绝自定义锁文件路径", (t) => {
  const f = fixture(t, { packageManager: "pnpm@10.34.5" });
  assert.equal(
    dependencyInstallation(f.root, { projects: [] }).runner,
    "pnpm exec",
  );
  assert.throws(
    () =>
      dependencyInstallation(f.root, {
        repository: {
          dependencyPolicy: settings({
            packageManager: { name: "pnpm" },
            lockfile: { path: "metadata/lock.yaml" },
          }),
        },
      }),
    (error) => error.code === "gitlab-ci/custom-lockfile",
  );
});

for (const manager of ["npm", "pnpm", "yarn-classic", "yarn-modern"]) {
  test(`${manager} 混合依赖跳过特殊引用，普通依赖仍检查且索引结果一致`, (t) => {
    const name = manager.startsWith("yarn") ? "yarn" : manager;
    const dependencies = {
      ordinary: "1.2.3",
      local: "workspace:*",
      alias: "npm:other@2.0.0",
    };
    const f = fixture(t, {
      packageManager: `${name}@${name === "npm" ? "10.9.8" : name === "pnpm" ? "10.34.5" : "4.18.0"}`,
      dependencies,
    });
    const lockPath = {
      npm: "package-lock.json",
      pnpm: "pnpm-lock.yaml",
      yarn: "yarn.lock",
    }[name];
    function lock(version) {
      if (name === "npm")
        return JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: {
                ordinary: "1.2.3",
                local: "file:../elsewhere",
                alias: "npm:other@9.0.0",
                removed: "link:../removed",
              },
            },
            "node_modules/ordinary": { version },
          },
        });
      if (name === "pnpm")
        return JSON.stringify({
          lockfileVersion: 9,
          importers: {
            ".": {
              dependencies: {
                ordinary: { specifier: "1.2.3", version },
                local: { specifier: "workspace:~", version: "link:../local" },
                removed: { specifier: "file:../removed" },
              },
            },
          },
          packages: { [`ordinary@${version}`]: {} },
        });
      return manager === "yarn-classic"
        ? `# yarn lockfile v1\nordinary@1.2.3:\n  version "${version}"\n`
        : `__metadata:\n  version: 10\n"ordinary@npm:1.2.3":\n  version: ${version}\n`;
    }
    const options = { packageManager: { name } };
    f.write(lockPath, lock("1.2.3"));
    assert.deepEqual(f.inspect(options).violations, []);
    f.write(lockPath, lock("9.0.0"));
    const violations = f.inspect(options).violations;
    assert.equal(violations.length, 1);
    assert.equal(violations[0].dependency, "ordinary");
    f.git("add", ".");
    assert.deepEqual(
      inspectStagedDependencyPolicy({
        root: f.root,
        config: settings(options),
        exceptions,
      }).violations,
      violations,
    );
  });
}

test("特殊引用不参与禁用包与重复声明检查，普通范围及非法值仍报告", (t) => {
  const f = fixture(t, {
    dependencies: {
      special: "file:../local",
      range: "^1.2.3",
      invalid: 42,
      broken: "1.2.3-01",
    },
    devDependencies: { special: "workspace:*" },
  });
  const result = f.inspect({
    requireLockfile: false,
    bannedPackages: [
      { name: "special", reason: "本测试确认特殊引用完全不参与此项检查" },
    ],
  });
  assert.equal(result.violations.length, 3);
  assert.ok(result.violations.every((item) => item.dependency !== "special"));
});

test("普通依赖不能用锁文件中的特殊引用绕过一致性检查", () => {
  const result = inspectLockfile({
    manager: "npm",
    file: "package-lock.json",
    manifest: { dependencies: { ordinary: "1.2.3" } },
    source: JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { dependencies: { ordinary: "file:../local" } } },
    }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].dependency, "ordinary");
});

test("特殊引用工具不参与依赖就绪元数据检查", async (t) => {
  const f = fixture(t, { devDependencies: { prettier: "workspace:*" } });
  const config = normalizeProjectDocument({
    version: 2,
    project: {
      id: "web",
      role: "frontend",
      stack: "node",
      preset: "vue-javascript",
    },
    checks: {
      ...Object.fromEntries(
        Object.keys(PROJECT_CHECK_PATHS).map((name) => [
          name,
          { enabled: false },
        ]),
      ),
      prettier: { enabled: true },
    },
    repository: {
      dependencyPolicy: {
        packageManager: { checkInstalledVersion: false },
        toolReadiness: { checkConfigLoading: false },
      },
    },
  });
  assert.equal(
    (await inspectDependencyToolReadiness({ root: f.root, config }))
      .checkedTools,
    0,
  );
});
