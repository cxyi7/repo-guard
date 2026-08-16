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
