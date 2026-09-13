import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isSpecialDependencyReference } from '../dependencies/version.js';
import { configurationError } from '../../core/error/repo-guard-error.js';

/** 按问题所在工作区读取声明，不能用另一应用的同名特殊依赖掩盖普通问题。 */
export function filterSpecialDependencyIssues(root, issues) {
  const cache = new Map();
  const manifests = (file) => {
    let directory = path.dirname(path.resolve(root, file));
    while (true) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) {
        if (!cache.has(manifest)) {
          const relative = path.relative(
            realpathSync(root),
            realpathSync(manifest),
          );
          if (
            relative === '..' ||
            relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative)
          )
            throw configurationError(
              'dead-code/manifest-location',
              '依赖清单位于应用范围之外',
            );
          try {
            cache.set(manifest, JSON.parse(readFileSync(manifest, 'utf8')));
          } catch (cause) {
            throw configurationError(
              'dead-code/manifest-parse',
              '无法解析问题所属依赖清单',
              { cause },
            );
          }
        }
        const value = cache.get(manifest);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw configurationError(
            'dead-code/manifest-parse',
            '问题所属依赖清单必须为 JSON 对象',
          );
        return value;
      }
      if (directory === path.resolve(root)) return {};
      const parent = path.dirname(directory);
      if (parent === directory) return {};
      directory = parent;
    }
  };
  const skipped = [];
  const checked = issues.filter((issue) => {
    if (
      !['dependencies', 'unlisted', 'binaries', 'unresolved'].includes(
        issue.type,
      )
    )
      return true;
    const manifest = manifests(issue.file);
    const values = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]
      .map((section) => manifest[section]?.[issue.name])
      .filter((value) => value !== undefined);
    if (
      values.length &&
      values.every((value) => isSpecialDependencyReference(issue.name, value))
    ) {
      skipped.push(issue);
      return false;
    }
    return true;
  });
  return { issues: checked, skippedSpecialReferences: skipped.length };
}
