import { configurationError } from '../../core/error/repo-guard-error.js';

export function ensureSupportedOptions(argumentsList, supported) {
  const unknown = argumentsList.filter((argument) => argument.startsWith('-') && !supported.has(argument));
  if (unknown.length > 0) {
    throw configurationError('cli/unsupported-option', `不支持的选项： ${unknown.join(', ')}`);
  }
}

export function parseValuedOptions(argumentsList, { flags, values }) {
  const parsed = { flags: new Set(), values: {} };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (flags.has(argument)) {
      parsed.flags.add(argument);
      continue;
    }
    if (values.has(argument)) {
      if (Object.hasOwn(parsed.values, argument)) {
        throw configurationError('cli/duplicate-option', `${argument} 不得重复提供`);
      }
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('-')) {
        throw configurationError('cli/missing-option-value', `${argument} 必须提供值`);
      }
      parsed.values[argument] = value;
      index += 1;
      continue;
    }
    throw configurationError('cli/unsupported-argument', `不支持的选项或参数： ${argument}`);
  }
  return parsed;
}

export function extractProjectOption(argumentsList) {
  const remaining = [];
  let projectId;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const value = argumentsList[index];
    if (value === '--') {
      remaining.push(...argumentsList.slice(index));
      break;
    }
    if (value !== '--project') {
      remaining.push(value);
      continue;
    }
    if (projectId !== undefined) throw configurationError('cli/duplicate-option', '--project 不得重复提供');
    projectId = argumentsList[index + 1];
    if (!projectId || projectId.startsWith('-')) {
      throw configurationError('cli/missing-option-value', '--project 必须提供应用标识');
    }
    index += 1;
  }
  return { argumentsList: remaining, projectId };
}
