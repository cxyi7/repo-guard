import { configurationError } from '../../core/error/repo-guard-error.js';

export function ensureSupportedOptions(argumentsList, supported) {
  const unknown = argumentsList.filter((argument) => argument.startsWith('-') && !supported.has(argument));
  if (unknown.length > 0) {
    throw configurationError('cli/unsupported-option', `Unsupported option(s): ${unknown.join(', ')}`);
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
        throw configurationError('cli/missing-option-value', `${argument} requires a value`);
      }
      parsed.values[argument] = value;
      index += 1;
      continue;
    }
    throw configurationError('cli/unsupported-argument', `Unsupported option or argument: ${argument}`);
  }
  return parsed;
}
