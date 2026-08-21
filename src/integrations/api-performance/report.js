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

function resultLabel(scenario) {
  const { statistics, thresholds } = scenario;
  return statistics.p95Ms <= thresholds.p95Ms
    && statistics.p99Ms <= thresholds.p99Ms
    && statistics.errorRate <= thresholds.errorRate
    ? '通过'
    : '未通过';
}

export function renderChineseApiPerformanceReport({ target, execution, passed }) {
  const rows = execution.scenarios.map((scenario) => {
    const { statistics, thresholds } = scenario;
    return `<tr><td>${escapeHtml(scenario.name)}</td><td><code>${escapeHtml(scenario.method)} ${escapeHtml(scenario.pathLabel)}</code></td><td>${statistics.samples}</td><td>${statistics.failedSamples}</td><td>${fixed(statistics.averageMs)}ms</td><td>${fixed(statistics.p50Ms)}ms</td><td>${fixed(statistics.p90Ms)}ms</td><td>${fixed(statistics.p95Ms)} / ${fixed(thresholds.p95Ms)}ms</td><td>${fixed(statistics.p99Ms)} / ${fixed(thresholds.p99Ms)}ms</td><td>${fixed(statistics.maxMs)}ms</td><td>${fixed(statistics.errorRate * 100)}% / ${fixed(thresholds.errorRate * 100)}%</td><td class="${resultLabel(scenario) === '通过' ? 'passed' : 'failed'}">${resultLabel(scenario)}</td></tr>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>接口性能测试报告</title>
<style>:root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#f5f7fb}body{margin:0}main{width:min(1480px,calc(100% - 32px));margin:32px auto}header,.panel{background:#fff;border:1px solid #e4e8f0;border-radius:12px;padding:22px;margin-bottom:16px}h1,p{margin-top:0}.result{font-weight:700;color:${passed ? '#067647' : '#b42318'}}.meta{display:flex;gap:24px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px;border-bottom:1px solid #edf0f5;text-align:left;white-space:nowrap}.passed{color:#067647;font-weight:700}.failed{color:#b42318;font-weight:700}.table-wrap{overflow:auto}</style></head>
<body><main><header><h1>接口性能测试报告</h1><p class="result">${passed ? '测试已通过' : '测试未通过'}</p><div class="meta"><span>目标主机：<code>${escapeHtml(target.hostname)}</code></span><span>场景数：${execution.scenarios.length}</span><span>预热次数：${execution.execution.warmupIterations}</span><span>正式样本：每场景 ${execution.execution.iterations}</span><span>并发数：${execution.execution.concurrency}</span></div></header>
<section class="panel"><div class="table-wrap"><table><thead><tr><th>场景</th><th>请求</th><th>样本</th><th>失败</th><th>平均</th><th>p50</th><th>p90</th><th>p95 / 阈值</th><th>p99 / 阈值</th><th>最大</th><th>错误率 / 阈值</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="panel"><p>耗时从调用项目请求客户端前开始，到请求成功或失败结束，包含项目 Axios 拦截器、序列化和重试产生的客户端实际开销。预热请求不进入统计，正式样本不会删除异常值。</p></section></main></body></html>`;
}

