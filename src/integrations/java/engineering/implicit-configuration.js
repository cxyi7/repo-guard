import fs from 'node:fs';
import path from 'node:path';
import { configurationError, toRepoGuardError } from '../../../core/error/repo-guard-error.js';
import { safeJavaPath } from './files.js';

const JVM_ENVIRONMENT = ['MAVEN_OPTS', 'MAVEN_DEBUG_OPTS', 'JVM_CONFIG_MAVEN_PROPS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'];
const FORBIDDEN_ENVIRONMENT = ['MAVEN_ARGS', 'MAVEN_CONFIG', 'MAVEN_BASEDIR', 'MAVEN_PROJECTBASEDIR', 'MAVEN_EXT_CLASS_PATH', 'JDK_JAVAC_OPTIONS', 'MAVEN_BATCH_PAUSE'];
const MEMORY_OPTION = /^(?:-X(?:ms|mx|ss)[1-9]\d*[kKmMgG]?|-XX:(?:MaxMetaspaceSize|MetaspaceSize|ReservedCodeCacheSize)=[1-9]\d*[kKmMgG]?)$/;
const CONTROL_PROPERTY = /^-D(?:maven\.(?:multiModuleProjectDirectory|ext\.class\.path|home|conf)|classworlds\.conf|user\.home|java\.home|artifact|project|plugin\.artifactMap)(?:=|$)/i;

function reject(source) {
  throw configurationError('java/maven-implicit-options', `${source} 包含未受支持的 Maven 隐式配置，可能改变必需检查；请将所需检查参数迁入 repo-guard 显式配置，不能通过隐藏参数跳过或缩小检查`);
}
function value(env, name, platform) {
  if (platform !== 'win32') return env[name] ?? '';
  return Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] ?? '';
}
function memoryOptions(source, label) {
  if (source.trim() && source.trim().split(/\s+/).some((option) => !MEMORY_OPTION.test(option))) reject(label);
}
function stat(file) {
  try { return fs.lstatSync(file); } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw toRepoGuardError(cause, { kind: 'configuration', code: 'java/maven-implicit-unreadable', message: `无法核验 Maven 隐式配置路径：${file}` });
  }
}
function read(file) {
  const metadata = stat(file);
  if (!metadata) return '';
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) reject(file);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); } catch (cause) {
    throw toRepoGuardError(cause, { kind: 'configuration', code: 'java/maven-implicit-unreadable', message: `无法核验 Maven 隐式配置文件：${file}` });
  }
}
function discover(directory) {
  let current = directory;
  while (true) {
    const candidate = path.join(current, '.mvn');
    const metadata = stat(candidate);
    if (metadata) {
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) reject(candidate);
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function inspectRc(env, platform) {
  if (value(env, 'MAVEN_SKIP_RC', platform)) return;
  const home = value(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform);
  const files = platform === 'win32'
    ? (home ? ['mavenrc_pre.bat', 'mavenrc_pre.cmd', 'mavenrc_post.bat', 'mavenrc_post.cmd', 'mavenrc.cmd', 'mavenrc.bat'].map((name) => path.join(home, name)) : [])
    : ['/usr/local/etc/mavenrc', '/etc/mavenrc', ...(home ? [path.join(home, '.mavenrc')] : [])];
  for (const file of files) {
    if (read(file).trim()) throw configurationError('java/maven-rc-script', `检测到 Maven RC 脚本：${file}。工程检查不执行 RC，也不会静默丢弃其中的环境配置；请显式准备工具环境后设置 MAVEN_SKIP_RC=1，再运行检查`);
  }
}

/** 与 Maven 3 启动脚本一致，从 -f 所在目录向上发现 .mvn；不把应用边界误当作 Maven 的搜索边界。 */
export function inspectMavenImplicitConfiguration(root, config, { env = process.env, platform = process.platform } = {}) {
  for (const name of FORBIDDEN_ENVIRONMENT) if (value(env, name, platform)) reject(`环境变量 ${name}`);
  for (const name of JVM_ENVIRONMENT) memoryOptions(value(env, name, platform), `环境变量 ${name}`);
  if (config.arguments?.some((argument) => CONTROL_PROPERTY.test(argument))) reject('arguments 中的 Maven 启动控制属性');
  inspectRc(env, platform);
  const pom = safeJavaPath(root, config.pom);
  const logical = path.dirname(pom);
  const physical = fs.realpathSync(logical);
  const directories = [...new Set([discover(logical), discover(physical)].filter(Boolean))];
  for (const directory of directories) {
    const mavenConfig = path.join(directory, 'maven.config');
    if (read(mavenConfig).split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith('#'))) reject(mavenConfig);
    memoryOptions(read(path.join(directory, 'jvm.config')), path.join(directory, 'jvm.config'));
  }
  return { directories };
}

export function mavenProcessEnvironment(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'MAVEN_SKIP_RC')), MAVEN_SKIP_RC: '1' };
}
