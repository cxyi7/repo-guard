import path from "node:path";
import { configurationError } from "../../core/error/repo-guard-error.js";
import {
  artifactPropertyName,
  tokenContexts,
  tokenValueKey,
} from "../../policies/ui-token-values.js";

/** 在执行前核对指定值与清单的身份和文件关联，避免静默跳过无效约定。 */
export function validateTokenValueSetup(config, manifest) {
  if (!config.values?.enabled) return;
  const seen = new Set();
  const outputValues = new Map();
  if (!config.values.definitions.length)
    throw configurationError(
      "ui-token/empty-values",
      "指定值检查要求提供 definitions。",
    );
  for (const entry of config.values.definitions) {
    const token = manifest.tokens.find((token) => token.id === entry.token);
    const aliases = [
      ...(token?.aliases[entry.language] ?? []),
      ...(entry.language === "css" ? [] : (token?.aliases.css ?? [])),
    ];
    const extension = path.extname(entry.source).toLowerCase();
    const fileLanguage = {
      ".css": "css",
      ".scss": "sass",
      ".sass": "sass",
      ".less": "less",
    }[extension];
    if (
      !manifest.sources.some((source) => source.path === entry.source) ||
      !aliases.includes(entry.alias) ||
      !config.languages.includes(entry.language) ||
      ![".css", ".scss", ".sass", ".less", ".vue"].includes(extension) ||
      (fileLanguage && fileLanguage !== entry.language) ||
      !/^(?:var\(--[\w-]+\)|\$[\w-]+|@[\w-]+)$/.test(entry.alias)
    ) {
      throw configurationError(
        "ui-token/invalid-value-binding",
        `指定值 ${entry.token} 必须关联清单中的来源文件、已开启的样式语言及可直接定义的变量别名。`,
      );
    }
    try {
      tokenValueKey(entry.value);
      for (const context of tokenContexts(entry)) {
        const key = JSON.stringify([
          entry.source,
          entry.language,
          entry.alias,
          context,
        ]);
        if (seen.has(key)) throw configurationError('ui-token/duplicate-value', '同一位置重复配置指定值');
        seen.add(key);
      }
      for (const output of entry.outputs ?? []) {
        for (const context of tokenContexts(output)) {
          const key = JSON.stringify([artifactPropertyName(output.property), context]);
          const value = tokenValueKey(output.value ?? entry.value);
          if (outputValues.has(key) && outputValues.get(key) !== value)
            throw configurationError('ui-token/conflicting-output-value', '同一输出位置配置了不同指定值');
          outputValues.set(key, value);
        }
      }
    } catch (cause) {
      throw configurationError(
        "ui-token/invalid-value-contract",
        `指定值 ${entry.token} 的值、选择器或输出映射无效：${cause.message}`,
        { cause },
      );
    }
  }
}
