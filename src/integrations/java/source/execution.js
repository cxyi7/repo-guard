import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError, executionError } from '../../../core/error/repo-guard-error.js';
import { processExecutionToStatus } from '../../../core/result/exit-code.js';
import { readJavaXmlReport, invalidJavaReport } from './xml.js';
import { parseJavaCheckstyleReport } from './checkstyle.js';
import { parseJavaPmdReport, parseJavaCpdReport } from './pmd.js';

function ensureExpectedExit(execution, findings, tool) {
  let expected;
  if (tool === 'checkstyle') expected = process.platform === 'win32' ? findings.length : findings.length % 256;
  else expected = findings.length ? 4 : 0;
  if (execution.status !== expected) {
    throw executionError('java/native-status-mismatch', 'Java 原生进程退出状态与检查报告不一致', {
      details: { processExitCode: execution.status, evidence: [{ type: 'process-status', message: `第三方原始退出码为 ${execution.status}，与报告中 ${findings.length} 项违规不一致` }] },
    });
  }
}

/** 为 Windows 命令行转义预留空间，每批限制参数字符和文件数量。 */
function checkstyleBatches(inputs, config, fixedArguments) {
  const argumentSize = (value) => String(value).length * 2 + 3;
  const baseSize = [config.command, ...config.args, ...fixedArguments].reduce((sum, value) => sum + argumentSize(value), 0);
  const batches = [];
  let batch = [];
  let size = baseSize;
  for (const input of inputs) {
    const addition = argumentSize(input.absolute);
    if (baseSize + addition > 24000) {
      throw configurationError('java/checkstyle-command-length', 'Checkstyle 工具前缀或单个源码路径过长，请缩短工具类路径或项目路径');
    }
    if (batch.length === 32 || size + addition > 24000) {
      batches.push(batch);
      batch = [];
      size = baseSize;
    }
    batch.push(input);
    size += addition;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function executeJavaCheckstyle({ tool, root, config, inputs, scratch, version, rules, configuration }) {
  const configFile = path.join(scratch, 'checkstyle.xml');
  writeFileSync(configFile, configuration);
  const batches = checkstyleBatches(inputs, config, ['-c', configFile, '-f', 'xml', '-o', path.join(scratch, 'checkstyle-report-999999.xml')]);
  const findings = [];
  let processExitCode;
  for (const [index, batch] of batches.entries()) {
    const report = path.join(scratch, `checkstyle-report-${index}.xml`);
    const execution = await tool.execute(['-c', configFile, '-f', 'xml', '-o', report, ...batch.map(({ absolute }) => absolute)]);
    const current = parseJavaCheckstyleReport(readJavaXmlReport(report), {
      root, inputs: batch, version, ruleNames: [...rules.checker, ...rules.treeWalker].map(({ name }) => name),
    });
    ensureExpectedExit(execution, current, 'checkstyle');
    findings.push(...current);
    if (batches.length === 1) processExitCode = execution.status;
  }
  return { findings, processExitCode, batches: batches.length };
}

export async function executeJavaPmd({ tool, root, config, inputs, scratch, version, configuration, ruleNames, duplication }) {
  if (duplication) {
    for (const input of inputs) {
      // CPD 的 XML 不报告抑制区间，因此严格入口拒绝这些标记；同时识别 Java Unicode 转义。
      const decoded = input.content.replace(/\\u+([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
      if (/CPD-(?:OFF|ON|START|END)/.test(decoded)) {
        throw configurationError('java/cpd-suppression', `Java 重复代码检查范围含有 CPD 抑制标记：${input.relative}；请移除标记后重新检查`);
      }
    }
  }
  const list = path.join(scratch, 'files.txt');
  const report = path.join(scratch, 'pmd-report.xml');
  writeFileSync(list, `${inputs.map(({ absolute }) => absolute).join('\n')}\n`);
  const args = duplication
    ? ['cpd', '--minimum-tokens', String(config.minimumTokens)]
    : ['check', '--rulesets', path.join(scratch, 'pmd-rules.xml'), '--no-cache', '--show-suppressed'];
  if (!duplication) writeFileSync(path.join(scratch, 'pmd-rules.xml'), configuration);
  const execution = await tool.execute([
    ...args, '--file-list', list, '--format', 'xml',
    ...(duplication ? [] : ['--report-file', report, '--no-progress']),
  ], { captureSource: duplication });
  if (![0, 4].includes(execution.status)) {
    throw executionError('java/pmd-execution', 'PMD 执行失败或未完整分析源码', { details: { processExitCode: execution.status } });
  }
  if (duplication) writeFileSync(report, execution.stdout, 'utf8');
  const document = readJavaXmlReport(report);
  const findings = duplication
    ? parseJavaCpdReport(document, { root, inputs, version, minimumTokens: config.minimumTokens })
    : parseJavaPmdReport(document, { root, inputs, version, ruleNames });
  ensureExpectedExit(execution, findings, 'pmd');
  return { findings, processExitCode: execution.status };
}

/** google-java-format 返回完整源码；比较内容而非把任意命令成功视为格式通过。 */
function normalizeJavaText(content) {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n*$/, '\n');
}

export async function executeJavaFormat({ tool, config, inputs, fix, scratch }) {
  const findings = [];
  let fixedFiles = 0;
  for (const [index, input] of inputs.entries()) {
    const temporary = path.join(scratch, 'format-input', String(index), path.basename(input.absolute));
    mkdirSync(path.dirname(temporary), { recursive: true });
    writeFileSync(temporary, normalizeJavaText(input.content));
    const prefix = config.style === 'aosp' ? ['--aosp'] : [];
    const args = [...prefix, temporary];
    const execution = await tool.execute(args, { captureSource: true });
    if (processExecutionToStatus(execution) !== 'passed') {
      throw executionError('java/formatter-execution', 'google-java-format 未完成源码解析与格式化');
    }
    const formatted = normalizeJavaText(execution.stdout);
    if (!formatted.trim() && input.content.trim()) throw invalidJavaReport('格式化工具没有返回完整源码');
    if (formatted === input.content) continue;
    if (!fix) {
      findings.push({ relative: input.relative, rule: 'format', line: 1 });
      continue;
    }
    if (readFileSync(input.absolute, 'utf8') !== input.content) {
      throw executionError('java/source-changed', 'Java 源码在格式化期间发生变化，已停止写回');
    }
    writeFileSync(input.absolute, formatted, 'utf8');
    const verified = await tool.execute([...prefix, input.absolute], { captureSource: true });
    if (processExecutionToStatus(verified) !== 'passed' || normalizeJavaText(verified.stdout) !== formatted) {
      throw executionError('java/formatter-verification', 'Java 格式化写回后未通过只读复核');
    }
    fixedFiles += 1;
  }
  return { findings, fixedFiles };
}
