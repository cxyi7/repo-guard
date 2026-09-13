import { createRequire } from 'node:module';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configurationError } from '../../core/error/repo-guard-error.js';

function plain(value) {
  return (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
/** 数组整体替换，原生配置的显式值优先；函数和正则保持原样。 */
export function mergeKnipOptions(defaults, native) {
  if (!plain(defaults) || !plain(native)) return native;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(native)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw configurationError(
        'dead-code/unsafe-option',
        'Knip 配置包含不允许的属性',
      );
    result[key] =
      plain(result[key]) && plain(value)
        ? mergeKnipOptions(result[key], value)
        : value;
  }
  return result;
}

/** 在 Knip 子进程内复用消费项目公开 API，避免主进程执行原生配置。 */
export async function loadMergedKnipOptions(specification, args) {
  const { root, packagePath, options, configFile, emptyFile } = specification;
  const require = createRequire(packagePath);
  const { createOptions, KNIP_CONFIG_LOCATIONS } = await import(
    pathToFileURL(require.resolve('knip/session')).href
  );
  const nativeFile =
    configFile ??
    KNIP_CONFIG_LOCATIONS.map((file) => path.join(root, file)).find((file) =>
      existsSync(file),
    );
  if (nativeFile) {
    const relative = path.relative(
      realpathSync(root),
      realpathSync(nativeFile),
    );
    if (
      relative.startsWith('..' + path.sep) ||
      relative === '..' ||
      path.isAbsolute(relative) ||
      !statSync(nativeFile).isFile()
    )
      throw configurationError(
        'dead-code/config-location',
        'Knip 原生配置必须为应用内的普通文件',
      );
  }
  const native = await createOptions({
    cwd: root,
    args: { ...args, config: nativeFile ?? emptyFile },
  });
  const merged = mergeKnipOptions(options, native.parsedConfig);
  // createOptions 已拆分编译器；交还外层原生加载器时恢复其公开配置形式。
  const { syncCompilers, asyncCompilers, ...configuration } = merged;
  if (
    Object.keys(syncCompilers ?? {}).length ||
    Object.keys(asyncCompilers ?? {}).length
  )
    configuration.compilers = {
      ...configuration.compilers,
      ...syncCompilers,
      ...asyncCompilers,
    };
  const { glob } = await import(
    pathToFileURL(require.resolve('tinyglobby')).href
  );
  const validateScope = async (scopeRoot, scope) => {
    for (const field of ['entry', 'project']) {
      const raw = scope[field];
      if (raw === undefined) continue;
      const patterns = typeof raw === 'string' ? [raw] : raw;
      if (
        !Array.isArray(patterns) ||
        !patterns.every((value) => typeof value === 'string')
      )
        throw configurationError(
          'dead-code/scope-options',
          'Knip 入口和范围必须使用路径模式',
        );
      if (patterns.length === 0)
        throw configurationError(
          'dead-code/empty-scope',
          '显式 Knip 入口或扫描范围不能为空；由插件发现时请省略该字段',
        );
      const matches = await glob(
        patterns.map((value) =>
          value.endsWith('!') ? value.slice(0, -1) : value,
        ),
        {
          cwd: scopeRoot,
          onlyFiles: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
          dot: true,
        },
      );
      if (!matches.length)
        throw configurationError(
          'dead-code/empty-scope',
          'Knip 显式配置的 ' + field + ' 没有匹配实际文件，请先补齐接入配置',
        );
    }
  };
  if (!configuration.workspaces) await validateScope(root, configuration);
  else
    for (const [pattern, scope] of Object.entries(configuration.workspaces)) {
      const directories =
        pattern === '.'
          ? ['.']
          : await glob(pattern, {
              cwd: root,
              onlyDirectories: true,
              ignore: ['**/node_modules/**', '**/.git/**'],
              dot: true,
            });
      for (const directory of directories)
        await validateScope(path.resolve(root, directory), scope);
    }
  return configuration;
}
