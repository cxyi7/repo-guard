import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  configurationError,
  executionError,
  toRepoGuardError,
} from "../../../core/error/repo-guard-error.js";
import { runStreamingProcess } from "../../../core/execution/streaming-process.js";
import { safeJavaPath } from "./files.js";
import { inspectMavenImplicitConfiguration, mavenProcessEnvironment } from "./implicit-configuration.js";

function resolveExecutable(root, value) {
  let executable = value;
  if (/[\\/]/.test(executable) && !path.isAbsolute(executable))
    executable = safeJavaPath(root, executable);
  const extensions =
    process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(executable)
      ? [".exe", ".cmd", ".bat", ""]
      : [""];
  const candidates = path.isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .flatMap((directory) =>
          extensions.map((suffix) => path.join(directory, executable + suffix)),
        );
  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  if (!resolved)
    throw executionError(
      "java/tool-not-found",
      `找不到 Java 工程所需工具：${value}，请先准备项目工具链`,
    );
  return resolved;
}
export function inspectMavenTools(root, config) {
  const executable = resolveExecutable(root, config.executable);
  const java = resolveExecutable(
    root,
    process.env.JAVA_HOME
      ? path.join(
          process.env.JAVA_HOME,
          "bin",
          process.platform === "win32" ? "java.exe" : "java",
        )
      : "java",
  );
  return { executable, java };
}
export function mavenInvocation(root, config, goals, additional = []) {
  safeJavaPath(root, config.pom);
  const args = [
    "-B",
    "-ntp",
    ...(config.offline ? ["-o"] : []),
    "-f",
    config.pom,
    ...config.arguments,
    ...goals,
    ...additional,
  ];
  const resolved = resolveExecutable(root, config.executable);
  if (process.platform !== "win32")
    return { command: resolved, argumentsList: args };
  if (!/\.(cmd|bat)$/i.test(resolved))
    return { command: resolved, argumentsList: args };
  if ([resolved, ...args].some((item) => /["%\r\n&|<>^!]/.test(item)))
    throw configurationError(
      "java/unsafe-windows-argument",
      "当前 Windows 平台的 Maven 参数包含不支持的命令字符",
    );
  const commandLine = [resolved, ...args].map((item) => `"${item}"`).join(" ");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    argumentsList: ["/d", "/s", "/c", `"${commandLine}"`],
  };
}

export async function executeMaven({
  root,
  config,
  goals,
  additional = [],
  signal,
  runProcess = runStreamingProcess,
}) {
  inspectMavenImplicitConfiguration(root, config);
  const invocation = mavenInvocation(root, config, goals, additional);
  const execution = await runProcess(
    {
      ...invocation,
      root,
      env: mavenProcessEnvironment(),
      timeoutMs: config.timeoutMs,
      signal,
      captureLimit: 4 * 1024 * 1024,
    },
    {
      spawnProcess: (command, args, options) =>
        spawn(command, args, {
          ...options,
          windowsVerbatimArguments:
            process.platform === "win32" &&
            /(?:^|[\\/])cmd\.exe$/i.test(command),
        }),
    },
  );
  if (
    execution.error ||
    execution.timedOut ||
    execution.signal ||
    !Number.isInteger(execution.status)
  ) {
    const error = executionError(
      "java/process-unavailable",
      "Java 工具启动失败、超时或被信号终止",
      { cause: execution.error ?? undefined },
    );
    error.javaExecutions = [execution];
    throw toRepoGuardError(error);
  }
  return { ...execution, goals };
}
