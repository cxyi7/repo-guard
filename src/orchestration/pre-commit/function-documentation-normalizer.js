import { isUtf8 } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { executionError } from '../../core/error/repo-guard-error.js';
import { synchronizeFunctionDocumentationContent } from '../../policies/function-documentation.js';

export function synchronizeStagedFunctionDocumentation({ root, files }) {
  if (files.length === 0) {
    return Object.freeze({ checked: 0, changed: 0, warnings: Object.freeze([]) });
  }
  let changed = 0;
  const warnings = [];
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const bytes = readFileSync(file);
    if (!isUtf8(bytes)) {
      throw executionError(
        'function-docs/non-utf8-file',
        `文件不是有效 UTF-8 文本，拒绝同步函数文档：${relativePath}`,
        { expected: '受函数文档管理的源文件必须使用 UTF-8 编码。' },
      );
    }
    const original = bytes.toString('utf8');
    const result = synchronizeFunctionDocumentationContent(original, relativePath);
    warnings.push(...result.warnings);
    if (result.content !== original) {
      writeFileSync(file, result.content, 'utf8');
      changed += 1;
    }
  }
  return Object.freeze({
    checked: files.length,
    changed,
    warnings: Object.freeze(warnings),
  });
}
