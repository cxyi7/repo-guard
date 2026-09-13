import { readFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";
import { dependencyOptions } from "../../config/dependency-options.js";
import { configurationError } from "../../core/error/repo-guard-error.js";
import { frozenInstallArguments } from "../../integrations/dependencies/package-manager.js";

export function dependencyInstallation(root, config) {
  const policy = config.repository?.dependencyPolicy ?? {};
  let settings = dependencyOptions(policy, "repository.dependencyPolicy");
  const directory = settings.packageManager.root;
  const absolute = path.resolve(root, directory);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw configurationError(
      "gitlab-ci/install-root",
      "托管 CI 的安装目录必须位于 CI 项目根目录内",
    );
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(absolute, "package.json"), "utf8"),
    );
  } catch (cause) {
    throw configurationError(
      "gitlab-ci/install-manifest",
      "无法读取 CI 安装根目录的 package.json",
      { cause },
    );
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw configurationError(
      "gitlab-ci/install-manifest",
      "CI 安装根目录的 package.json 必须为对象",
    );
  const match =
    /^(npm|pnpm|yarn)@([^+]+)(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/.exec(
      manifest.packageManager ?? "",
    );
  if (Array.isArray(config.projects) && match && !policy.packageManager)
    settings = dependencyOptions(
      { packageManager: { name: match[1] } },
      "repository.dependencyPolicy",
    );
  const { name, requireVersionDeclaration } = settings.packageManager;
  const nativeLock = {
    npm: "package-lock.json",
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
  }[name];
  if (settings.lockfile.path !== nativeLock)
    throw configurationError(
      "gitlab-ci/custom-lockfile",
      "托管 CI 仅支持包管理器默认锁文件路径；自定义锁路径需要项目自行配置并验证安装流程",
    );
  if (
    (requireVersionDeclaration || manifest.packageManager || name !== "npm") &&
    (!match || match[1] !== name || semver.valid(match[2]) !== match[2])
  )
    throw configurationError(
      "gitlab-ci/package-manager",
      "生成 CI 前必须声明与配置一致的包管理器精确版本",
    );
  const version = match?.[2];
  const commands = [];
  if (version)
    commands.push(
      `npm install --global ${name === "yarn" && semver.major(version) >= 2 ? "@yarnpkg/cli-dist" : name}@${version}`,
    );
  const shellDirectory = `'${directory.replaceAll("'", "'\\''")}'`;
  const install = `${name} ${frozenInstallArguments(name, version ?? "0.0.0").join(" ")}`;
  commands.push(
    directory === "." ? install : `(cd ${shellDirectory} && ${install})`,
  );
  return {
    commands,
    lockfile: path.posix.join(directory, settings.lockfile.path),
    runner: name === "npm" ? "npx --no-install" : `${name} exec`,
  };
}
