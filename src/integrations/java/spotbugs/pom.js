import path from 'node:path';
import { configurationError } from '../../../core/error/repo-guard-error.js';
import { safeJavaPath } from '../engineering/files.js';
import { parseJavaXml } from '../engineering/reports.js';

const controlledSettings = Object.freeze({
  skip: 'false', noClassOk: 'false', skipEmptyReport: 'false', failOnError: 'true',
  xmlOutput: 'true', includeTests: 'false', effort: 'Max', threshold: 'Low', relaxed: 'false',
});
const harmlessSettings = new Set(['maxHeap', 'timeout', 'fork', 'debug', 'htmlOutput', 'sarifOutput']);
function child(node, name) { return node?.children.find((item) => item.name === name); }
function text(node, name) { return child(node, name)?.text.trim() ?? ''; }
function reject(message) { throw configurationError('java/spotbugs-pom-configuration', message); }
function validateConfiguration(node) {
  if (!node) return;
  if (Object.keys(node.attributes).length) reject('SpotBugs 配置不支持自定义合并控制');
  for (const item of node.children) {
    if (Object.keys(item.attributes).length || item.children.length) reject('SpotBugs 配置不得包含筛选、插件扩展或合并控制');
    if (Object.hasOwn(controlledSettings, item.name)) {
      if (item.text.trim() !== controlledSettings[item.name]) reject(`SpotBugs ${item.name} 必须为 ${controlledSettings[item.name]}`);
    } else if (!harmlessSettings.has(item.name)) {
      reject(`SpotBugs 配置 ${item.name} 会改变检查范围或输出；请移除该覆盖，规则豁免使用 excludeBugPatterns`);
    }
  }
}
function projectPath(root, value) {
  if (!value || /\$\{|[\0\r\n]/.test(value)) reject('SpotBugs 编译与源码目录必须是已解析的具体路径');
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').some((item) => item.toLowerCase() === '.git')) {
    reject('SpotBugs 编译与源码目录必须位于当前应用内部');
  }
  safeJavaPath(root, relative, { required: false });
  return relative;
}
export function inspectSpotbugsEffectivePom(content, { root, module, config }) {
  const project = parseJavaXml(content, 'project');
  if ((text(project, 'packaging') || 'jar') === 'pom') reject(`模块 ${module.name} 是聚合 POM，必须声明实际包含生产类的模块`);
  const build = child(project, 'build');
  const prefix = module.directory === '.' ? '' : `${module.directory}/`;
  if (projectPath(root, text(build, 'directory')) !== `${prefix}target`) reject('SpotBugs 当前要求模块构建目录为 target，避免报告路径与执行范围不一致');
  const plugins = child(build, 'plugins')?.children.filter((item) => item.name === 'plugin') ?? [];
  const matches = plugins.filter((plugin) => text(plugin, 'groupId') === 'com.github.spotbugs' && text(plugin, 'artifactId') === 'spotbugs-maven-plugin');
  if (matches.length > 1) reject('SpotBugs 插件声明重复，无法确定实际配置');
  for (const plugin of matches) {
    if (text(plugin, 'version') !== config.pluginVersion) reject('SpotBugs 插件版本与 repo-guard 中固定的版本不一致');
    if (child(plugin, 'dependencies')?.children.length) reject('SpotBugs 插件不支持覆盖原生引擎或注入额外插件依赖');
    validateConfiguration(child(plugin, 'configuration'));
    for (const execution of child(plugin, 'executions')?.children ?? []) {
      validateConfiguration(child(execution, 'configuration'));
    }
  }
  for (const property of child(project, 'properties')?.children ?? []) {
    if (/^(?:artifact|output|project|plugin\.artifactMap|maven\.(?:multiModuleProjectDirectory|ext\.class\.path))$/i.test(property.name)) {
      reject(`Maven 属性 ${property.name} 不得改变有效 POM 的采集目标或执行边界`);
    }
    if (/^(?:spotbugs|findbugs)\./i.test(property.name)) {
      const setting = property.name.replace(/^spotbugs\./, '');
      if (!Object.hasOwn(controlledSettings, setting) || controlledSettings[setting] !== property.text.trim()) {
        reject(`Maven 属性 ${property.name} 不得覆盖 SpotBugs 必需检查`);
      }
    }
  }
  const classesDirectory = projectPath(root, text(build, 'outputDirectory'));
  const sourceDirectory = projectPath(root, text(build, 'sourceDirectory'));
  if (!classesDirectory.startsWith(`${prefix}target/`) || (prefix && !sourceDirectory.startsWith(prefix))) {
    reject(`模块 ${module.name} 的编译与源码目录必须属于当前模块，不能复用其他模块的输入`);
  }
  return { classesDirectory, sourceDirectory };
}
