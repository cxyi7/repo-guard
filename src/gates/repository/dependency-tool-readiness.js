import { isSpecialDependencyReference } from "../../integrations/dependencies/version.js";
import { collectProjectFiles } from "../../policies/file-placement.js";
import { terminateProcessTree } from "../../core/execution/process-tree.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { dependencySnapshot } from "./dependency-snapshot.js";
import { dependencyOptions } from "../../config/dependency-options.js";
import { getFrontendToolRequirements } from "../../profiles/frontend-tool-requirements.js";
import { resolveProjectPackageMetadata } from "../../core/project/package.js";
import {
  configurationError,
  executionError,
  toRepoGuardError,
} from "../../core/error/repo-guard-error.js";
import { readPackageManagerVersion } from "../../integrations/dependencies/package-manager.js";

function assertRange(version, range, label) {
  if (
    typeof range !== "string" ||
    !semver.validRange(range) ||
    !semver.valid(version) ||
    !semver.satisfies(version, range)
  )
    throw configurationError(
      "dependency-policy/tool-version",
      `${label} 版本 ${version} 不满足明确要求 ${range}`,
    );
}
function declaration(manifest, name) {
  return (
    manifest.dependencies?.[name] ??
    manifest.devDependencies?.[name] ??
    manifest.optionalDependencies?.[name]
  );
}

function loadConfigurations(root, config, files) {
  return new Promise((resolve, reject) => {
    const child = fork(
      fileURLToPath(new URL("../dependency-tool-worker.js", import.meta.url)),
      [],
      {
        cwd: root,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        detached: process.platform !== "win32",
        execArgv: process.execArgv.filter((arg) => !arg.startsWith("--test")),
        windowsHide: true,
      },
    );
    let settled = false;
    let timer;
    const finish = async (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await terminateProcessTree(child);
      } catch (cause) {
        reject(
          executionError(
            "dependency-policy/config-cleanup",
            "工具配置进程树清理失败",
            { cause },
          ),
        );
        return;
      }
      if (error) reject(error);
      else resolve(value);
    };
    timer = setTimeout(() => {
      void finish(
        executionError(
          "dependency-policy/config-timeout",
          "工具配置加载超过 30 秒",
        ),
      );
    }, 30000);
    child.once("error", (cause) => {
      void finish(
        executionError(
          "dependency-policy/config-worker",
          "无法启动工具配置加载进程",
          { cause },
        ),
      );
    });
    child.once("message", (result) => {
      void finish(
        result?.ok === true
          ? null
          : configurationError(
              "dependency-policy/config-loading",
              "工具配置加载失败：" + (result?.message ?? "未返回诊断"),
            ),
        result?.checked,
      );
    });
    child.once("exit", () => {
      if (!settled)
        void finish(
          executionError(
            "dependency-policy/config-worker-exit",
            "工具配置加载进程提前退出，未完成验证",
          ),
        );
    });
    child.send({ root, config, files }, (error) => {
      if (error)
        void finish(
          executionError(
            "dependency-policy/config-worker-send",
            "无法发送工具配置验证任务",
            { cause: error },
          ),
        );
    });
  });
}

export async function inspectDependencyToolReadiness({
  root,
  config,
  files = [],
  doctor = false,
}) {
  const policy = {
    ...config.repository.dependencyPolicy,
    ...dependencyOptions(
      config.repository.dependencyPolicy,
      "repository.dependencyPolicy",
    ),
  };
  const snapshot = dependencySnapshot(root, policy);
  const { rootManifest, packageFile, installRoot } = snapshot;
  const expected = rootManifest.packageManager?.match(
    /^(npm|pnpm|yarn)@([^+]+)/,
  );
  if (policy.packageManager.checkInstalledVersion) {
    if (
      !expected ||
      expected[1] !== policy.packageManager.name ||
      semver.valid(expected[2]) !== expected[2]
    )
      throw configurationError(
        "dependency-policy/package-manager-declaration",
        "验证包管理器版本前必须声明与配置一致的 packageManager 精确版本",
      );
    const actual = await readPackageManagerVersion(
      installRoot,
      policy.packageManager.name,
    );
    if (actual !== expected[2])
      throw configurationError(
        "dependency-policy/package-manager-version",
        `实际 ${policy.packageManager.name} 版本 ${actual} 与项目声明 ${expected[2]} 不一致`,
      );
  }
  const settings = policy.toolReadiness;
  if (!settings.enabled) return { checkedTools: 0, checkedConfigurations: 0 };
  const manifest = packageFile.value;
  if (settings.checkNodeEngines) {
    for (const item of [rootManifest, manifest])
      if (item.engines?.node != null)
        assertRange(process.versions.node, item.engines.node, "项目 Node.js");
  }
  const requirements = getFrontendToolRequirements(config);
  let checkedTools = 0;
  for (const requirement of requirements) {
    const { name, versionRange } = requirement;
    const ownerRoot = declaration(manifest, name)
      ? root
      : declaration(rootManifest, name)
        ? installRoot
        : root;
    if (
      settings.requireDeclaredDependencies &&
      !declaration(manifest, name) &&
      !declaration(rootManifest, name)
    )
      throw configurationError(
        "dependency-policy/tool-not-declared",
        `已启用能力需要显式声明直接依赖 ${name}`,
      );
    const declaredVersion = declaration(
      ownerRoot === root ? manifest : rootManifest,
      name,
    );
    if (isSpecialDependencyReference(name, declaredVersion)) continue;
    const metadata = resolveProjectPackageMetadata(
      ownerRoot,
      name,
      "已启用检查工具",
      { requireEntry: false },
    );
    const packageJson = JSON.parse(readFileSync(metadata.packagePath, "utf8"));
    if (settings.checkToolVersions && versionRange)
      assertRange(metadata.version, versionRange, name);

    if (
      settings.checkToolVersions &&
      declaredVersion &&
      semver.validRange(declaredVersion)
    )
      assertRange(metadata.version, declaredVersion, `${name} 的项目声明`);
    if (settings.checkNodeEngines && packageJson.engines?.node != null)
      assertRange(
        process.versions.node,
        packageJson.engines.node,
        `${name} 的 Node.js`,
      );
    if (settings.checkPeerDependencies) {
      for (const [peer, range] of Object.entries(
        packageJson.peerDependencies ?? {},
      )) {
        if (
          isSpecialDependencyReference(peer, range) ||
          isSpecialDependencyReference(
            peer,
            declaration(manifest, peer) ?? declaration(rootManifest, peer),
          )
        )
          continue;
        let resolved;
        try {
          resolved = resolveProjectPackageMetadata(
            path.dirname(metadata.packagePath),
            peer,
            `${name} 的 peer 依赖`,
            { requireEntry: false },
          );
        } catch (error) {
          if (
            packageJson.peerDependenciesMeta?.[peer]?.optional &&
            error.code === "project-package/dependency-not-installed"
          )
            continue;
          throw toRepoGuardError(error, {
            code: "dependency-policy/peer-resolution",
            kind: "configuration",
          });
        }
        assertRange(resolved.version, range, `${name} 的 peer ${peer}`);
      }
    }
    checkedTools += 1;
  }
  if (settings.checkRequiredScripts) {
    for (const name of ["typeCheck", "build", "unitTest"]) {
      const check = config.checks[name];
      if (
        check?.enabled &&
        (name !== "typeCheck" || !check.options) &&
        check.script &&
        (typeof manifest.scripts?.[check.script] !== "string" ||
          !manifest.scripts[check.script].trim())
      )
        throw configurationError(
          "dependency-policy/missing-script",
          `${name} 配置的脚本 ${check.script} 未在当前应用声明`,
        );
    }
  }
  const checked = settings.checkConfigLoading
    ? await loadConfigurations(
        root,
        config,
        (doctor ? collectProjectFiles(root) : files).map((file) =>
          typeof file === "string" ? file : file.relative,
        ),
      )
    : 0;
  return { checkedTools, checkedConfigurations: checked };
}
