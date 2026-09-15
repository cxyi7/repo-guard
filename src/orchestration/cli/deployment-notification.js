import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateCiNotification } from '../../config/ci-notification.js';
import { sendCiNotifications } from '../../gates/release/ci-notification.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';

export function prepareDeploymentNotification(root) {
  try {
    const document = JSON.parse(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'));
    return validateCiNotification(document.ci?.notification);
  } catch {
    writeConsoleMessage('部署通知配置读取失败，请检查 ci.notification；部署结果与通知结果分别记录。');
    return { enabled: false, channels: [] };
  }
}

export function deploymentMessage(context, event) {
  const operation = { deploy: '部署', rollback: '回滚', recover: '恢复' }[event.operation] ?? '部署';
  let summary;
  if (event.status === 'starting') summary = event.backupEnabled || event.operation === 'recover'
    ? `正在开始${operation}，即将暂停使用服务，请暂时停止操作。`
    : `正在开始${operation}，旧应用继续服务，健康检查通过后自动切换；本次不备份或恢复数据。`;
  else if (event.status === 'passed') summary = event.serviceRestored
    ? `${operation}成功，健康检查通过，服务已恢复使用。`
    : `${operation}完成，但没有可用的旧应用，服务仍处于维护状态。`;
  else if (event.serviceRestored) summary = event.backupEnabled
    ? `${operation}失败，已切回旧应用并恢复发布前快照，服务已恢复使用。`
    : `${operation}失败，已切回旧应用，服务已恢复使用；当前数据保持不变。`;
  else if (event.started || ['operations/recovery-required', 'operations/recovery-failed'].includes(event.error?.code)) {
    summary = `${operation}失败，恢复未确认完成，请勿使用服务。保持维护状态；服务器操作超时时还需核实入口与后台任务状态。`;
  } else summary = `${operation}未完成，本次操作尚未进入停服切换阶段。`;
  // 只发送稳定错误标识，不发送可能包含凭据的第三方消息、命令或环境变量。
  const codes = [event.error?.code, event.error?.cause?.code, event.error?.details?.recoveryCode]
    .filter(value => typeof value === 'string' && /^[a-z][a-z0-9/-]{0,100}$/.test(value));
  const explanations = {
    'operations/health-failed': '/api/health 未通过，请检查应用是否启动、数据库连接和入口代理。',
    'operations/backup-incomplete': 'MySQL 快照完整性检查失败，请检查备份权限与磁盘空间。',
    'operations/redis-save': 'Redis 快照保存失败，请检查认证、持久化配置与磁盘空间。',
    'operations/docker-uncertain': '服务器操作超时或中断，需先确认后台任务是否结束，不能并发执行恢复。',
    'operations/backup-scope': '快照与当前数据配置不一致，请核对 MySQL、上传目录和 Redis 配置。',
    'operations/backup-missing': '上一版本没有数据快照，请关闭备份后仅回退应用，或人工准备数据恢复方案。',
    'operations/build-failed': '构建未完成，请查看本次构建日志。',
  };
  return [
    `repo-guard：${summary}`,
    `项目：${context.projectId}；环境：${context.environmentId}`,
    ...(event.revision ? [`版本：${event.revision}`] : []),
    ...(codes.length ? [`失败原因标识：${[...new Set(codes)].join('、')}`] : []),
    ...codes.filter(code => explanations[code]).map(code => explanations[code]),
    ...(event.status === 'failed' ? [
      '请查看本次终端或 GitLab 作业日志中的对应错误，检查 /api/health 和应用启动日志。',
      ...(event.backupEnabled ? ['请核对 MySQL、上传目录、Redis 的备份恢复权限。'] : ['本次不恢复数据；若旧应用不兼容当前数据库，请人工修复兼容性或发布修复版本。']),
      ...(event.started && !event.serviceRestored ? ['先执行 repo-guard ops status 核实状态；排除原因并确认后台操作结束后，执行 repo-guard ops recover。两个命令均需提供 --project 与 --environment。'] : []),
    ] : []),
  ].join('\n');
}

/** 各渠道独立尝试，平台未确认的消息不自动重发，避免重复告警。 */
export async function notifyDeployment(config, context, event, { send, log = writeConsoleMessage } = {}) {
  if (!config.enabled) return [];
  if (!config.channels.length) {
    log('未配置部署通知渠道，请在 ci.notification.channels 配置飞书或企业微信。');
    return [];
  }
  let content = deploymentMessage(context, event);
  for (const channel of config.channels) {
    for (const value of [channel.webhook, channel.secret].filter(Boolean)) content = content.replaceAll(value, '[已隐藏]');
  }
  const delivery = await sendCiNotifications(config, content, { send });
  return delivery.results.map((result, index) => {
    const channel = config.channels[index];
    const name = channel.provider === 'wecom' ? '企业微信' : '飞书';
    log(result.status === 'passed'
      ? `${name}已确认本次部署状态通知发送成功。`
      : `${name}未确认部署通知发送成功，请检查网络与机器人配置；不改变部署结果，也不中断数据恢复。`);
    return { provider: channel.provider, status: result.status };
  });
}
