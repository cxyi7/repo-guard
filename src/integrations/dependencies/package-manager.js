import { runStreamingProcess } from "../../core/execution/streaming-process.js";
import spawn from "cross-spawn";
import {
  configurationError,
  executionError,
} from "../../core/error/repo-guard-error.js";

export async function readPackageManagerVersion(root, name) {
  const result = await runStreamingProcess(
    { command: name, argumentsList: ["--version"], root, timeoutMs: 15000 },
    { spawnProcess: spawn },
  );
  if (result.error || result.signal || result.status !== 0)
    throw executionError(
      "dependency-policy/package-manager-execution",
      `无法执行 ${name} --version，请确认项目包管理器可运行`,
      {
        details: {
          processCode: result.status,
          signal: result.signal,
          thirdPartyDiagnostic: result.stderr,
        },
        cause: result.error,
      },
    );
  const version = result.stdout.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw configurationError(
      "dependency-policy/package-manager-version",
      `${name} 未返回可识别的版本号`,
    );
  return version;
}

export function frozenInstallArguments(name, version) {
  if (name === "npm") return ["ci"];
  if (name === "pnpm") return ["install", "--frozen-lockfile"];
  if (name === "yarn")
    return [
      "install",
      Number(version.split(".")[0]) === 1 ? "--frozen-lockfile" : "--immutable",
    ];
  throw configurationError(
    "dependency-policy/package-manager",
    "包管理器必须为 npm、pnpm 或 yarn",
  );
}
