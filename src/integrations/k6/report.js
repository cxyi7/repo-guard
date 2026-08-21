import { executionError } from '../../core/error/repo-guard-error.js';

function reportError(code, message) {
  return executionError(`k6-load/${code}`, message, {
    expected: 'k6 机器摘要必须包含可验证的 HTTP、检查、VU 和迭代指标。',
    remediation: {
      goal: '修正 k6 脚本或升级受支持的 k6 版本后重新手动运行。',
      steps: ['确认场景发出有效 HTTP 请求、执行 check，并生成机器可读摘要。'],
      constraints: ['不得通过伪造摘要、删除失败检查或省略指标绕过阈值。'],
      verification: ['重新运行 npm run guard:k6，并确认中文报告包含完整指标。'],
    },
  });
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reportError('invalid-summary-object', `${label} 必须是对象`);
  }
  return value;
}

function finite(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < minimum || value > maximum) {
    throw reportError('invalid-summary-metric', `${label} 必须是有效数值`);
  }
  return value;
}

function metricMap(summary) {
  if (Array.isArray(summary?.results?.metrics)) {
    const metrics = [
      ...summary.results.metrics,
      ...(Array.isArray(summary.results.checks?.metrics) ? summary.results.checks.metrics : []),
    ];
    return Object.freeze({
      format: 'machine-readable-v1',
      metrics: new Map(metrics.map((metric) => [metric.name, metric])),
      durationSeconds: typeof summary.config?.duration === 'number' ? summary.config.duration : null,
      checkResults: Array.isArray(summary.results.checks?.results)
        ? summary.results.checks.results
        : [],
    });
  }
  if (summary?.metrics && typeof summary.metrics === 'object' && !Array.isArray(summary.metrics)) {
    return Object.freeze({
      format: 'legacy',
      metrics: new Map(Object.entries(summary.metrics).map(([name, metric]) => [name, {
        name,
        ...metric,
      }])),
      durationSeconds: typeof summary.state?.testRunDurationMs === 'number'
        ? summary.state.testRunDurationMs / 1000
        : null,
      checkResults: [],
    });
  }
  throw reportError('unsupported-summary-format', '不支持当前 k6 机器摘要格式');
}

function valuesOf(metrics, name, { required = true } = {}) {
  const metric = metrics.get(name);
  if (!metric) {
    if (!required) return null;
    throw reportError('missing-summary-metric', `k6 机器摘要缺少 ${name} 指标`);
  }
  return assertObject(metric.values, `k6 指标 ${name}.values`);
}

function scenarioMetricName(name, scenarioName) {
  return scenarioName == null ? name : `${name}{scenario:${scenarioName}}`;
}

function trend(metrics, name) {
  const values = valuesOf(metrics, name);
  return Object.freeze({
    averageMs: finite(values.avg, `${name}.avg`),
    minimumMs: finite(values.min, `${name}.min`),
    medianMs: finite(values.med, `${name}.med`),
    maximumMs: finite(values.max, `${name}.max`),
    p90Ms: finite(values['p(90)'], `${name}.p(90)`),
    p95Ms: finite(values['p(95)'], `${name}.p(95)`),
    p99Ms: finite(values['p(99)'], `${name}.p(99)`),
  });
}

function checkValues(values, name) {
  const rate = finite(values.rate, `${name}.rate`, { maximum: 1 });
  const total = finite(
    values.total ?? ((values.passes ?? 0) + (values.fails ?? 0)),
    `${name}.total`,
  );
  return Object.freeze({
    rate,
    total,
    passed: finite(values.matches ?? values.passes ?? rate * total, `${name}.passed`),
  });
}

function checkRate(summaryFacts, scenarioName) {
  const succeededName = scenarioMetricName('checks_succeeded', scenarioName);
  const succeeded = valuesOf(summaryFacts.metrics, succeededName, { required: false });
  if (succeeded) {
    return checkValues(succeeded, succeededName);
  }
  const legacyName = scenarioMetricName('checks', scenarioName);
  const legacy = valuesOf(summaryFacts.metrics, legacyName, { required: false });
  if (legacy) {
    return checkValues(legacy, legacyName);
  }
  if (scenarioName == null && summaryFacts.checkResults.length > 0) {
    const passed = summaryFacts.checkResults.reduce(
      (total, result) => total + finite(result.passes, `检查 ${result.name}.passes`),
      0,
    );
    const failed = summaryFacts.checkResults.reduce(
      (total, result) => total + finite(result.fails, `检查 ${result.name}.fails`),
      0,
    );
    return Object.freeze({
      rate: passed + failed === 0 ? 0 : passed / (passed + failed),
      total: passed + failed,
      passed,
    });
  }
  throw reportError('missing-checks', 'k6 脚本没有生成可验证的 check 指标');
}

function countMetric(metrics, name, { required = true } = {}) {
  const values = valuesOf(metrics, name, { required });
  return values == null ? 0 : finite(values.count, `${name}.count`);
}

function gaugeMaximum(metrics, name) {
  const values = valuesOf(metrics, name);
  return finite(values.max ?? values.value, `${name}.max`);
}

export function normalizeK6Summary(summary, { scenarioName = null } = {}) {
  assertObject(summary, 'k6 机器摘要');
  const facts = metricMap(summary);
  const requestMetric = scenarioMetricName('http_reqs', scenarioName);
  const requests = countMetric(facts.metrics, requestMetric);
  if (requests <= 0) throw reportError('empty-http-samples', 'k6 压测没有产生有效 HTTP 请求样本');
  const errorMetric = scenarioMetricName('http_req_failed', scenarioName);
  const errors = valuesOf(facts.metrics, errorMetric);
  const checks = checkRate(facts, scenarioName);
  if (checks.total <= 0) throw reportError('empty-check-samples', 'k6 压测没有执行有效 check');
  const duration = trend(facts.metrics, scenarioMetricName('http_req_duration', scenarioName));
  const durationSeconds = facts.durationSeconds && facts.durationSeconds > 0
    ? facts.durationSeconds
    : null;
  return Object.freeze({
    format: facts.format,
    httpRequests: requests,
    iterations: countMetric(facts.metrics, scenarioMetricName('iterations', scenarioName)),
    failedRequestRate: finite(errors.rate, `${errorMetric}.rate`, { maximum: 1 }),
    checkRate: checks.rate,
    totalChecks: checks.total,
    passedChecks: checks.passed,
    droppedIterations: countMetric(
      facts.metrics,
      scenarioMetricName('dropped_iterations', scenarioName),
      { required: false },
    ),
    maximumVUs: gaugeMaximum(facts.metrics, 'vus_max'),
    requestsPerSecond: durationSeconds == null ? 0 : requests / durationSeconds,
    ...duration,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fixed(value, digits = 2) {
  return Number(value).toFixed(digits);
}

export function renderChineseK6Report({ configuration, metrics, passed, k6Version }) {
  const { profile, thresholds, resolvedTarget } = configuration;
  const rows = [
    ['HTTP 请求数', metrics.httpRequests, '大于 0'],
    ['迭代数', metrics.iterations, '大于 0'],
    ['平均耗时', `${fixed(metrics.averageMs)}ms`, '仅供观察'],
    ['p90', `${fixed(metrics.p90Ms)}ms`, '仅供观察'],
    ['p95', `${fixed(metrics.p95Ms)}ms`, `不超过 ${fixed(thresholds.p95Ms)}ms`],
    ['p99', `${fixed(metrics.p99Ms)}ms`, `不超过 ${fixed(thresholds.p99Ms)}ms`],
    ['最大耗时', `${fixed(metrics.maximumMs)}ms`, '仅供观察'],
    ['请求错误率', `${fixed(metrics.failedRequestRate * 100)}%`, `不超过 ${fixed(thresholds.errorRate * 100)}%`],
    ['检查成功率', `${fixed(metrics.checkRate * 100)}%`, `不低于 ${fixed(thresholds.checkRate * 100)}%`],
    ['丢弃迭代', metrics.droppedIterations, `不超过 ${thresholds.maxDroppedIterations}`],
    ['最大 VU', metrics.maximumVUs, `受控配置 ${profile.maxVUs}`],
    ['平均请求速率', `${fixed(metrics.requestsPerSecond)} 次/秒`, '仅供观察'],
  ].map(([name, measured, expected]) => (
    `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(measured)}</td><td>${escapeHtml(expected)}</td></tr>`
  )).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>k6 接口压测报告</title>
<style>:root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#f5f7fb}body{margin:0}main{width:min(1100px,calc(100% - 32px));margin:32px auto}header,.panel{background:#fff;border:1px solid #e4e8f0;border-radius:12px;padding:22px;margin-bottom:16px}h1,p{margin-top:0}.result{font-weight:700;color:${passed ? '#067647' : '#b42318'}}.meta{display:flex;gap:24px;flex-wrap:wrap}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #edf0f5;text-align:left}</style></head>
<body><main><header><h1>k6 接口压测报告</h1><p class="result">${passed ? '压测已通过' : '压测未通过'}</p><div class="meta"><span>目标主机：<code>${escapeHtml(resolvedTarget.hostname)}</code></span><span>配置档：<code>${escapeHtml(profile.name)}</code></span><span>执行器：<code>${escapeHtml(profile.executor)}</code></span><span>k6：<code>${escapeHtml(k6Version)}</code></span></div></header>
<section class="panel"><table><thead><tr><th>指标</th><th>实测</th><th>要求</th></tr></thead><tbody>${rows}</tbody></table></section>
<section class="panel"><p>该报告来自本地 k6 机器摘要。压测负载由 repo-guard 受控入口生成，凭据不会写入报告；第三方原始诊断仅用于定位执行错误。</p></section></main></body></html>`;
}
