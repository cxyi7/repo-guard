import { configurationError, executionError } from '../../core/error/repo-guard-error.js';

/** 读取 Lighthouse 本轮图片审计与网络记录；执行失败不能当作无违规。 */
export function inspectPageImages(report, options) {
  if (!options?.enabled) return [];
  const findings = [];
  const add = (issue, message) => findings.push({ rule: 'lighthouse/image-usage', issue: `lighthouse/${issue}`, message,
    severity: options.action === 'error' ? 'error' : 'warning', remediation: '查看本轮页面报告，按实际视口、资源用途和设备像素比修复图片加载。' });
  for (const auditId of options.auditIds) {
    const audit = report.audits?.[auditId];
    if (!audit) {
      if (options.action === 'error') throw configurationError('lighthouse/image-audit-unavailable', `当前 Lighthouse 没有提供必需图片审计 ${auditId}，请核对版本和审计配置。`);
      findings.push({ rule: 'lighthouse/image-usage', issue: 'lighthouse/image-audit-unavailable', severity: 'warning', message: `当前 Lighthouse 未提供图片审计 ${auditId}，本项未验证`, remediation: '检查消费项目 Lighthouse 版本支持的审计名称并调整配置。' });
    } else if (audit.scoreDisplayMode === 'error' || audit.errorMessage) {
      throw executionError('lighthouse/image-audit-failed', `Lighthouse 图片审计 ${auditId} 执行失败，请查看本轮原始报告。`, { details: { diagnostics: audit.errorMessage ? [{ level: 'error', message: `第三方原始诊断（${auditId}）：${audit.errorMessage}` }] : [] } });
    } else if (audit.score === null && ['notApplicable', 'informative', 'manual'].includes(audit.scoreDisplayMode)) {
      // Lighthouse 明确声明不适用或信息项，不能将其混同为执行失败。
    } else if (!Number.isFinite(audit.score) || audit.score < 0 || audit.score > 1) {
      throw executionError('lighthouse/image-audit-invalid', `Lighthouse 图片审计 ${auditId} 缺少有效分数或适用性说明。`);
    } else if (audit.score < 1) add(auditId, `页面图片审计未满足要求：${auditId}`);
  }
  const items = report.audits?.['network-requests']?.details?.items;
  if (!Array.isArray(items)) {
    throw executionError('lighthouse/image-network-unavailable', '本轮缺少网络资源明细，无法验证图片传输预算。');
  }
  const images = items.filter((item) => item.resourceType === 'Image');
  if (images.some((item) => !Number.isFinite(item.transferSize) || item.transferSize < 0)) throw executionError('lighthouse/image-transfer-invalid', '本轮图片传输量缺失或无效，不能按零字节处理。');
  const bytes = images.reduce((sum, item) => sum + item.transferSize, 0);
  const override = options.routes.find((route) => new URL(route.url).href === new URL(report.requestedUrl).href);
  const budget = override?.maxTransferBytes ?? options.maxTransferBytes;
  if (bytes > budget) add('image-transfer-budget', `页面图片传输量 ${bytes} 字节超过预算 ${budget} 字节`);
  if (options.failedRequests && images.some((item) => item.statusCode >= 400 || item.failed === true)) add('image-load-failed', '本轮存在图片加载失败，请在网络资源明细中确认失败地址');
  return findings;
}
