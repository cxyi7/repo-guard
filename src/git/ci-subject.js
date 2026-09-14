import { runGit } from "./execution.js";

export function trackedCiFiles(root) {
  return runGit(["ls-files", "-z"], { cwd: root })
    .stdout.split("\0")
    .filter(Boolean);
}

/** 只返回版本、索引与工作区事实；不修改用户索引，也不信任隐藏变更标记。 */
export function readCiSubject(root) {
  const read = (args) => runGit(args, { cwd: root }).stdout;
  const status = read([
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ])
    .split("\0")
    .filter(Boolean);
  const index = read(["ls-files", "-v", "--stage", "-z"])
    .split("\0")
    .filter(Boolean);
  return {
    head: read(["rev-parse", "--verify", "HEAD"]).trim(),
    trackedChanges: status.some((entry) => !entry.startsWith("?? ")),
    untracked: status
      .filter((entry) => entry.startsWith("?? "))
      .map((entry) => entry.slice(3)),
    hidden: index.filter((entry) => /^[a-zS]/.test(entry)),
    submodules: index.filter((entry) => /^[A-Za-z] 160000 /.test(entry)),
  };
}
