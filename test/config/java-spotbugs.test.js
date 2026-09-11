import test from 'node:test';
import assert from 'node:assert/strict';
import { JAVA_SPOTBUGS_SCHEMA_PROPERTIES, validateJavaSpotbugsChecks } from '../../src/config/java-spotbugs.js';

const configured = { enabled: true, pluginVersion: '4.10.3.0', modules: [{ name: 'api', reports: ['target/spotbugsXml.xml'] }] };
test('SpotBugs 默认关闭，启用必须固定插件版本和模块报告', () => {
  assert.equal(validateJavaSpotbugsChecks({}).javaSpotbugs.enabled, false);
  const result = validateJavaSpotbugsChecks({ javaSpotbugs: configured }).javaSpotbugs;
  assert.equal(result.priority, 'normal');
  assert.equal(result.offline, true);
  assert.deepEqual(result.excludeBugPatterns, []);
  assert.equal(JAVA_SPOTBUGS_SCHEMA_PROPERTIES.javaSpotbugs.properties.modules.items.properties.reports.maxItems, 1);
  for (const invalid of [
    null,
    { enabled: true }, { ...configured, pluginVersion: '' }, { ...configured, pluginVersion: 'LATEST' },
    { ...configured, priority: 'critical' }, { ...configured, excludeBugPatterns: ['NP_*'] },
    { ...configured, arguments: ['-Dspotbugs.skip=true'] }, { ...configured, arguments: ['-Dfindbugs.onlyAnalyze=Nothing'] },
    { ...configured, arguments: ['-Dartifact=example:other:1'] }, { ...configured, arguments: ['-Dordinary=true'] },
    { ...configured, modules: [{ name: 'api', reports: ['src/report.xml'] }] },
    { ...configured, modules: [{ name: 'api', reports: ['target/spotbugsXml.xml', 'target/other.xml'] }] },
    { ...configured, executable: './mvnw.cmd' },
    { ...configured, modules: [{ name: 'api', directory: '../outside', reports: ['target/spotbugsXml.xml'] }] },
  ]) assert.throws(() => validateJavaSpotbugsChecks({ javaSpotbugs: invalid }), (error) => error.kind === 'configuration');
});
