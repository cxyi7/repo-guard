import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import YAML from "yaml";
import { readStagedMetadataFile } from "../../git/staged-package-metadata.js";
import { findRepositoryRoot } from "../../git/repository.js";
import { configurationError } from "../../core/error/repo-guard-error.js";
import { parsePackageMetadata } from "../../integrations/npm/package-metadata.js";

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
export function dependencySnapshot(root, config, staged = false) {
  root = realpathSync.native(root);
  const repositoryRoot =
    findRepositoryRoot(root, { allowMissing: true }) ?? root;
  const installRoot = path.resolve(root, config.packageManager.root);
  if (!inside(repositoryRoot, installRoot) || !inside(installRoot, root))
    throw configurationError(
      "dependency-policy/root",
      "安装根目录必须为当前应用的祖先目录，并位于当前 Git 仓库内",
    );
  const read = (file) => {
    const absolute = path.resolve(installRoot, file);
    if (!inside(repositoryRoot, absolute))
      throw configurationError(
        "dependency-policy/path",
        "依赖元数据路径超出仓库范围",
      );
    if (staged) {
      const relative = path
        .relative(repositoryRoot, absolute)
        .replaceAll("\\", "/");
      return readStagedMetadataFile(repositoryRoot, relative);
    }
    if (!existsSync(absolute)) return null;
    if (
      !inside(realpathSync(repositoryRoot), realpathSync(absolute)) ||
      !statSync(absolute).isFile()
    )
      throw configurationError(
        "dependency-policy/file",
        `依赖元数据必须为仓库内的普通文件：${file}`,
      );
    if (statSync(absolute).size > 32 * 1024 * 1024)
      throw configurationError(
        "dependency-policy/file-size",
        `依赖元数据超过 32 MiB 限制：${file}`,
      );
    return readFileSync(absolute, "utf8");
  };
  const importer =
    path.relative(installRoot, root).replaceAll("\\", "/") || ".";
  const manifestPath =
    importer === "." ? "package.json" : `${importer}/package.json`;
  const source = read(manifestPath);
  if (source == null)
    throw configurationError(
      "dependency-policy/missing-manifest",
      `缺少应用清单 ${manifestPath}`,
    );
  const packageFile = parsePackageMetadata(source, manifestPath);
  const rootSource = importer === "." ? source : read("package.json");
  if (rootSource == null)
    throw configurationError(
      "dependency-policy/missing-root",
      "安装根目录缺少 package.json",
    );
  const rootManifest = parsePackageMetadata(rootSource, "package.json").value;
  if (importer !== ".") {
    let patterns = rootManifest.workspaces?.packages ?? rootManifest.workspaces;
    if (config.packageManager.name === "pnpm") {
      const workspace = read("pnpm-workspace.yaml");
      try {
        patterns =
          workspace == null
            ? null
            : YAML.parse(workspace, { uniqueKeys: true }).packages;
      } catch (cause) {
        throw configurationError(
          "dependency-policy/workspace",
          "pnpm-workspace.yaml 无法解析",
          { cause },
        );
      }
    }
    if (
      !Array.isArray(patterns) ||
      !patterns.every((item) => typeof item === "string") ||
      !micromatch([importer], patterns, { dot: true }).length
    )
      throw configurationError(
        "dependency-policy/workspace",
        "当前应用未在配置的安装根目录中声明为工作区成员",
      );
  }
  return {
    root,
    installRoot,
    repositoryRoot,
    importer,
    packageFile,
    rootManifest,
    read,
  };
}
