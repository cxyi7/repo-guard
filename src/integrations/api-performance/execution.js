import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { executionError } from '../../core/error/repo-guard-error.js';

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarizeSamples(samples) {
  const durations = samples.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
  const failedSamples = samples.filter(({ failed }) => failed).length;
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);
  return Object.freeze({
    samples: samples.length,
    failedSamples,
    errorRate: samples.length === 0 ? 1 : failedSamples / samples.length,
    averageMs: samples.length === 0 ? 0 : totalDuration / samples.length,
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations.at(-1) ?? 0,
  });
}

async function invokeScenario(scenario, context) {
  const startedAt = performance.now();
  try {
    await scenario.run(context);
    return Object.freeze({ durationMs: performance.now() - startedAt, failed: false });
  } catch {
    return Object.freeze({ durationMs: performance.now() - startedAt, failed: true });
  }
}

async function warmUpScenario(scenario, context, iterations) {
  for (let index = 0; index < iterations; index += 1) {
    const sample = await invokeScenario(scenario, context);
    if (sample.failed) {
      throw executionError(
        'api-performance/warmup-failed',
        `场景“${scenario.name}”预热失败，未开始正式性能统计`,
        { details: { location: { path: scenario.modulePath } } },
      );
    }
  }
}

async function measureScenario(scenario, context, execution) {
  const samples = [];
  for (let offset = 0; offset < execution.iterations; offset += execution.concurrency) {
    const batchSize = Math.min(execution.concurrency, execution.iterations - offset);
    const batch = await Promise.all(Array.from(
      { length: batchSize },
      () => invokeScenario(scenario, context),
    ));
    samples.push(...batch);
  }
  return Object.freeze({
    ...scenario,
    statistics: summarizeSamples(samples),
  });
}

async function cleanupScenario(scenario, context) {
  if (!scenario.cleanup) return;
  try {
    await scenario.cleanup(context);
  } catch (error) {
    throw executionError(
      'api-performance/cleanup-failed',
      `场景“${scenario.name}”清理测试资源失败，已停止生成通过或违规报告`,
      { cause: error, details: { location: { path: scenario.modulePath } } },
    );
  }
}

export async function executeApiPerformanceScenarios(configuration, target) {
  const runId = randomUUID();
  let client;
  try {
    client = await configuration.client.createClient({
      baseURL: target.baseURL,
      runId,
    });
  } catch (error) {
    throw executionError(
      'api-performance/client-creation-failed',
      '无法创建项目接口性能测试客户端',
      { cause: error, details: { location: { path: configuration.client.module.relative } } },
    );
  }
  if ((typeof client !== 'object' && typeof client !== 'function') || client == null) {
    throw executionError(
      'api-performance/invalid-client',
      '项目接口性能测试客户端工厂必须返回 Axios 实例或兼容的请求客户端',
      { details: { location: { path: configuration.client.module.relative } } },
    );
  }

  const context = Object.freeze({ client, runId });
  const results = [];
  for (const scenario of configuration.scenarios) {
    try {
      await warmUpScenario(scenario, context, configuration.execution.warmupIterations);
      results.push(await measureScenario(scenario, context, configuration.execution));
    } finally {
      await cleanupScenario(scenario, context);
    }
  }
  return Object.freeze({
    runId,
    scenarios: Object.freeze(results),
    execution: configuration.execution,
  });
}

export function summarizeApiPerformanceExecution(execution) {
  const totalSamples = execution.scenarios.reduce(
    (total, scenario) => total + scenario.statistics.samples,
    0,
  );
  const failedSamples = execution.scenarios.reduce(
    (total, scenario) => total + scenario.statistics.failedSamples,
    0,
  );
  const weightedAverage = execution.scenarios.reduce(
    (total, scenario) => total + (
      scenario.statistics.averageMs * scenario.statistics.samples
    ),
    0,
  );
  const scenarioP95 = execution.scenarios.map(({ statistics }) => statistics.p95Ms);
  const scenarioP99 = execution.scenarios.map(({ statistics }) => statistics.p99Ms);
  return Object.freeze({
    scenarioCount: execution.scenarios.length,
    totalSamples,
    failedSamples,
    errorRate: totalSamples === 0 ? 1 : failedSamples / totalSamples,
    averageMs: totalSamples === 0 ? 0 : weightedAverage / totalSamples,
    worstScenarioP95Ms: Math.max(...scenarioP95, 0),
    worstScenarioP99Ms: Math.max(...scenarioP99, 0),
    maxMs: Math.max(...execution.scenarios.map(({ statistics }) => statistics.maxMs), 0),
  });
}
