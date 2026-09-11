import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import micromatch from 'micromatch';
import { configurationError, executionError, toRepoGuardError } from '../../../core/error/repo-guard-error.js';
import { collectTrackedProjectPaths } from '../../../git/tracked-paths.js';
import { runGitBinary } from '../../../git/execution.js';

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export function sourceRelativePath(root, file) {
  if (typeof file !== 'string' || !file || /[\r\n\0]/.test(file)) {
    throw configurationError('java/source-path', 'Java 源码路径必须是不含换行的非空字符串');
  }
  const absolute = path.resolve(root, file);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw configurationError('java/source-outside-root', 'Java 源码检查范围必须位于当前应用根目录内');
  }
  return relative.replaceAll('\\', '/');
}

export function selectJavaSourcePaths(root, files, config) {
  return [...new Set(files.map((file) => sourceRelativePath(root, file)))]
    .filter((file) => file.endsWith('.java')
      && micromatch.isMatch(file, config.include, { dot: true })
      && !micromatch.isMatch(file, config.exclude, { dot: true }))
    .sort();
}

function readSource(root, relative) {
  const absolute = path.resolve(root, relative);
  const realRoot = realpathSync(root);
  let current = path.resolve(root);
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw configurationError('java/source-symlink', `Java 源码路径不能经过符号链接：${relative}`);
    }
  }
  const resolvedRelative = path.relative(realRoot, realpathSync(absolute));
  const stat = lstatSync(absolute);
  if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative) || !stat.isFile()) {
    throw configurationError('java/source-outside-root', `Java 源码路径不是应用内的普通文件：${relative}`);
  }
  if (stat.size > MAX_SOURCE_BYTES) throw executionError('java/source-too-large', `Java 源码超过读取上限：${relative}`);
  return readFileSync(absolute);
}

function decodeSource(bytes, relative) {
  if (bytes.length > MAX_SOURCE_BYTES) throw executionError('java/source-too-large', `Java 源码超过读取上限：${relative}`);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    throw configurationError('java/source-encoding', `Java 源码必须使用有效 UTF-8 编码：${relative}`, { cause });
  }
}

/** 快照只读取索引；已由 lint-staged 隔离的选中文件覆盖索引中的旧内容。 */
export function prepareJavaSourceInputs({ root, files = [], config, indexSnapshot = false, fallbackTracked = true }) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'repo-guard-java-source-'));
  try {
    const selected = selectJavaSourcePaths(root, files, config);
    const all = indexSnapshot || (fallbackTracked && files.length === 0)
      ? selectJavaSourcePaths(root, collectTrackedProjectPaths(root), config)
      : selected;
    const paths = indexSnapshot ? [...new Set([...all, ...selected])].sort() : all;
    const selectedSet = new Set(selected);
    const inputs = paths.map((relative) => {
      let bytes;
      if (indexSnapshot && !selectedSet.has(relative)) {
        const stage = runGitBinary(['ls-files', '--stage', '-z', '--', relative], { cwd: root }).stdout.toString('utf8');
        if (!/^100(?:644|755) [0-9a-f]+ 0\t[^\0]+\0$/.test(stage)) {
          throw configurationError('java/source-index', `Java 索引文件必须是没有冲突的普通文件：${relative}`);
        }
        bytes = runGitBinary(['show', `:./${relative}`], { cwd: root, maxBuffer: MAX_SOURCE_BYTES + 1 }).stdout;
      } else bytes = readSource(root, relative);
      const content = decodeSource(bytes, relative);
      const absolute = indexSnapshot ? path.join(scratch, 'sources', relative) : path.resolve(root, relative);
      if (indexSnapshot) {
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, bytes);
      }
      return Object.freeze({ relative, absolute, content });
    });
    return { scratch, inputs, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw toRepoGuardError(error, { code: 'java/source-input', message: '无法准备 Java 源码文件或索引快照' });
  }
}

export function javaReportedPath(value, inputs, root) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) {
    throw executionError('java/report-path', 'Java 原生报告缺少有效文件路径');
  }
  const absolute = path.resolve(root, value);
  const input = inputs.find((entry) => path.resolve(entry.absolute) === absolute);
  if (!input) throw executionError('java/report-scope', 'Java 原生报告包含本次检查范围之外的文件');
  return input.relative;
}
