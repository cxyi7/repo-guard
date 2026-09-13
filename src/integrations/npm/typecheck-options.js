import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';
import { resolveProjectPackageMetadata } from '../../core/project/package.js';

export function inspectTypecheckOptions(root, options) {
  const metadata = resolveProjectPackageMetadata(root, 'typescript', 'TypeScript 类型工具');
  const ts = createRequire(metadata.packagePath)(metadata.entryPath);
  const tool = options.tool === 'vue-tsc' ? resolveProjectPackageMetadata(root, 'vue-tsc', 'Vue 类型工具', { requireEntry: false }) : metadata;
  const cli = path.join(path.dirname(tool.packagePath), 'bin', options.tool === 'vue-tsc' ? 'vue-tsc.js' : 'tsc');
  const visited = new Set();
  const targets = [];
  const application = realpathSync(root);
  const visit = (file) => {
    const absolute = realpathSync(file);
    const relative = path.relative(application, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw configurationError('typecheck/config-outside-project', '类型配置及项目引用必须位于当前应用目录内。');
    if (visited.has(absolute)) return;
    visited.add(absolute);
    const read = ts.readConfigFile(absolute, ts.sys.readFile);
    if (read.error) throw configurationError('typecheck/config-invalid', '无法读取 TypeScript 配置。');
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute), undefined, absolute, undefined,
      options.tool === 'vue-tsc' ? [{ extension: '.vue', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }] : undefined);
    if (parsed.errors.length) throw configurationError('typecheck/config-invalid', 'TypeScript 配置无效，请检查选项和源码范围。');
    for (const reference of parsed.projectReferences ?? []) visit(ts.resolveProjectReferencePath(reference));
    if (parsed.fileNames.length) {
      const defaults = Object.fromEntries(Object.entries(options.compilerOptions ?? {})
        .filter(([key]) => parsed.options[key] === undefined));
      targets.push({ file: absolute, files: parsed.fileNames, defaults, effective: { ...defaults, ...parsed.options, noEmit: true, incremental: true, composite: false, tsBuildInfoFile: '临时检查目录中的独立增量文件' } });
    }
  };
  for (const file of options.configFiles) visit(path.resolve(root, file));
  if (!targets.length) throw configurationError('typecheck/no-source', '类型检查没有找到实际源码，不能作为检查通过。');
  return { cli, targets, command: `${options.tool}：${options.configFiles.join('、')}` };
}

/** 临时配置继承原生配置；只补未声明的选项，结束后删除，不改写项目文件。 */
export async function executeTypecheckOptions({ root, config, signal, output }) {
  const setup = inspectTypecheckOptions(root, config.options);
  const scratch = mkdtempSync(path.join(tmpdir(), 'repo-guard-typecheck-'));
  const started = Date.now();
  const executions = [];
  try {
    for (const [index, target] of setup.targets.entries()) {
      const configFile = path.join(scratch, `${index}.json`);
      writeFileSync(configFile, JSON.stringify({ extends: target.file,
        compilerOptions: { ...target.defaults, noEmit: true, incremental: true, composite: false,
          tsBuildInfoFile: path.join(scratch, `${index}.tsbuildinfo`) },
        files: target.files, include: [], exclude: [], references: [],
      }));
      executions.push(await runStreamingProcess({ command: process.execPath,
        argumentsList: [setup.cli, '--noEmit', '--project', configFile], root,
        timeoutMs: Math.max(1, config.timeoutMs - (Date.now() - started)), signal, output }));
    }
    return { setup, executions };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
