import spawn from "cross-spawn";
import { projectPackageManager } from "../../core/project/package-manager.js";
import { runStreamingProcess } from "../../core/execution/streaming-process.js";

export async function runProjectScript({
  root,
  script,
  timeoutMs,
  extraArguments = [],
  env = process.env,
  signal = null,
  output = null,
}) {
  const manager = projectPackageManager(root);
  const invocation = {
    command: manager,
    argumentsList: [
      "run",
      script,
      ...(manager === "npm" && extraArguments.length ? ["--"] : []),
      ...extraArguments,
    ],
  };
  const execution = await runStreamingProcess(
    {
      command: invocation.command,
      argumentsList: invocation.argumentsList,
      root,
      timeoutMs,
      env,
      signal,
      output,
    },
    { spawnProcess: spawn },
  );
  return Object.freeze({
    command: invocation.command,
    argumentsList: Object.freeze(invocation.argumentsList),
    status: execution.status,
    signal: execution.signal,
    error: execution.error ?? null,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
    timedOut: execution.timedOut,
  });
}
