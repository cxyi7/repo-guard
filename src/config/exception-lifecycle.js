import { configurationError } from '../core/error/repo-guard-error.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value) {
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MS;
}

function todayText(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('例外检查需要有效的当前日期');
  }
  return date.toISOString().slice(0, 10);
}

export function inspectExceptionLifecycle(config, { now = new Date() } = {}) {
  const today = todayText(now);
  const todayDay = utcDay(today);
  const entries = config.entries.map((entry) => {
    const createdDay = utcDay(entry.createdOn);
    const daysRemaining = utcDay(entry.expiresOn) - todayDay;
    const status = createdDay > todayDay
      ? 'future'
      : daysRemaining < 0
      ? 'expired'
      : daysRemaining <= config.warningDays ? 'expiring' : 'active';
    return { ...entry, daysRemaining, status };
  });
  return {
    active: entries.filter(({ status }) => status === 'active'),
    entries,
    expired: entries.filter(({ status }) => status === 'expired'),
    expiring: entries.filter(({ status }) => status === 'expiring'),
    future: entries.filter(({ status }) => status === 'future'),
    today,
  };
}

export function assertExceptionLifecycleCurrent(config, options) {
  const result = inspectExceptionLifecycle(config, options);
  if (result.expired.length === 0 && result.future.length === 0) return result;
  const invalidEntries = [...result.expired, ...result.future];
  const message = [
    `结构化例外中包含 ${result.expired.length} 条已过期记录和 `
      + `${result.future.length} 条创建日期晚于当前日期的记录（today=${result.today}）。`,
    `无效记录：${invalidEntries
      .map((entry) => `${entry.id} [${entry.status}] ${entry.path}:${entry.line}:${entry.column}`)
      .join('、')}。`,
    '已过期的例外必须在修复违规后删除，或经过人工复审后重新批准；创建日期晚于当前日期的记录无效。',
    'AI 不得通过延长日期、改变位置或修改审批元数据来绕过门禁。',
  ].join('\n');
  throw configurationError('exceptions/invalid-validity-window', message, {
    details: {
      location: { path: 'repo-guard.config.json' },
      evidence: invalidEntries.map((entry) => ({
        type: 'structured-exception-validity',
        message: `${entry.id} 状态为 ${entry.status}；expiresOn=${entry.expiresOn}`,
        location: { path: entry.path, line: entry.line, column: entry.column },
      })),
    },
    expected: '结构化例外尚未过期、不是未来创建，且审批元数据保持不变。',
    remediation: {
      goal: '通过修复原始违规或重新完成人工审批来清理无效例外',
      steps: ['修复原始违规并删除例外，或由人工重新审核后创建新的例外记录'],
      constraints: ['AI 不得自行延长日期、移动例外位置或修改审批人'],
      verification: ['运行 repo-guard check 并确认结构化例外门禁通过'],
    },
    decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
  });
}
