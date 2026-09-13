import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { configurationError } from "../error/repo-guard-error.js";

/** 脚本执行遵循项目原生声明；未声明的普通 Node 项目使用 npm。 */
export function projectPackageManager(root) {
  let current = path.resolve(root);
  while (true) {
    const file = path.join(current, "package.json");
    if (existsSync(file)) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(file, "utf8"));
      } catch (cause) {
        throw configurationError(
          "package-manager/manifest",
          "无法读取项目包管理器声明",
          { cause },
        );
      }
      if (manifest.packageManager) {
        const match = /^(npm|pnpm|yarn)@/.exec(manifest.packageManager);
        if (!match)
          throw configurationError(
            "package-manager/name",
            "项目 packageManager 必须声明 npm、pnpm 或 yarn",
          );
        return match[1];
      }
    }
    const parent = path.dirname(current);
    if (parent === current || existsSync(path.join(current, ".git")))
      return "npm";
    current = parent;
  }
}
