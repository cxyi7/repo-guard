import { configurationError, executionError } from '../../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../../core/execution/streaming-process.js';
import { processOutputDiagnostics } from '../../../core/execution/process-output.js';
import { processExecutionToStatus } from '../../../core/result/exit-code.js';

export const JAVA_OUTPUT_LIMIT = 32 * 1024 * 1024;

export function javaToolKind(feature) {
  if (feature === 'javaFormat') return 'google-java-format';
  if (['javaLint', 'javaDuplication'].includes(feature)) return 'pmd';
  return 'checkstyle';
}

export function createJavaTool({ root, feature, config, signal, runProcess = runStreamingProcess }) {
  const startedAt = Date.now();
  const diagnostics = [];
  const source = javaToolKind(feature);
  async function execute(argumentsList, { captureSource = false } = {}) {
    const timeoutMs = config.timeoutMs - (Date.now() - startedAt);
    if (timeoutMs < 1) throw executionError('java/tool-timeout', 'Java 检查超过配置的执行时限');
    const execution = await runProcess({
      root, command: config.command, argumentsList: [...config.args, ...argumentsList],
      timeoutMs, signal, captureLimit: JAVA_OUTPUT_LIMIT,
    });
    diagnostics.push(...processOutputDiagnostics(
      captureSource ? { ...execution, stdout: '' } : execution,
      { source, root },
    ).map((item) => ({ ...item, message: `第三方原始诊断：${item.message}` })));
    if (processExecutionToStatus(execution, { failureStatus: 'violation' }) === 'execution-error') {
      throw executionError('java/tool-execution', 'Java 检查工具启动失败、超时、被取消或被信号终止', { cause: execution.error ?? undefined });
    }
    if (Buffer.byteLength(execution.stdout ?? '') >= JAVA_OUTPUT_LIMIT || Buffer.byteLength(execution.stderr ?? '') >= JAVA_OUTPUT_LIMIT) {
      throw executionError('java/tool-output-limit', 'Java 检查工具输出超过读取上限');
    }
    return execution;
  }
  async function inspectVersion() {
    if (!config.command) throw configurationError('java/tool-not-configured', '启用 Java 检查前必须显式配置消费项目已准备的工具');
    const result = await execute([source === 'checkstyle' ? '-V' : '--version']);
    if (processExecutionToStatus(result) !== 'passed') {
      throw configurationError('java/tool-version', 'Java 检查工具无法确认版本，请检查工具路径和运行 JDK');
    }
    const output = `${result.stdout}\n${result.stderr}`;
    const patterns = {
      'google-java-format': /google-java-format:\s*Version\s+(\d+\.\d+(?:\.\d+)?)/i,
      checkstyle: /Checkstyle version:\s*(\d+\.\d+(?:\.\d+)?)/i,
      pmd: /(?:^|\n)\s*PMD\s+(7\.\d+\.\d+)(?:\s|$)/,
    };
    const version = patterns[source].exec(output)?.[1];
    if (!version) throw configurationError('java/unsupported-tool', `未识别到支持的 ${source} 原生版本；PMD 仅支持 7.x`);
    return version;
  }
  return { execute, inspectVersion, diagnostics, startedAt };
}
