import fs from "node:fs";
import path from "node:path";
import {
  configurationError,
  executionError,
  toRepoGuardError,
} from "../../../core/error/repo-guard-error.js";

export function javaOutputPaths(config) {
  return config.modules.flatMap((module) => [
    ...(module.reports ?? []), ...(module.outputs ?? []),
    ...[module.coverageReport, module.effectivePom, module.dependencyTree].filter(Boolean),
  ]);
}

export function safeJavaPath(root, relative, { required = true } = {}) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative) ||
    relative.replaceAll("\\", "/").split("/").includes("..") ||
    relative.includes("\0")
  ) {
    throw configurationError(
      "java/path-outside-project",
      "Java 工具路径必须位于当前项目内",
    );
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  let current = base;
  for (const part of path
    .relative(base, target)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw configurationError(
          "java/symlink-path",
          `Java 工具路径不得经过符号链接：${relative}`,
        );
    } catch (error) {
      if (error.code === "ENOENT" && !required) return target;
      if (error.code === "ENOENT")
        throw executionError(
          "java/missing-file",
          `Java 工具所需文件不存在：${relative}`,
        );
      throw toRepoGuardError(error, {
        code: "java/path-read-failed",
        message: `无法读取 Java 工具路径：${relative}`,
      });
    }
  }
  return target;
}

export function javaFileStamp(root, relative) {
  const target = safeJavaPath(root, relative, { required: false });
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile())
      throw executionError(
        "java/not-a-file",
        `Java 输出必须是普通文件：${relative}`,
      );
    return {
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      ino: stat.ino,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw toRepoGuardError(error, {
      code: "java/file-metadata-failed",
      message: `无法读取 Java 文件元数据：${relative}`,
    });
  }
}

export function readFreshJavaFile(
  root,
  relative,
  startedAt,
  previous,
  { headerOnly = false } = {},
) {
  const target = safeJavaPath(root, relative);
  const stamp = javaFileStamp(root, relative);
  if (
    !stamp ||
    stamp.mtimeMs < startedAt ||
    (previous &&
      stamp.mtimeMs === previous.mtimeMs &&
      stamp.ctimeMs === previous.ctimeMs &&
      stamp.ino === previous.ino)
  ) {
    throw executionError(
      "java/stale-output",
      `Java 输出不是本次执行生成：${relative}`,
    );
  }
  if (stamp.size === 0 || (!headerOnly && stamp.size > 32 * 1024 * 1024))
    throw executionError(
      "java/invalid-output-size",
      `Java 输出为空或超过读取上限：${relative}`,
    );
  let content;
  if (headerOnly) {
    const descriptor = fs.openSync(target, "r");
    try {
      content = Buffer.alloc(Math.min(4, stamp.size));
      fs.readSync(descriptor, content, 0, content.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
  } else content = fs.readFileSync(target);
  const after = javaFileStamp(root, relative);
  if (
    stamp.mtimeMs !== after.mtimeMs ||
    stamp.ctimeMs !== after.ctimeMs ||
    stamp.size !== after.size ||
    stamp.ino !== after.ino
  )
    throw executionError(
      "java/output-changed",
      `读取期间 Java 输出发生变化：${relative}`,
    );
  return content;
}
