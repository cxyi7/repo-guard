import fs from 'node:fs';
import path from 'node:path';
import { configurationError, executionError, toRepoGuardError } from '../../../core/error/repo-guard-error.js';
import { inspectJavaEngineeringSetup } from '../engineering/collect.js';
import { javaFileStamp, javaOutputPaths, readFreshJavaFile, safeJavaPath } from '../engineering/files.js';
import { executeMaven } from '../engineering/process.js';
import { inspectSpotbugsEffectivePom } from './pom.js';
import { parseSpotbugsReport } from './reports.js';

function withEvidencePaths(config) {
  return {
    ...config,
    modules: config.modules.map((module) => ({
      ...module,
      effectivePom: path.posix.join(module.directory, 'target/repo-guard-spotbugs-effective-pom.xml'),
    })),
  };
}
export function inspectSpotbugsSetup(root, config, options) {
  return inspectJavaEngineeringSetup(root, withEvidencePaths(config), options);
}
function freshClasses(root, directory, startedAt) {
  const classes = [];
  const pending = [directory];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    const absolute = safeJavaPath(root, current);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (++entries > 100000) throw executionError('java/spotbugs-input-limit', 'SpotBugs 编译目录超过文件数量上限');
      const relative = path.posix.join(current, entry.name);
      safeJavaPath(root, relative);
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.name.endsWith('.class')) {
        const content = readFreshJavaFile(root, relative, startedAt, null, { headerOnly: true });
        if (content.toString('hex') !== 'cafebabe') throw executionError('java/spotbugs-invalid-class', `SpotBugs 输入不是有效 Java 字节码：${relative}`);
        const classname = path.posix.relative(directory, relative).slice(0, -6).replaceAll('/', '.');
        if (!['module-info', 'package-info'].includes(classname.split('.').at(-1))) classes.push(classname);
      }
    }
  }
  if (!classes.length) throw executionError('java/spotbugs-empty-input', 'SpotBugs 没有本次编译生成的生产类，不能通过');
  return classes;
}
function verifyReportCoverage(report, classes, startedAt, moduleName) {
  if (report.analysisTimestamp < startedAt || report.analysisTimestamp > Date.now()) {
    throw executionError('java/spotbugs-stale-analysis', `模块 ${moduleName} 的 SpotBugs 分析时间不属于本次运行`);
  }
  const analyzed = new Set(report.classes);
  const compiled = new Set(classes);
  if (classes.some((name) => !analyzed.has(name)) || report.classes.some((name) => !compiled.has(name))) {
    throw executionError('java/spotbugs-incomplete-analysis', `模块 ${moduleName} 的 SpotBugs 类统计与本次生产字节码不一致`);
  }
}
export async function collectSpotbugsFacts({ root, config, signal, execute = executeMaven }) {
  const startedAt = Date.now();
  const prepared = withEvidencePaths(config);
  inspectJavaEngineeringSetup(root, prepared, { verifyTools: execute === executeMaven });
  const before = Object.fromEntries(javaOutputPaths(prepared).map((file) => [file, javaFileStamp(root, file)]));
  const executions = [];
  const run = async (input) => {
    const remaining = config.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0 || signal?.aborted) throw executionError('java/spotbugs-timeout', 'SpotBugs 检查达到总超时或已被取消');
    const execution = await execute({ root, signal, ...input, config: { ...(input.config ?? config), timeoutMs: remaining } });
    executions.push(execution);
    if (signal?.aborted || Date.now() - startedAt >= config.timeoutMs) {
      throw executionError('java/spotbugs-timeout', 'SpotBugs 检查达到总超时或已被取消，不能接受执行结果');
    }
    if (execution.status !== 0 || execution.error || execution.signal || execution.timedOut) {
      throw executionError('java/spotbugs-process-failed', 'SpotBugs Maven 执行未成功完成，原始退出码仅作为诊断，不作为检查通过证据', {
        details: { processExitCode: execution.status },
      });
    }
  };
  try {
    await run({ goals: ['clean'] });
    const modules = [];
    for (const module of prepared.modules) {
      await run({
        config: { ...config, pom: module.directory === '.' ? config.pom : path.posix.join(module.directory, 'pom.xml') },
        goals: ['help:effective-pom'],
        additional: [`-Doutput=${safeJavaPath(root, module.effectivePom, { required: false })}`],
      });
      const content = readFreshJavaFile(root, module.effectivePom, startedAt, before[module.effectivePom]);
      modules.push({ ...module, ...inspectSpotbugsEffectivePom(content, { root, module, config }) });
    }
    const canonical = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (new Set(modules.map((module) => canonical(module.classesDirectory))).size !== modules.length
      || new Set(modules.map((module) => canonical(module.sourceDirectory))).size !== modules.length) {
      throw configurationError('java/spotbugs-duplicate-input', '不同 SpotBugs 模块不能复用相同的生产字节码或源码目录');
    }
    await run({
      goals: ['compile', `com.github.spotbugs:spotbugs-maven-plugin:${config.pluginVersion}:spotbugs`],
      additional: [
        '-Dmaven.main.skip=false', '-Dspotbugs.skip=false', '-Dspotbugs.noClassOk=false',
        '-Dspotbugs.skipEmptyReport=false', '-Dspotbugs.failOnError=true', '-Dspotbugs.xmlOutput=true',
        '-Dspotbugs.includeTests=false', '-Dspotbugs.effort=Max', '-Dspotbugs.threshold=Low', '-Dspotbugs.relaxed=false',
      ],
    });
    return {
      executions,
      modules: modules.map((module) => {
        const classes = freshClasses(root, module.classesDirectory, startedAt);
        const report = parseSpotbugsReport(readFreshJavaFile(root, module.reports[0], startedAt, before[module.reports[0]]));
        verifyReportCoverage(report, classes, startedAt, module.name);
        return { ...module, report };
      }),
    };
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'java/spotbugs-collection-failed', message: 'SpotBugs 原生检查证据采集失败' });
    error.javaExecutions = [...executions, ...(cause.javaExecutions ?? [])];
    throw toRepoGuardError(error);
  }
}
