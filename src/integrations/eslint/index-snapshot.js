import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { runGitBinary, gitValue } from '../../git/execution.js';

/** 类型分析读取完整索引；仅选中文件使用 lint-staged 已隔离且经过前序修复的内容。 */
export function createEslintIndexSnapshot(root, files) {
  const repository = gitValue(['rev-parse', '--show-toplevel'], '', root);
  const scratch = mkdtempSync(path.join(tmpdir(), 'repo-guard-eslint-'));
  const snapshot = path.join(scratch, 'repository');
  mkdirSync(snapshot);
  try {
    const entries = runGitBinary(['ls-files', '--stage', '-z'], { cwd: repository }).stdout.toString('utf8').split('\0').filter(Boolean);
    if (entries.some((entry) => !/^100(?:644|755) [a-f0-9]+ 0\t/.test(entry))) {
      throw configurationError('eslint/index-entry', '类型感知暂存检查要求索引文件无冲突且为普通文件；请处理符号链接或子模块后重试。');
    }
    runGitBinary(['checkout-index', '--all', `--prefix=${snapshot.replaceAll('\\', '/')}/`], { cwd: repository });
    const packageDirectories = new Set(['', ...entries.filter((entry) => entry.endsWith('/package.json') || entry.endsWith('\tpackage.json'))
      .map((entry) => path.dirname(entry.slice(entry.indexOf('\t') + 1)))]);
    let ancestor = repository;
    while (!existsSync(path.join(ancestor, 'node_modules')) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    if (existsSync(path.join(ancestor, 'node_modules'))) symlinkSync(path.join(ancestor, 'node_modules'), path.join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const relative of packageDirectories) {
      const modules = path.join(repository, relative, 'node_modules');
      if (existsSync(modules)) {
        const target = path.join(snapshot, relative, 'node_modules');
        if (!existsSync(target)) { mkdirSync(path.dirname(target), { recursive: true }); symlinkSync(modules, target, process.platform === 'win32' ? 'junction' : 'dir'); }
      }
    }
    const application = path.join(snapshot, path.relative(repository, root));
    const mapped = files.map((file) => {
      const absolute = path.resolve(root, file);
      const relative = path.relative(repository, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw configurationError('eslint/snapshot-path', '暂存检查文件必须位于仓库内。');
      const target = path.join(snapshot, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(absolute));
      return { original: absolute, target };
    });
    return { root: application, boundary: snapshot, files: mapped,
      cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
  } catch (error) { rmSync(scratch, { recursive: true, force: true }); throw toRepoGuardError(error, { code: 'eslint/index-snapshot-failed', message: '无法准备 ESLint 索引快照。' }); }
}
