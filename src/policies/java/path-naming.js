import { executionError } from "../../core/error/repo-guard-error.js";

const conventions = Object.freeze({
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  lowercase: /^[a-z][a-z0-9]*$/,
  "kebab-case": /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  snake_case: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
});

// 使用动态规划匹配简单通配符，用户配置不会转换为正则表达式。
function segmentMatches(value, pattern) {
  const tokens = [...pattern];
  let previous = [true, ...tokens.map(() => false)];
  for (let index = 1; index <= tokens.length; index += 1)
    previous[index] = previous[index - 1] && tokens[index - 1] === "*";
  for (const character of value) {
    const current = [false];
    for (let index = 1; index <= tokens.length; index += 1) {
      const token = tokens[index - 1];
      current[index] =
        token === "*"
          ? current[index - 1] || previous[index]
          : previous[index - 1] && (token === "?" || token === character);
    }
    previous = current;
  }
  return previous[tokens.length];
}
function pathMatches(value, pattern) {
  const tokens = pattern.split("/");
  let previous = [true, ...tokens.map(() => false)];
  for (let index = 1; index <= tokens.length; index += 1)
    previous[index] = previous[index - 1] && tokens[index - 1] === "**";
  for (const segment of value.split("/")) {
    const current = [false];
    for (let index = 1; index <= tokens.length; index += 1) {
      const token = tokens[index - 1];
      current[index] =
        token === "**"
          ? current[index - 1] || previous[index]
          : previous[index - 1] && segmentMatches(segment, token);
    }
    previous = current;
  }
  return previous[tokens.length];
}
function inScope(value, config) {
  return (
    config.include.some((pattern) => pathMatches(value, pattern)) &&
    !config.exclude.some((pattern) => pathMatches(value, pattern))
  );
}
function candidates(paths) {
  if (!Array.isArray(paths))
    throw executionError(
      "java/path-naming-invalid-path",
      "Java 路径命名检查必须接收 Git 路径数组",
    );
  const files = [...new Set(paths)];
  if (
    files.some(
      (file) =>
        typeof file !== "string" ||
        !file ||
        file.includes("\\") ||
        /^[A-Za-z]:|^\//.test(file) ||
        file
          .split("/")
          .some((segment) => !segment || segment === "." || segment === ".."),
    )
  ) {
    throw executionError(
      "java/path-naming-invalid-path",
      "Java 路径命名检查必须接收 Git 提供的应用内相对路径",
    );
  }
  const directories = files.flatMap((file) => {
    const segments = file.split("/");
    return segments
      .slice(0, -1)
      .map((_, index) => segments.slice(0, index + 1).join("/"));
  });
  return { files: files.sort(), directories: [...new Set(directories)].sort() };
}
function violation(rule, file, constraint, expected) {
  return {
    ruleId: `java/path-naming/${rule.id}`,
    code: `java/path-naming/${rule.id}/${constraint}`,
    severity: "error",
    message: `Java ${rule.target === "files" ? "文件" : "目录"}名称未满足规则 ${rule.id}：${expected}`,
    location: { path: file },
    expected,
  };
}
function checkName(file, rule) {
  const basename = file.split("/").at(-1);
  const extension = rule.target === "files" ? basename.lastIndexOf(".") : -1;
  const stem = extension > 0 ? basename.slice(0, extension) : basename;
  return [
    ...rule.conventions
      .filter((name) => !conventions[name].test(stem))
      .map((name) =>
        violation(rule, file, name, `名称应符合 ${name} 命名约定`),
      ),
    ...(rule.basename.length &&
    !rule.basename.some((pattern) => segmentMatches(basename, pattern))
      ? [
          violation(
            rule,
            file,
            "basename",
            `完整名称应匹配 ${rule.basename.join(" 或 ")}`,
          ),
        ]
      : []),
  ];
}

/** 对 Git 路径和其父目录应用全部匹配规则，不读取源码或进行重命名。 */
export function evaluateJavaPathNaming(paths, config) {
  const entries = candidates(paths);
  return config.rules.flatMap((rule) =>
    entries[rule.target]
      .filter((file) => inScope(file, config) && inScope(file, rule))
      .flatMap((file) => checkName(file, rule)),
  );
}
