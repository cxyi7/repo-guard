import { inspectExceptionLifecycle } from '../config/exception-lifecycle.js';

export function findStructuredException(config, finding, options) {
  const result = inspectExceptionLifecycle(config, options);
  const normalizedPath = String(finding.path).replace(/\\/g, '/').replace(/^\.\//, '');
  return result.entries.find((entry) => (
    (entry.status === 'active' || entry.status === 'expiring')
    && entry.rule === finding.rule
    && entry.path === normalizedPath
    && entry.line === finding.line
    && entry.column === finding.column
  )) ?? null;
}
