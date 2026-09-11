import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotbugsReport } from '../../../../src/integrations/java/spotbugs/reports.js';
import { inspectSpotbugsEffectivePom } from '../../../../src/integrations/java/spotbugs/pom.js';
import { effectivePom, spotbugsFixture, spotbugsXml } from './fixture.js';

test('SpotBugs 原生报告保留缺陷、优先级和定位，并核验类与缺陷统计', () => {
  const parsed = parseSpotbugsReport(spotbugsXml({ bugs: [{ priority: 1 }, { type: 'DM_DEFAULT_ENCODING', priority: 3 }] }));
  assert.equal(parsed.bugs.length, 2);
  assert.equal(parsed.bugs[0].location.line, 3);
  assert.deepEqual(parsed.classes, ['example.App']);
  for (const invalid of [
    '', '<BugCollection>', '<!DOCTYPE BugCollection [<!ENTITY x SYSTEM "file:///etc/passwd">]><BugCollection>&x;</BugCollection>',
    spotbugsXml({ classes: [] }), spotbugsXml({ classes: ['example.App', 'example.App'] }),
    spotbugsXml({ errors: 1 }), spotbugsXml({ missingClasses: 1 }),
    spotbugsXml().replace('total_bugs="0"', 'total_bugs="1"'),
    spotbugsXml().replace('total_classes="1"', 'total_classes="2"'),
    spotbugsXml().replace('<Errors errors="0" missingClasses="0"/>', ''),
    spotbugsXml().replace('<Jar>target/classes</Jar>', ''),
    spotbugsXml().replace('priority_1="0"', 'priority_1="1"'),
    spotbugsXml({ bugs: [{ priority: 4 }] }),
  ]) assert.throws(() => parseSpotbugsReport(invalid), (error) => error.kind === 'execution');
});
test('有效 POM 中的跳过、过滤、检测器覆盖和引擎替换不得悄悄削弱 SpotBugs', (t) => {
  const { root, config } = spotbugsFixture(t);
  const context = { root, module: config.modules[0], config };
  assert.equal(inspectSpotbugsEffectivePom(effectivePom(root), context).classesDirectory, 'target/classes');
  for (const configuration of [
    '<configuration><skip>true</skip></configuration>',
    '<configuration><onlyAnalyze>Nothing</onlyAnalyze></configuration>',
    '<configuration><excludeFilterFile>ignore.xml</excludeFilterFile></configuration>',
    '<configuration><threshold>High</threshold></configuration>',
    '<configuration><effort>Min</effort></configuration>',
    '<configuration><visitors>FindNullDeref</visitors></configuration>',
    '<configuration combine.self="override"/>',
    '<dependencies><dependency/></dependencies>',
    '<executions><execution><id>default-cli</id><configuration><skip>true</skip></configuration></execution></executions>',
  ]) assert.throws(() => inspectSpotbugsEffectivePom(effectivePom(root, '.', configuration), context), (error) => error.kind === 'configuration');
  assert.throws(() => inspectSpotbugsEffectivePom(effectivePom(root).replace('</project>', '<properties><spotbugs.omitVisitors>FindNullDeref</spotbugs.omitVisitors></properties></project>'), context), /不得覆盖/);
});
test('SpotBugs 模块不能借用另一个模块的字节码或源码目录', (t) => {
  const { root, config } = spotbugsFixture(t, ['api', 'worker']);
  const context = { root, module: config.modules[0], config };
  const input = effectivePom(root, 'api');
  assert.throws(() => inspectSpotbugsEffectivePom(input.replace('/api/target/classes', '/worker/target/classes'), context), /当前模块/);
  assert.throws(() => inspectSpotbugsEffectivePom(input.replace('/api/src/main/java', '/worker/src/main/java'), context), /当前模块/);
});
