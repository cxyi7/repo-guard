import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectMavenImplicitConfiguration, mavenProcessEnvironment } from '../../../../src/integrations/java/engineering/implicit-configuration.js';
import { inspectJavaEngineeringSetup } from '../../../../src/integrations/java/engineering/collect.js';
import { executeMaven } from '../../../../src/integrations/java/engineering/process.js';

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-maven-options-'));
  const root = path.join(parent, 'app');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, config: { pom: 'pom.xml', executable: process.execPath, arguments: [], modules: [], timeoutMs: 1000 } };
}
function writeConfig(directory, name, value) {
  fs.mkdirSync(path.join(directory, '.mvn'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.mvn', name), value);
}
test('共享 Maven 预检拒绝应用或应用外祖先的隐式命令参数', (t) => {
  const { parent, root, config } = fixture(t);
  writeConfig(parent, 'maven.config', '-Dspotbugs.omitVisitors=FindNullDeref');
  assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: {} }), /maven.config/);
  writeConfig(root, 'maven.config', '# 当前 Maven 3.9 项目\n');
  assert.doesNotThrow(() => inspectMavenImplicitConfiguration(root, config, { env: {} }));
  writeConfig(root, 'maven.config', '-DexcludedClasses=example.*');
  assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: {} }), /隐式配置/);
});
test('共享 Maven 预检按每次 -f 目录发现最近的 .mvn，并核验模块入口', (t) => {
  const { root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'api'));
  fs.writeFileSync(path.join(root, 'api/pom.xml'), '<project/>');
  writeConfig(root, 'maven.config', '');
  writeConfig(path.join(root, 'api'), 'maven.config', '-Dspotbugs.skip=true');
  assert.doesNotThrow(() => inspectMavenImplicitConfiguration(root, config, { env: {} }));
  assert.throws(() => inspectMavenImplicitConfiguration(root, { ...config, pom: 'api/pom.xml' }, { env: {} }), /maven.config/);
  assert.throws(() => inspectJavaEngineeringSetup(root, { ...config, modules: [{ name: 'api', directory: 'api' }] }, { verifyTools: false }), /maven.config/);
});
test('环境与 JVM 配置只允许严格资源参数，拒绝系统属性、代理与参数文件', (t) => {
  const { root, config } = fixture(t);
  for (const name of ['MAVEN_ARGS', 'MAVEN_CONFIG', 'MAVEN_BASEDIR', 'MAVEN_PROJECTBASEDIR', 'MAVEN_EXT_CLASS_PATH', 'JDK_JAVAC_OPTIONS', 'MAVEN_BATCH_PAUSE']) {
    assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: { [name]: 'override' } }), new RegExp(name));
  }
  for (const name of ['MAVEN_OPTS', 'MAVEN_DEBUG_OPTS', 'JVM_CONFIG_MAVEN_PROPS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']) {
    assert.doesNotThrow(() => inspectMavenImplicitConfiguration(root, config, { env: { [name]: '-Xms64m -Xmx512m -Xss1m -XX:MaxMetaspaceSize=256m' } }));
    for (const option of ['-Dspotbugs.omitVisitors=FindNullDeref', '-javaagent:ignore.jar', '@hidden.args', '-Xmx512m&echo']) {
      assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: { [name]: option } }), new RegExp(name));
    }
  }
  writeConfig(root, 'jvm.config', '-Xmx512m\n-Xss1m');
  assert.doesNotThrow(() => inspectMavenImplicitConfiguration(root, config, { env: {} }));
  writeConfig(root, 'jvm.config', '-Dspotbugs.omitVisitors=FindNullDeref');
  assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: {} }), /jvm.config/);
});
test('Maven RC 不被隐式执行，也不静默丢弃现有脚本配置', (t) => {
  const { parent, root, config } = fixture(t);
  fs.writeFileSync(path.join(parent, 'mavenrc_pre.cmd'), 'set MAVEN_OPTS=-Dspotbugs.omitVisitors=FindNullDeref');
  const env = { USERPROFILE: parent };
  assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env, platform: 'win32' }), /RC 脚本/);
  assert.doesNotThrow(() => inspectMavenImplicitConfiguration(root, config, { env: { ...env, MAVEN_SKIP_RC: '1' }, platform: 'win32' }));
  assert.equal(mavenProcessEnvironment(env).MAVEN_SKIP_RC, '1');
  assert.deepEqual(env, { USERPROFILE: parent });
});
test('共享执行入口每次重新预检并传入禁止 RC 的环境，不启动含隐式参数的进程', async (t) => {
  const { root, config } = fixture(t);
  let calls = 0;
  await executeMaven({ root, config, goals: ['compile'], runProcess: async (input) => {
    calls += 1;
    assert.equal(input.env.MAVEN_SKIP_RC, '1');
    return { status: 0, stdout: '', stderr: '' };
  } });
  writeConfig(root, 'maven.config', '-Dspotbugs.omitVisitors=FindNullDeref');
  await assert.rejects(executeMaven({ root, config, goals: ['compile'], runProcess: async () => { calls += 1; return { status: 0 }; } }), (error) => error.kind === 'configuration');
  assert.equal(calls, 1);
});
test('启动控制属性与指向其他文件的隐式配置符号链接不能绕过预检', (t) => {
  const { parent, root, config } = fixture(t);
  for (const argument of ['-Dmaven.multiModuleProjectDirectory=elsewhere', '-Dmaven.ext.class.path=ignore.jar', '-Dartifact=example:other:1', '-Duser.home=elsewhere']) {
    assert.throws(() => inspectMavenImplicitConfiguration(root, { ...config, arguments: [argument] }, { env: {} }), /启动控制/);
  }
  const target = path.join(parent, 'hidden');
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(root, '.mvn'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inspectMavenImplicitConfiguration(root, config, { env: {} }), /隐式配置/);
});
