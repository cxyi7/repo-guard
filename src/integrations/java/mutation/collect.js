import path from 'node:path';
import { mutationBoundaryConfig, mutationEffectivePomPath } from '../../../config/java-mutation.js';
import { executionError, toRepoGuardError } from '../../../core/error/repo-guard-error.js';
import { inspectJavaEngineeringSetup } from '../engineering/collect.js';
import { javaFileStamp, javaOutputPaths, readFreshJavaFile, safeJavaPath } from '../engineering/files.js';
import { executeMaven } from '../engineering/process.js';
import { parseJUnitReport } from '../engineering/reports.js';
import { createPitClassMatcher } from './scope.js';
import { evaluatePitConfiguration } from './configuration.js';
import { parsePitEffectivePom, parsePitReport } from './reports.js';

export function inspectJavaMutationSetup(root, config, options) {
  return inspectJavaEngineeringSetup(root, mutationBoundaryConfig(config), options);
}
function baselineModule(root, module, freshness) {
  const reports = module.reports.map((file) => ({ path: file, ...parseJUnitReport(readFreshJavaFile(root, file, freshness.startedAt, freshness.before[file])) }));
  const cases = reports.flatMap((report) => report.cases);
  const identities = cases.map((entry) => `${entry.classname}\0${entry.name}`);
  if (new Set(identities).size !== identities.length) throw executionError('java/pit-duplicate-baseline', `模块 ${module.name} 的基线报告重复计数同一测试用例`);
  const matches = createPitClassMatcher(module.targetTests);
  return { ...module, reports, cases, executed: cases.filter((entry) => !entry.skipped).length, failed: cases.filter((entry) => entry.failed).length, targetTestsExecuted: cases.filter((entry) => !entry.skipped && matches(entry.classname)).length };
}
function assertExecution(execution, { baselineModules } = {}) {
  if (execution.status === 0 && !execution.timedOut && !execution.signal && !execution.error) return;
  if (execution.status === 1 && baselineModules?.some((module) => module.failed) && !execution.timedOut && !execution.signal && !execution.error) return;
  throw executionError('java/pit-process-failed', 'Java 变异检查的 Maven 执行失败，未取得可识别的完整检查证据', { details: { processExitCode: execution.status } });
}
function pitArguments(root, module) {
  return [
    '--non-recursive', '-DskipTests=false', '-Dmaven.test.skip=false',
    '-DskipPitest=false', '-Dpit.dryRun=false', '-DwithHistory=false',
    '-DcrossModule=false', '-DfullMutationMatrix=false', '-DtimestampedReports=false',
    '-DfailWhenNoMutations=true', '-DoutputFormats=XML', '-Dpit.outputEncoding=UTF-8',
    '-DmutationThreshold=0', '-DcoverageThreshold=0', '-DtestStrengthThreshold=0', '-DmaxSurviving=-1',
    `-DtargetClasses=${module.targetClasses.join(',')}`, `-DtargetTests=${module.targetTests.join(',')}`,
    `-DreportsDirectory=${safeJavaPath(root, path.posix.dirname(module.mutationReport), { required: false })}`,
  ];
}

export async function collectJavaMutationFacts({ root, config, signal, execute = executeMaven }) {
  inspectJavaMutationSetup(root, config, { verifyTools: execute === executeMaven });
  const paths = javaOutputPaths(mutationBoundaryConfig(config));
  const freshness = { before: Object.fromEntries(paths.map((file) => [file, javaFileStamp(root, file)])), startedAt: Date.now() };
  const executions = [];
  const run = async (input) => {
    const remaining = config.timeoutMs - (Date.now() - freshness.startedAt);
    if (remaining <= 0 || signal?.aborted) throw executionError('java/pit-cancelled', 'Java 变异检查已超时或取消');
    const execution = await execute({ root, signal, ...input, config: { ...input.config, timeoutMs: remaining } });
    executions.push(execution);
    if (signal?.aborted || Date.now() - freshness.startedAt >= config.timeoutMs) throw executionError('java/pit-cancelled', 'Java 变异检查已超时或取消');
    return execution;
  };
  try {
    const baselineExecution = await run({ config, goals: ['clean', 'test'], additional: ['-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false', '-DfailIfNoTests=true', '-DskipPitest=true'] });
    const modules = config.modules.map((module) => baselineModule(root, module, freshness));
    assertExecution(baselineExecution, { baselineModules: modules });
    if (modules.some((module) => !module.executed || module.failed || !module.targetTestsExecuted)) return { modules, executions, baselineFailed: true };
    const results = [];
    for (const module of modules) {
      const moduleConfig = { ...config, pom: module.directory === '.' ? config.pom : path.posix.join(module.directory, 'pom.xml') };
      const effectivePom = mutationEffectivePomPath(module);
      assertExecution(await run({ config: moduleConfig, goals: ['help:effective-pom'], additional: ['--non-recursive', `-Doutput=${safeJavaPath(root, effectivePom, { required: false })}`] }));
      const effective = parsePitEffectivePom(readFreshJavaFile(root, effectivePom, freshness.startedAt, freshness.before[effectivePom]));
      evaluatePitConfiguration(effective, config, module, root);
      const previous = javaFileStamp(root, module.mutationReport);
      const startedAt = Date.now();
      const execution = await run({ config: moduleConfig, goals: [`org.pitest:pitest-maven:${config.pluginVersion}:mutationCoverage`], additional: pitArguments(root, module) });
      assertExecution(execution);
      const result = parsePitReport(readFreshJavaFile(root, module.mutationReport, startedAt, previous));
      results.push({ ...module, ...result, effectivePom });
    }
    return { modules: results, executions, baselineFailed: false };
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'java/pit-collection-failed', message: 'Java 变异测试证据采集失败' });
    error.javaExecutions = [...executions, ...(cause.javaExecutions ?? [])];
    throw toRepoGuardError(error);
  }
}
