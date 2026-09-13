import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import { configurationError } from "../../core/error/repo-guard-error.js";
import { resolveBuildArtifactOutput } from "../build-artifacts/project.js";
import { loadProjectStylelint } from "../stylelint/project.js";
import { collectStyleFacts } from "./styles.js";

/** 只读取本轮构建目录中的 CSS，不读取 sourcemap、远程样式或 JS 动态样式。 */
export async function collectTokenArtifactFacts(
  root,
  buildConfig,
  stylelintConfig,
) {
  const { outputDirectory } = resolveBuildArtifactOutput(
    root,
    buildConfig.artifactBudget,
  );
  if (!existsSync(outputDirectory))
    throw configurationError(
      "ui-token/missing-artifacts",
      "构建后未找到 UI Token CSS 产物目录。",
    );
  const files = [];
  const pending = [outputDirectory];
  let visited = 0;
  let bytes = 0;
  while (pending.length) {
    for (const entry of readdirSync(pending.pop(), { withFileTypes: true })) {
      visited += 1;
      if (visited > 100000)
        throw configurationError(
          "ui-token/artifact-limit",
          "UI Token 产物扫描超过 100000 个目录或文件。",
        );
      const target = path.join(entry.parentPath, entry.name);
      if (entry.isSymbolicLink())
        throw configurationError(
          "ui-token/artifact-symlink",
          "UI Token 产物目录不允许符号链接。",
        );
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      const relative = path
        .relative(outputDirectory, target)
        .replaceAll("\\", "/");
      if (
        !relative.endsWith(".css") ||
        !micromatch.isMatch(
          relative,
          stylelintConfig.uiTokens.artifacts.patterns,
          { dot: true },
        )
      )
        continue;
      const stat = lstatSync(target);
      bytes += stat.size;
      if (
        !stat.isFile() ||
        stat.size > 10 * 1024 * 1024 ||
        bytes > 100 * 1024 * 1024
      )
        throw configurationError(
          "ui-token/artifact-limit",
          "UI Token CSS 产物必须是普通文件，单文件不超过 10 MiB，总计不超过 100 MiB。",
        );
      files.push(target);
    }
  }
  if (!files.length)
    throw configurationError(
      "ui-token/missing-css-artifacts",
      "本轮构建没有匹配 artifacts.patterns 的 CSS；请检查输出目录和匹配范围。",
    );
  const project = await loadProjectStylelint(root);
  const facts = await collectStyleFacts({
    project,
    root,
    files,
    languages: ["css"],
    options: { rules: {} },
    plainCss: true,
  });
  return { files, facts };
}
