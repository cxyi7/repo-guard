import path from 'node:path';
import { gitValue } from '../git/execution.js';

const MAX_TEXT_BYTES = 1900;

function singleLine(value, fallback = '未知') {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function truncateUtf8(value) {
  if (Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES) return value;
  const suffix = '\n……消息过长，已截断。';
  const limit = MAX_TEXT_BYTES - Buffer.byteLength(suffix, 'utf8');
  let output = '';
  for (const character of value) {
    if (Buffer.byteLength(output + character, 'utf8') > limit) break;
    output += character;
  }
  return output + suffix;
}

function metric(value, { fractionDigits = 0, suffix = '' } = {}) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(fractionDigits)}${suffix}`
    : '未生成';
}

export function buildMutationTestNotification(root, build, result, now = new Date()) {
  const branch = gitValue(['symbolic-ref', '--short', '-q', 'HEAD'], '游离状态', root);
  const userName = gitValue(['config', '--get', 'user.name'], '未配置', root);
  const userEmail = gitValue(['config', '--get', 'user.email'], '', root);
  const actor = userEmail ? `${userName} <${userEmail}>` : userName;
  const metrics = result.metrics ?? {};
  const report = result.artifacts.find(({ type }) => type === 'mutation-report-html')?.path
    ?? '未生成';
  return truncateUtf8([
    '❌【变异测试未通过，构建已中断】',
    `项目：${singleLine(path.basename(root))}`,
    `分支：${singleLine(branch)}`,
    `操作人：${singleLine(actor)}`,
    `构建脚本：${singleLine(build.script)}`,
    `失败原因：${singleLine(result.summary)}`,
    `变异得分：${metric(metrics.mutationScore, { fractionDigits: 2, suffix: '%' })}`,
    `硬门槛：${metric(metrics.breakThreshold, { fractionDigits: 2, suffix: '%' })}`,
    `存活变异：${metric(metrics.survivedMutants)}`,
    `未覆盖变异：${metric(metrics.uncoveredMutants)}`,
    `中文报告：${singleLine(report)}`,
    `通知时间：${now.toISOString()}`,
  ].join('\n'));
}
