import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { securityError } from '../../core/error/repo-guard-error.js';
import { validateCiReportPath } from '../../config.js';
import { runGit } from '../../git.js';

function assertNoSymlinkPath(root, reportPath) {
  let current = root;
  for (const segment of reportPath.split('/')) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw securityError('ci-report/symlink-traversal', `CI report path must not traverse a symbolic link: ${reportPath}`, {
        details: { location: { path: reportPath } },
        expected: 'CI 报告路径的每个现有目录都是真实目录而非符号链接。',
      });
    }
  }
}

export function writeCiReport(root, reportPath, report) {
  const normalized = validateCiReportPath(reportPath);
  assertNoSymlinkPath(root, normalized);
  const tracked = runGit(['ls-files', '--error-unmatch', '--', normalized], {
    allowFailure: true,
    cwd: root,
  }).status === 0;
  if (tracked) throw securityError('ci-report/tracked-file-overwrite', `CI report path must not overwrite a tracked file: ${normalized}`, {
    details: { location: { path: normalized } },
    expected: 'CI 报告仅写入未跟踪的 reports/ 生成文件。',
  });
  const target = path.resolve(root, normalized);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
