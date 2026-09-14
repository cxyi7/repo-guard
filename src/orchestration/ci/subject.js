import { configurationError } from "../../core/error/repo-guard-error.js";
import path from "node:path";
import { readCiSubject, trackedCiFiles } from "../../git/ci-subject.js";

export function assertCiConfiguration(root, files) {
  const tracked = new Set(trackedCiFiles(root));
  if (
    files.some(
      (file) => !tracked.has(path.relative(root, file).replaceAll("\\", "/")),
    )
  ) {
    throw configurationError(
      "ci/untracked-configuration",
      "CI 配置必须提交到当前 Git 仓库；被忽略或尚未跟踪的配置不能作为该提交的检查依据。",
    );
  }
}

export function assertCiSubject(root, head, reportPaths = []) {
  const subject = readCiSubject(root);
  const allowed = new Set([
    ...reportPaths,
    "reports/ci-notification-test.json",
  ]);
  if (
    subject.head !== head ||
    subject.trackedChanges ||
    subject.hidden.length ||
    subject.submodules.length ||
    subject.untracked.some((file) => !allowed.has(file))
  ) {
    throw configurationError(
      "ci/subject-mismatch",
      "CI 受检内容与目标提交不一致，或存在无法验证的索引标记、子模块。请在目标提交的干净工作区执行，提交或保存现有修改；报告和构建产物应配置为忽略文件。",
      {
        expected:
          "当前 HEAD、暂存区、受检文件及配置必须对应同一目标提交；执行前后和步骤之间保持一致。",
      },
    );
  }
}
