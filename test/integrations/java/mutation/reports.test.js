import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePitEffectivePom, parsePitReport } from '../../../../src/integrations/java/mutation/reports.js';
import { evaluatePitConfiguration } from '../../../../src/integrations/java/mutation/configuration.js';
import { effectivePom, mutationConfig, mutationXml, pitXml } from './fixture.js';

test('严格读取 PIT 原生状态、变异身份和 XML 编码', () => {
  const result = parsePitReport(pitXml(['KILLED', 'SURVIVED', 'NO_COVERAGE']));
  assert.equal(result.mutations.length, 3);
  assert.equal(result.mutations[0].testsRun, 1);
  for (const content of [
    '<mutations>', '<!DOCTYPE mutations [<!ENTITY x "evil">]><mutations/>',
    `<mutations>${mutationXml()}${mutationXml()}</mutations>`,
    pitXml(['UNKNOWN']), pitXml().replace('detected="true"', 'detected="false"'),
    pitXml().replace('numberOfTestsRun="1"', 'numberOfTestsRun="0"'),
    pitXml().replace('<lineNumber>3</lineNumber>', '<lineNumber>-1</lineNumber>'),
    pitXml().replace('<sourceFile>App.java</sourceFile>', '<sourceFile>../App.java</sourceFile>'),
    pitXml().replace('<killingTest>example.AppTest.value(example.AppTest)</killingTest>', '<killingTest/>'),
    pitXml().replace('<index>0</index>', '<index>0</index><index>0</index>'),
    Buffer.from([0xff, 0xfe]),
  ]) assert.throws(() => parsePitReport(content), (error) => error.kind === 'execution');
});
test('有效 POM 禁止跳过、历史复用、干运行和路径或目标配置偏移', () => {
  const config = mutationConfig();
  const module = config.modules[0];
  const inspect = (xml) => evaluatePitConfiguration(parsePitEffectivePom(xml), config, module, process.cwd());
  assert.doesNotThrow(() => inspect(effectivePom()));
  assert.doesNotThrow(() => inspect(effectivePom('<parseSurefireConfig>false</parseSurefireConfig><threads>2</threads><timeoutFactor>2.5</timeoutFactor><timeoutConstant>5000</timeoutConstant>')));
  for (const extra of ['<skip>true</skip>', '<dryRun>true</dryRun>', '<withHistory>true</withHistory>', '<skipFailingTests>true</skipFailingTests>', '<historyInputFile>old.bin</historyInputFile>', '<features><feature>+HISTORY</feature></features>', '<reportsDirectory>../other</reportsDirectory>', '<targetClasses><param>other.*</param></targetClasses>', '<outputFormats><param>HTML</param></outputFormats>', '<mutationThreshold>80</mutationThreshold>', '<crossModule>true</crossModule>', '<maxMutationsPerClass>1</maxMutationsPerClass>', '<mutators><mutator>VOID_METHOD_CALLS</mutator></mutators>', '<avoidCallsTo><param>example.*</param></avoidCallsTo>', '<mutationUnitSize>1</mutationUnitSize>', '<threads>0</threads>', '<timeoutFactor>NaN</timeoutFactor>', '<futureFilter>true</futureFilter>']) {
    assert.throws(() => inspect(effectivePom(`<parseSurefireConfig>false</parseSurefireConfig>${extra}`)), (error) => error.kind === 'configuration');
  }
  assert.throws(() => inspect(effectivePom('')), /parseSurefireConfig/);
  assert.throws(() => inspect(effectivePom().replace('1.17.3', '1.16.1')), /版本/);
  assert.throws(() => inspect(effectivePom().replace('</plugin>', '<executions><execution><id>test</id></execution></executions></plugin>')), /执行区块/);
  for (const name of ['avoidCallsTo', 'mutators', 'excludedClasses', 'historyInputFile', 'pit.dryRun', 'artifact', 'output', 'classpathDependencyExcludes', 'additionalClasspathElements', 'future.pit.setting']) {
    const xml = effectivePom().replace('<project>', `<project><properties><${name}>example.App</${name}></properties>`);
    if (name === 'future.pit.setting') assert.doesNotThrow(() => inspect(xml));
    else assert.throws(() => inspect(xml), /properties 包含工具属性/);
  }
  assert.doesNotThrow(() => inspect(effectivePom().replace('<project>', '<project><properties><repoGuard.mode>production</repoGuard.mode><maven.compiler.release>17</maven.compiler.release></properties>')));
});
