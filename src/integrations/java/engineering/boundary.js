import fs from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../../core/error/repo-guard-error.js';
import { listIndexFiles } from '../../../git/index-content.js';
import { javaOutputPaths, safeJavaPath } from './files.js';
import { parseJavaXml } from './reports.js';

function reject(message) {
  throw configurationError('java/maven-project-boundary', message);
}

function child(node, name) {
  return node?.children.find((item) => item.name === name);
}

function insidePath(root, base, value) {
  if (!value || /\$\{|[\0\r\n]/.test(value)) reject('Maven 模块与输出路径必须能在检查前明确解析');
  const absolute = path.resolve(base, value.replaceAll('\\', '/'));
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    reject('Maven 模块与输出路径不得指向应用根目录本身或应用外部');
  }
  if (relative.split('/').some((part) => part.replace(/[ .]+$/g, '').toLowerCase() === '.git')) {
    reject('Maven 模块与输出路径不得进入 Git 元数据目录');
  }
  safeJavaPath(root, relative, { required: false });
  return relative;
}

function resolveOutput(value, basedir, buildDirectory) {
  return value.trim().replace(/\$\{(?:project\.|pom\.)?basedir\}/g, basedir)
    .replace(/\$\{project\.build\.directory\}/g, buildDirectory ?? '${project.build.directory}');
}

function declaredOutputs(node) {
  const build = child(node, 'build');
  const fields = Object.fromEntries(['directory', 'outputDirectory', 'testOutputDirectory']
    .filter((name) => child(build, name)).map((name) => [name, child(build, name).text]));
  const report = child(child(node, 'reporting'), 'outputDirectory');
  return { ...fields, ...(report ? { reportingDirectory: report.text } : {}) };
}

function buildOutputs(root, basedir, fields) {
  const directory = insidePath(root, basedir, resolveOutput(fields.directory ?? 'target', basedir));
  const buildDirectory = path.resolve(root, directory);
  const outputs = [directory];
  for (const field of ['outputDirectory', 'testOutputDirectory', 'reportingDirectory']) {
    if (fields[field] !== undefined) outputs.push(insidePath(root, basedir, resolveOutput(fields[field], basedir, buildDirectory)));
  }
  return outputs;
}

function createModelReader(root) {
  const models = new Map();
  function read(relative) {
    if (models.has(relative)) return models.get(relative);
    if (models.size >= 256) reject('Maven 模块及本地父 POM 超过 256 个文件的预检上限');
    const pom = safeJavaPath(root, relative);
    const stat = fs.statSync(pom);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) reject('Maven POM 必须是大小不超过 2 MiB 的普通文件');
    const project = parseJavaXml(fs.readFileSync(pom), 'project');
    models.set(relative, project);
    return project;
  }
  function outputVariants(relative, ancestors = new Set()) {
    if (ancestors.has(relative)) reject('Maven 本地父 POM 存在循环引用');
    const project = read(relative);
    const basedir = path.dirname(path.resolve(root, relative));
    const parent = child(project, 'parent');
    const reference = parent ? (child(parent, 'relativePath')?.text.trim() ?? '../pom.xml') : '';
    let inherited = [{}];
    if (reference) {
      if (/\$\{|[\0\r\n]/.test(reference)) reject('Maven 本地父 POM 路径必须能在检查前明确解析');
      const absolute = path.resolve(basedir, reference);
      const parentPath = path.relative(root, absolute).replaceAll('\\', '/');
      if (parentPath && parentPath !== '..' && !parentPath.startsWith('../') && !path.isAbsolute(parentPath)) {
        insidePath(root, basedir, reference);
        if (fs.existsSync(absolute)) inherited = outputVariants(parentPath, new Set([...ancestors, relative]));
      }
    }
    const base = declaredOutputs(project);
    const profiles = child(project, 'profiles')?.children.filter((node) => node.name === 'profile') ?? [];
    const local = [base, ...profiles.map((profile) => ({ ...base, ...declaredOutputs(profile) }))];
    if (inherited.length * local.length > 1024) reject('Maven 输出继承与 profile 候选组合超过预检上限');
    return inherited.flatMap((fields) => local.map((own) => ({ ...fields, ...own })));
  }
  return { read, outputVariants };
}

function ensureUntrackedOutputs(root, config, directories) {
  const tracked = listIndexFiles(root);
  const canonical = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const outputFiles = javaOutputPaths(config).map((file) => canonical(insidePath(root, root, file)));
  const outputDirectories = [...directories].map(canonical);
  for (const file of tracked) {
    const normalized = canonical(file);
    if (outputFiles.includes(normalized) || outputDirectories.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`))) {
      reject(`Maven 检查输出或清理目录包含 Git 已跟踪文件，检查不会覆盖或删除它：${file}`);
    }
  }
}

/** 预检声明式模块和输出边界；不把 Maven 插件执行当作文件系统沙箱。 */
export function inspectMavenBoundary(root, config) {
  const applicationRoot = path.resolve(root);
  const pending = [config.pom, ...config.modules.map((module) => module.directory === '.'
    ? config.pom : path.posix.join(module.directory, 'pom.xml'))];
  const visited = new Set();
  const outputDirectories = new Set();
  const model = createModelReader(applicationRoot);
  while (pending.length) {
    const relative = pending.pop();
    const identity = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (visited.has(identity)) continue;
    if (visited.size >= 256) reject('Maven 模块声明超过 256 个文件的预检上限');
    visited.add(identity);
    const pom = safeJavaPath(applicationRoot, relative);
    const project = model.read(relative);
    const basedir = path.dirname(pom);
    for (const fields of model.outputVariants(relative)) {
      for (const directory of buildOutputs(applicationRoot, basedir, fields)) outputDirectories.add(directory);
    }
    const profiles = child(project, 'profiles')?.children.filter((node) => node.name === 'profile') ?? [];
    for (const profile of [null, ...profiles]) {
      const modules = child(profile ?? project, 'modules')?.children.filter((node) => node.name === 'module') ?? [];
      for (const module of modules) {
        const entry = insidePath(applicationRoot, basedir, module.text.trim());
        const target = safeJavaPath(applicationRoot, entry);
        pending.push(fs.statSync(target).isDirectory() ? path.posix.join(entry, 'pom.xml') : entry);
      }
    }
  }
  ensureUntrackedOutputs(applicationRoot, config, outputDirectories);
  return { poms: [...visited], outputDirectories: [...outputDirectories] };
}
