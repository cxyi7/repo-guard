const MAX_TEXT_BYTES = 1900;
const MAX_COMMIT_TITLE_CHARACTERS = 10;
const STATUS_PRESENTATIONS = Object.freeze({
  success: Object.freeze({ icon: '✅', text: '成功' }),
  failed: Object.freeze({ icon: '❌', text: '失败' }),
  canceled: Object.freeze({ icon: '⏹️', text: '已取消' }),
});
const NOTIFIABLE_STATUSES = new Set(Object.keys(STATUS_PRESENTATIONS));
const UNKNOWN_STATUS_PRESENTATION = Object.freeze({ icon: '⚠️', text: '未知' });

function environmentValue(environment, name, fallback = '') {
  const value = environment[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function singleLine(value, fallback = '未知') {
  const normalized = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function commitTitle(value) {
  const characters = [...singleLine(value, '')];
  return characters.length > MAX_COMMIT_TITLE_CHARACTERS
    ? `${characters.slice(0, MAX_COMMIT_TITLE_CHARACTERS).join('')}…`
    : characters.join('');
}

function truncateUtf8(value, maxBytes = MAX_TEXT_BYTES) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;

  const suffix = '\n……消息过长，已截断。';
  const limit = maxBytes - Buffer.byteLength(suffix, 'utf8');
  let output = '';
  for (const character of value) {
    if (Buffer.byteLength(output + character, 'utf8') > limit) break;
    output += character;
  }
  return output + suffix;
}

function notificationTimestamp(now) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now).replaceAll('/', '-');
}

export function gitLabNotificationStatus(environment = process.env) {
  return environmentValue(environment, 'CI_JOB_STATUS', 'unknown');
}

export function shouldNotifyGitLabPipeline(environment = process.env) {
  return NOTIFIABLE_STATUSES.has(gitLabNotificationStatus(environment));
}

export function buildGitLabCiNotificationText(environment = process.env, {
  now = new Date(),
} = {}) {
  const status = gitLabNotificationStatus(environment);
  const presentation = STATUS_PRESENTATIONS[status] ?? UNKNOWN_STATUS_PRESENTATION;
  const project = environmentValue(
    environment,
    'CI_PROJECT_PATH',
    environmentValue(environment, 'CI_PROJECT_NAME'),
  );
  const actor = environmentValue(
    environment,
    'CI_COMMIT_AUTHOR',
    environmentValue(environment, 'GITLAB_USER_NAME'),
  );

  return truncateUtf8([
    `${presentation.icon}【GitLab 流水线${presentation.text}】`,
    `项目：${singleLine(project)}`,
    `流水线编号：${singleLine(environmentValue(environment, 'CI_PIPELINE_IID'))}`,
    `分支：${singleLine(environmentValue(environment, 'CI_COMMIT_REF_NAME'))}`,
    `提交：${singleLine(environmentValue(environment, 'CI_COMMIT_SHORT_SHA'))} ${commitTitle(environmentValue(environment, 'CI_COMMIT_TITLE'))}`.trim(),
    `提交人：${singleLine(actor)}`,
    `状态：${presentation.text}（${status}）`,
    `流水线：${singleLine(environmentValue(environment, 'CI_PIPELINE_URL'))}`,
    `通知时间：${notificationTimestamp(now)}`,
  ].join('\n'));
}
