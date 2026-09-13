import { loadProjectPrettier } from "../integrations/prettier/project.js";
import micromatch from "micromatch";
import { configurationError } from "../core/error/repo-guard-error.js";
import { inspectFrontendToolConfiguration } from "./quality/tool-configuration.js";

// 保持 IPC 存活，交由父进程在收到结果后统一清理整个进程树。
process.on("message", async ({ root, config, files }) => {
  try {
    let checked = 0;
    for (const tool of ["eslint", "prettier", "stylelint", "typeCheck"]) {
      if (!config.checks[tool]?.enabled) continue;
      const pattern =
        tool === "stylelint"
          ? /\.(?:css|scss|sass|less|vue)$/i
          : /\.(?:js|jsx|ts|tsx|mts|cts|vue|mjs|cjs|json|css|md)$/i;
      const targets =
        tool === "typeCheck"
          ? [undefined]
          : files.filter(
              (item) =>
                (tool === "prettier" || pattern.test(item)) &&
                micromatch.isMatch(item, config.checks[tool].pattern, {
                  basename: true,
                }),
            );
      if (!targets.length)
        throw configurationError(
          "dependency-policy/no-config-target",
          `${tool} 没有可用于加载配置的实际目标文件，无法确认配置就绪`,
        );
      let applicable = 0;
      for (const file of targets) {
        const result = await inspectFrontendToolConfiguration({
          root,
          config,
          tool,
          file,
        });
        if (tool === "prettier") {
          const { prettier } = await loadProjectPrettier(root);
          await prettier.getSupportInfo({
            plugins: result.effective.plugins ?? [],
          });
        }
        if (!result.effective?.ignored) {
          checked += 1;
          applicable += 1;
        }
      }
      if (!applicable)
        throw configurationError(
          "dependency-policy/ignored-config-target",
          `${tool} 的目标文件全部被忽略，无法确认配置覆盖`,
        );
    }
    process.send({ ok: true, checked });
  } catch (error) {
    process.send({ ok: false, message: error.message });
  }
});
