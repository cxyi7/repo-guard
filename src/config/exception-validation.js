import { DEFAULT_EXCEPTIONS_CONFIG } from './defaults.js';
import {
  assertKnownProperties,
  configValidationError,
  normalizeIsoDate,
  normalizeRelativePattern,
} from './validation-primitives.js';

export function validateExceptionConfiguration(value, configPath) {
  const exceptionsValue = value.exceptions ?? {};
  if (!exceptionsValue || typeof exceptionsValue !== 'object'
    || Array.isArray(exceptionsValue)) {
    throw configValidationError(`${configPath} exceptions 必须是对象`);
  }
  assertKnownProperties(
    exceptionsValue,
    new Set(['warningDays', 'maxDays', 'entries']),
    `${configPath} exceptions`,
  );
  const exceptionWarningDays = exceptionsValue.warningDays
    ?? DEFAULT_EXCEPTIONS_CONFIG.warningDays;
  const exceptionMaxDays = exceptionsValue.maxDays ?? DEFAULT_EXCEPTIONS_CONFIG.maxDays;
  if (!Number.isInteger(exceptionWarningDays) || exceptionWarningDays < 0) {
    throw configValidationError(`${configPath} exceptions.warningDays 必须是非负整数`);
  }
  if (!Number.isInteger(exceptionMaxDays) || exceptionMaxDays <= 0
    || exceptionMaxDays > 365) {
    throw configValidationError(`${configPath} exceptions.maxDays 必须介于 1 到 365 之间`);
  }
  if (exceptionWarningDays >= exceptionMaxDays) {
    throw configValidationError(`${configPath} exceptions.warningDays 必须小于 maxDays`);
  }
  const exceptionEntriesValue = exceptionsValue.entries
    ?? DEFAULT_EXCEPTIONS_CONFIG.entries;
  if (!Array.isArray(exceptionEntriesValue)) {
    throw configValidationError(`${configPath} exceptions.entries 必须是数组`);
  }
  const exceptionIds = new Set();
  const exceptionTargets = new Set();
  const exceptionEntries = exceptionEntriesValue.map((entry, index) => {
    const label = `${configPath} exception ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configValidationError(`${label} 必须是对象`);
    }
    assertKnownProperties(
      entry,
      new Set([
        'id',
        'rule',
        'path',
        'line',
        'column',
        'reason',
        'owner',
        'approvedBy',
        'ticket',
        'createdOn',
        'expiresOn',
      ]),
      label,
    );
    if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw configValidationError(`${label}.id 必须是 kebab-case 标识符`);
    }
    if (exceptionIds.has(entry.id)) {
      throw configValidationError(`${configPath} 例外 id 重复： ${entry.id}`);
    }
    exceptionIds.add(entry.id);
    if (typeof entry.rule !== 'string'
      || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/.test(entry.rule)) {
      throw configValidationError(`${label}.rule 必须是带命名空间的 kebab-case 规则 id`);
    }
    const exceptionPath = normalizeRelativePattern(entry.path, `${label}.path`);
    if (exceptionPath === '.' || /[!*?{}[\]]/.test(exceptionPath)
      || exceptionPath.endsWith('/')) {
      throw configValidationError(`${label}.path 必须是准确的单一仓库相对文件路径`);
    }
    for (const position of ['line', 'column']) {
      if (!Number.isInteger(entry[position]) || entry[position] <= 0) {
        throw configValidationError(`${label}.${position} 必须是正整数`);
      }
    }
    const stringFields = ['reason', 'owner', 'approvedBy', 'ticket'];
    const strings = Object.fromEntries(stringFields.map((field) => {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw configValidationError(`${label}.${field} 必须是非空字符串`);
      }
      return [field, entry[field].trim()];
    }));
    if (strings.reason.length < 10) {
      throw configValidationError(`${label}.reason 必须至少包含 10 个字符`);
    }
    if (strings.ticket.length < 3) {
      throw configValidationError(`${label}.ticket 必须至少包含 3 个字符`);
    }
    if (strings.owner.toLocaleLowerCase() === strings.approvedBy.toLocaleLowerCase()) {
      throw configValidationError(`${label}.approvedBy 不能与 owner 相同`);
    }
    const createdOn = normalizeIsoDate(entry.createdOn, `${label}.createdOn`);
    const expiresOn = normalizeIsoDate(entry.expiresOn, `${label}.expiresOn`);
    const lifetimeDays = (
      Date.parse(`${expiresOn}T00:00:00.000Z`)
      - Date.parse(`${createdOn}T00:00:00.000Z`)
    ) / (24 * 60 * 60 * 1000);
    if (lifetimeDays <= 0 || lifetimeDays > exceptionMaxDays) {
      throw configValidationError(
        `${label} 有效期必须介于 1 到 ${exceptionMaxDays} 天之间`,
      );
    }
    const target = `${entry.rule}\0${exceptionPath}\0${entry.line}\0${entry.column}`;
    if (exceptionTargets.has(target)) {
      throw configValidationError(`${configPath} 例外目标重复： ${entry.rule} ${exceptionPath}:${entry.line}:${entry.column}`);
    }
    exceptionTargets.add(target);
    return {
      id: entry.id,
      rule: entry.rule,
      path: exceptionPath,
      line: entry.line,
      column: entry.column,
      ...strings,
      createdOn,
      expiresOn,
    };
  });

  return {
    warningDays: exceptionWarningDays,
    maxDays: exceptionMaxDays,
    entries: exceptionEntries,
  };
}
