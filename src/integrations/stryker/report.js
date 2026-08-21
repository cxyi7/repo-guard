import { readFileSync, writeFileSync } from 'node:fs';
import { executionError } from '../../core/error/repo-guard-error.js';

const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const DETECTED_STATUSES = new Set(['Killed', 'Timeout', 'RuntimeError', 'CompileError']);
const ISSUE_STATUSES = new Set(['Survived', 'NoCoverage']);
const SUPPORTED_STATUSES = new Set([
  ...DETECTED_STATUSES,
  ...ISSUE_STATUSES,
  'Ignored',
  'Pending',
]);
const STATUS_LABELS = Object.freeze({
  Killed: '已检出',
  Timeout: '超时检出',
  RuntimeError: '运行错误检出',
  CompileError: '编译错误检出',
  Survived: '存活',
  NoCoverage: '未覆盖',
  Ignored: '已忽略',
  Pending: '待执行',
});

function reportError(code, message) {
  return executionError(`mutation-test/${code}`, message, {
    expected: 'Stryker 10.x 必须生成结构完整且可验证的 schemaVersion 1.0 JSON 报告。',
  });
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reportError('invalid-report', `${label} 必须是对象`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function countStatuses(mutants) {
  const counts = {};
  for (const mutant of mutants) counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
  const detected = [...DETECTED_STATUSES].reduce((total, status) => total + (counts[status] ?? 0), 0);
  const survived = counts.Survived ?? 0;
  const noCoverage = counts.NoCoverage ?? 0;
  const scored = detected + survived + noCoverage;
  return Object.freeze({
    counts: Object.freeze(counts),
    detected,
    noCoverage,
    score: scored === 0 ? 100 : (detected / scored) * 100,
    scored,
    survived,
    total: mutants.length,
  });
}

function normalizeLocation(value, label) {
  assertObject(value, label);
  assertObject(value.start, `${label}.start`);
  assertObject(value.end, `${label}.end`);
  for (const point of [value.start, value.end]) {
    if (!Number.isInteger(point.line) || point.line < 1
      || !Number.isInteger(point.column) || point.column < 0) {
      throw reportError('invalid-location', `${label} 包含无效行列位置`);
    }
  }
  return value;
}

function assertRepositoryRelativePath(value) {
  if (!value || value.includes('\\') || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw reportError('invalid-file-path', `Stryker 报告包含无效的仓库相对路径：${value}`);
  }
}

function normalizeThresholds(value) {
  assertObject(value, 'Stryker JSON 报告 thresholds');
  const threshold = (name, fallback, nullable = false) => {
    const candidate = value[name];
    if (candidate == null && nullable) return null;
    if (candidate == null) return fallback;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)
      || candidate < 0 || candidate > 100) {
      throw reportError('invalid-threshold', `Stryker 报告阈值 thresholds.${name} 必须介于 0 到 100 之间`);
    }
    return candidate;
  };
  const normalized = {
    break: threshold('break', null, true),
    high: threshold('high', 80),
    low: threshold('low', 60),
  };
  if (normalized.high < normalized.low) {
    throw reportError('invalid-threshold-order', 'Stryker 报告阈值 thresholds.high 不得低于 thresholds.low');
  }
  return Object.freeze(normalized);
}

export function parseMutationReport(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAX_REPORT_BYTES) {
    throw reportError('report-too-large', `Stryker JSON 报告不得超过 ${MAX_REPORT_BYTES} 字节`);
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    throw reportError('invalid-json-report', `Stryker JSON 报告无法解析：${error.message}`);
  }
  assertObject(report, 'Stryker JSON 报告');
  if (report.schemaVersion !== '1.0') {
    throw reportError('unsupported-report-schema', `不支持 Stryker 报告版本：${String(report.schemaVersion)}`);
  }
  assertObject(report.files, 'Stryker JSON 报告 files');
  const files = Object.entries(report.files).map(([filePath, file]) => {
    assertRepositoryRelativePath(filePath);
    assertObject(file, `Stryker 文件 ${filePath}`);
    if (typeof file.source !== 'string' || !Array.isArray(file.mutants)) {
      throw reportError('invalid-file-report', `Stryker 文件 ${filePath} 缺少 source 或 mutants`);
    }
    const mutants = file.mutants.map((mutant, index) => {
      assertObject(mutant, `${filePath} 第 ${index + 1} 个变异`);
      if (typeof mutant.status !== 'string' || typeof mutant.mutatorName !== 'string') {
        throw reportError('invalid-mutant', `${filePath} 第 ${index + 1} 个变异缺少状态或变异器名称`);
      }
      if (!SUPPORTED_STATUSES.has(mutant.status)) {
        throw reportError(
          'unsupported-mutant-status',
          `${filePath} 第 ${index + 1} 个变异包含不支持的状态：${mutant.status}`,
        );
      }
      normalizeLocation(mutant.location, `${filePath} 第 ${index + 1} 个变异位置`);
      return Object.freeze({ ...mutant });
    });
    return Object.freeze({ filePath, source: file.source, mutants, metrics: countStatuses(mutants) });
  }).sort((left, right) => left.filePath.localeCompare(right.filePath));
  const mutants = files.flatMap((file) => file.mutants);
  const thresholds = normalizeThresholds(report.thresholds ?? {});
  return Object.freeze({
    raw: report,
    files: Object.freeze(files),
    mutants: Object.freeze(mutants),
    issues: Object.freeze(files.flatMap((file) => file.mutants
      .filter((mutant) => ISSUE_STATUSES.has(mutant.status))
      .map((mutant) => Object.freeze({ filePath: file.filePath, source: file.source, mutant })))),
    metrics: countStatuses(mutants),
    thresholds,
  });
}

function originalCode(source, location) {
  const lines = source.split(/\r?\n/);
  const start = location.start.line - 1;
  const end = location.end.line - 1;
  if (start === end) return lines[start]?.slice(location.start.column, location.end.column) ?? '';
  return [
    lines[start]?.slice(location.start.column) ?? '',
    ...lines.slice(start + 1, end),
    lines[end]?.slice(0, location.end.column) ?? '',
  ].join('\n');
}

function scoreClass(score, thresholds) {
  if (score >= thresholds.high) return 'good';
  if (score >= thresholds.low) return 'warn';
  return 'bad';
}

export function renderChineseMutationReport(report, { includeOriginalHtml = true } = {}) {
  const { metrics, thresholds } = report;
  const hasScoredMutants = metrics.scored > 0;
  const hasBreakThreshold = thresholds.break != null;
  const passed = hasScoredMutants
    && hasBreakThreshold
    && metrics.score >= thresholds.break;
  const rows = report.files.map((file) => `<tr><td><code>${escapeHtml(file.filePath)}</code></td><td class="${scoreClass(file.metrics.score, thresholds)}">${file.metrics.score.toFixed(2)}%</td><td>${file.metrics.total}</td><td>${file.metrics.detected}</td><td>${file.metrics.survived}</td><td>${file.metrics.noCoverage}</td></tr>`).join('');
  const issues = report.issues.map(({ filePath, source, mutant }) => {
    const location = `${filePath}:${mutant.location.start.line}:${mutant.location.start.column + 1}`;
    const reason = mutant.statusReason
      ? `<p><strong>Stryker 原始诊断：</strong>${escapeHtml(mutant.statusReason)}</p>`
      : '';
    return `<details open><summary><strong>${escapeHtml(STATUS_LABELS[mutant.status] ?? mutant.status)}</strong> <code>${escapeHtml(location)}</code> ${escapeHtml(mutant.mutatorName)}</summary><div class="diff"><section><h3>原始代码</h3><pre><code>${escapeHtml(originalCode(source, mutant.location))}</code></pre></section><section><h3>变异后代码</h3><pre><code>${escapeHtml(mutant.replacement ?? '')}</code></pre></section></div>${reason}</details>`;
  }).join('');
  const thresholdText = !hasScoredMutants
    ? '没有可评分的变异，不能判定为通过'
    : (hasBreakThreshold
      ? `硬门槛 ${thresholds.break}%`
      : '未配置硬门槛，不能判定为通过');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>变异测试报告</title>
<style>:root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#f5f7fb}body{margin:0}main{width:min(1180px,calc(100% - 32px));margin:32px auto}header,.panel,details{background:#fff;border:1px solid #e4e8f0;border-radius:12px;padding:22px;margin-bottom:16px}h1,h2,h3,p{margin-top:0}.result{font-weight:700;color:${passed ? '#067647' : '#b42318'}}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}.card{background:#fff;border:1px solid #e4e8f0;border-radius:10px;padding:16px}.card strong{display:block;font-size:24px;margin-top:6px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #edf0f5;text-align:left}.good{color:#067647}.warn{color:#b54708}.bad{color:#b42318}.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}pre{overflow:auto;background:#172033;color:#d6e4ff;padding:12px;border-radius:8px}@media(max-width:800px){.cards,.diff{grid-template-columns:1fr 1fr}}</style></head>
<body><main><header><h1>变异测试报告</h1><p>变异测试会故意修改生产代码，用于验证测试是否能够发现行为缺陷。</p><p class="result">${passed ? '已通过' : '未通过'}：${metrics.score.toFixed(2)}%，${thresholdText}</p></header>
<section class="cards"><div class="card">变异得分<strong>${metrics.score.toFixed(2)}%</strong></div><div class="card">全部变异<strong>${metrics.total}</strong></div><div class="card">已检出<strong>${metrics.detected}</strong></div><div class="card">存活<strong>${metrics.survived}</strong></div><div class="card">未覆盖<strong>${metrics.noCoverage}</strong></div></section>
<section class="panel"><h2>各文件结果</h2><table><thead><tr><th>文件</th><th>得分</th><th>总数</th><th>已检出</th><th>存活</th><th>未覆盖</th></tr></thead><tbody>${rows}</tbody></table></section>
<section class="panel"><h2>需要处理的变异（${report.issues.length}）</h2>${issues || '<p>没有存活或未覆盖的变异。</p>'}</section>
${includeOriginalHtml ? '<p><a href="mutation-original.html">查看 Stryker 原始交互报告</a></p>' : ''}</main></body></html>`;
}

export function readMutationReport(target) {
  return parseMutationReport(readFileSync(target, 'utf8'));
}

export function writeChineseMutationReport(target, report, options) {
  writeFileSync(target, renderChineseMutationReport(report, options), 'utf8');
}
