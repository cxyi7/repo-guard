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
    throw configValidationError(`${configPath} exceptions must be an object`);
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
    throw configValidationError(`${configPath} exceptions.warningDays must be a non-negative integer`);
  }
  if (!Number.isInteger(exceptionMaxDays) || exceptionMaxDays <= 0
    || exceptionMaxDays > 365) {
    throw configValidationError(`${configPath} exceptions.maxDays must be between 1 and 365`);
  }
  if (exceptionWarningDays >= exceptionMaxDays) {
    throw configValidationError(`${configPath} exceptions.warningDays must be less than maxDays`);
  }
  const exceptionEntriesValue = exceptionsValue.entries
    ?? DEFAULT_EXCEPTIONS_CONFIG.entries;
  if (!Array.isArray(exceptionEntriesValue)) {
    throw configValidationError(`${configPath} exceptions.entries must be an array`);
  }
  const exceptionIds = new Set();
  const exceptionTargets = new Set();
  const exceptionEntries = exceptionEntriesValue.map((entry, index) => {
    const label = `${configPath} exception ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configValidationError(`${label} must be an object`);
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
      throw configValidationError(`${label}.id must be a kebab-case identifier`);
    }
    if (exceptionIds.has(entry.id)) {
      throw configValidationError(`${configPath} exception id is duplicated: ${entry.id}`);
    }
    exceptionIds.add(entry.id);
    if (typeof entry.rule !== 'string'
      || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/.test(entry.rule)) {
      throw configValidationError(`${label}.rule must be a namespaced kebab-case rule id`);
    }
    const exceptionPath = normalizeRelativePattern(entry.path, `${label}.path`);
    if (exceptionPath === '.' || /[!*?{}[\]]/.test(exceptionPath)
      || exceptionPath.endsWith('/')) {
      throw configValidationError(`${label}.path must be one exact repository-relative file`);
    }
    for (const position of ['line', 'column']) {
      if (!Number.isInteger(entry[position]) || entry[position] <= 0) {
        throw configValidationError(`${label}.${position} must be a positive integer`);
      }
    }
    const stringFields = ['reason', 'owner', 'approvedBy', 'ticket'];
    const strings = Object.fromEntries(stringFields.map((field) => {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw configValidationError(`${label}.${field} must be a non-empty string`);
      }
      return [field, entry[field].trim()];
    }));
    if (strings.reason.length < 10) {
      throw configValidationError(`${label}.reason must contain at least 10 characters`);
    }
    if (strings.ticket.length < 3) {
      throw configValidationError(`${label}.ticket must contain at least 3 characters`);
    }
    if (strings.owner.toLocaleLowerCase() === strings.approvedBy.toLocaleLowerCase()) {
      throw configValidationError(`${label}.approvedBy must be different from owner`);
    }
    const createdOn = normalizeIsoDate(entry.createdOn, `${label}.createdOn`);
    const expiresOn = normalizeIsoDate(entry.expiresOn, `${label}.expiresOn`);
    const lifetimeDays = (
      Date.parse(`${expiresOn}T00:00:00.000Z`)
      - Date.parse(`${createdOn}T00:00:00.000Z`)
    ) / (24 * 60 * 60 * 1000);
    if (lifetimeDays <= 0 || lifetimeDays > exceptionMaxDays) {
      throw configValidationError(
        `${label} lifetime must be between 1 and ${exceptionMaxDays} days`,
      );
    }
    const target = `${entry.rule}\0${exceptionPath}\0${entry.line}\0${entry.column}`;
    if (exceptionTargets.has(target)) {
      throw configValidationError(`${configPath} exception target is duplicated: ${entry.rule} ${exceptionPath}:${entry.line}:${entry.column}`);
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
