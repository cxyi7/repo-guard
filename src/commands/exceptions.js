import { loadConfig } from '../config.js';
import {
  formatExceptionRegistryReport,
  inspectExceptionRegistry,
} from '../exception-registry.js';
import { findRepositoryRoot } from '../git.js';

export function runExceptionsCommand(cwd = process.cwd()) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root, { allowExpiredExceptions: true });
  const result = inspectExceptionRegistry(config.exceptions);
  const report = formatExceptionRegistryReport(result);
  if (result.expired.length > 0 || result.future.length > 0) {
    console.error(report);
    console.error('repo-guard exceptions failed: remove or renew expired entries through human review.');
    return 1;
  }
  console.log(report);
  if (result.expiring.length > 0) {
    console.warn('repo-guard exceptions warning: review entries before they expire.');
  } else {
    console.log('repo-guard exceptions passed.');
  }
  return 0;
}
