import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectDependencyPolicy } from "../../src/gates/repository/dependency-policy.js";
import { validateDependencyPolicyConfiguration } from "../../src/config/dependency-policy-validation.js";
import { frozenInstallArguments } from "../../src/integrations/dependencies/package-manager.js";

const base = path.resolve("test/.tmp");
const tools = path.join(base, "dependency-manager-tools/node_modules");
const npm = path.join(
  path.dirname(process.execPath),
  "node_modules/npm/bin/npm-cli.js",
);
const adapters = [
  ["npm", "10.9.8", npm, "package-lock.json"],
  ["pnpm", "10.34.5", path.join(tools, "pnpm/bin/pnpm.cjs"), "pnpm-lock.yaml"],
  ["yarn", "1.22.22", path.join(tools, "yarn/bin/yarn.js"), "yarn.lock"],
  [
    "yarn",
    "4.18.0",
    path.join(tools, "@yarnpkg/cli-dist/bin/yarn.js"),
    "yarn.lock",
  ],
];
for (const [name, version, cli, lockPath] of adapters) {
  test(
    `真实 ${name} ${version} 安装、锁文件核对、冻结安装与漂移拒绝`,
    {
      skip:
        process.env.REPO_GUARD_REAL_MANAGERS !== "1"
          ? "需要显式启用真实包管理器联调"
          : false,
    },
    (t) => {
      assert.ok(existsSync(cli), `缺少联调包管理器 ${cli}`);
      mkdirSync(base, { recursive: true });
      const root = mkdtempSync(path.join(base, `real-${name}-`));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const manifest = {
        name: "dependency-fixture",
        version: "1.0.0",
        private: true,
        packageManager: `${name}@${version}`,
        dependencies: { "is-number": "7.0.0" },
      };
      const save = () =>
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify(manifest),
        );
      save();
      if (name === "yarn") writeFileSync(path.join(root, "yarn.lock"), "");
      if (name === "yarn" && version.startsWith("4."))
        writeFileSync(
          path.join(root, ".yarnrc.yml"),
          "nodeLinker: pnp\nenableGlobalCache: false\nenableTelemetry: false\nenableScripts: false\n",
        );
      const env = {
        ...process.env,
        CI: "true",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
        npm_config_cache: path.join(base, "manager-real-cache"),
        REPO_GUARD_SKIP_HOOKS: "1",
      };
      const run = (args) =>
        spawnSync(process.execPath, [cli, ...args], {
          cwd: root,
          encoding: "utf8",
          timeout: 90000,
          env,
          windowsHide: true,
        });
      const initial = run(["install"]);
      assert.equal(initial.status, 0, initial.stdout + initial.stderr);
      const policy = validateDependencyPolicyConfiguration(
        {
          dependencyPolicy: {
            packageManager: { name },
            toolReadiness: { enabled: false },
          },
        },
        "repo-guard.config.json",
      );
      const inspect = () =>
        inspectDependencyPolicy({
          root,
          config: policy,
          exceptions: { entries: [], maxDays: 90, warningDays: 14 },
        });
      writeFileSync(
        path.join(base, `generated-${name}-${version}.lock`),
        readFileSync(path.join(root, lockPath)),
      );
      assert.deepEqual(inspect().violations, []);
      const before = readFileSync(path.join(root, lockPath), "utf8");
      const frozen = run(frozenInstallArguments(name, version));
      assert.equal(frozen.status, 0, frozen.stdout + frozen.stderr);
      assert.equal(readFileSync(path.join(root, lockPath), "utf8"), before);
      if (name === "yarn" && version.startsWith("4.")) {
        assert.equal(existsSync(path.join(root, "node_modules")), false);
        const module = pathToFileURL(
          path.resolve("src/core/project/package.js"),
        ).href;
        const checked = run([
          "node",
          "--input-type=module",
          "-e",
          `import {resolveProjectPackageMetadata} from ${JSON.stringify(module)}; console.log(resolveProjectPackageMetadata(process.cwd(),'is-number','测试依赖').version);`,
        ]);
        assert.equal(checked.status, 0, checked.stdout + checked.stderr);
        assert.match(checked.stdout, /7\.0\.0/);
      }
      manifest.dependencies["is-number"] = "6.0.0";
      save();
      assert.ok(
        inspect().violations.some(
          (item) => item.rule === "dependencies/lockfile-mismatch",
        ),
      );
      const drift = run(frozenInstallArguments(name, version));
      assert.notEqual(drift.status, 0, "冻结安装不得接受清单漂移");
      assert.equal(readFileSync(path.join(root, lockPath), "utf8"), before);
    },
  );
}
