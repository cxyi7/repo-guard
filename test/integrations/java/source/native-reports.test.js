import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseJavaXml } from '../../../../src/integrations/java/source/xml.js';
import { parseJavaCheckstyleReport } from '../../../../src/integrations/java/source/checkstyle.js';
import { parseJavaPmdReport, parseJavaCpdReport } from '../../../../src/integrations/java/source/pmd.js';

const root = path.resolve('test/.tmp/java-report-scope');
const inputs = ['A.java', 'B.java'].map((relative) => ({ relative, absolute: path.join(root, relative) }));
const checkstyle = (files) => parseJavaXml(`<checkstyle version="10.21.4">${files}</checkstyle>`);
const options = { root, inputs, version: '10.21.4', ruleNames: ['TypeName'] };
const emptyFiles = '<file name="A.java"/><file name="B.java"/>';
const issue = '<error line="1" column="2" severity="error" message="Invalid name" source="com.puppycrawl.tools.checkstyle.checks.naming.TypeNameCheck"/>';

test('Java 原生 XML 拒绝截断、重复属性、实体、未知处理指令和额外根元素', () => {
  for (const source of ['', '<pmd>', '<pmd/><pmd/>', '<pmd a="1" a="2"/>', '<pmd>&undefined;</pmd>',
    '<!DOCTYPE pmd [<!ENTITY test SYSTEM "file:///secret">]><pmd>&test;</pmd>', '<?work run?><pmd/>',
  ]) assert.throws(() => parseJavaXml(source), { kind: 'execution' });
});

test('Checkstyle 原生报告须完整覆盖文件且只能报告本组规则', () => {
  assert.deepEqual(parseJavaCheckstyleReport(checkstyle(emptyFiles), options), []);
  const findings = parseJavaCheckstyleReport(checkstyle(`<file name="A.java">${issue}</file><file name="B.java"/>`), options);
  assert.equal(findings[0].rule, 'TypeName');
  assert.equal(findings[0].relative, 'A.java');
  for (const files of ['<file name="A.java"/>', '<file name="A.java"/><file name="A.java"/>', '<file name="../Outside.java"/>',
    `<file name="A.java">${issue.replace('line="1"', 'line="0"')}</file><file name="B.java"/>`,
    `<file name="A.java">${issue.replace('TypeNameCheck', 'TreeWalker')}</file><file name="B.java"/>`,
    `<file name="A.java">${issue.replace('severity="error"', 'severity="warning"')}</file><file name="B.java"/>`,
  ]) assert.throws(() => parseJavaCheckstyleReport(checkstyle(files), options), { kind: 'execution' });
});

const pmd = (content) => parseJavaXml(`<pmd version="7.10.0" timestamp="2026-09-11T00:00:00.000Z">${content}</pmd>`);
const pmdOptions = { root, inputs, version: '7.10.0', ruleNames: ['SystemPrintln'] };
const violation = '<violation beginline="1" endline="1" begincolumn="1" endcolumn="20" rule="SystemPrintln" ruleset="Best Practices" priority="3">Avoid console output</violation>';

test('PMD 违规仅接受合法位置、已启用规则与非空消息', () => {
  assert.equal(parseJavaPmdReport(pmd(`<file name="A.java">${violation}</file>`), pmdOptions).length, 1);
  assert.deepEqual(parseJavaPmdReport(pmd(''), pmdOptions), []);
  for (const content of ['<error filename="A.java" msg="parse"/>', '<configerror rule="Other"/>', '<suppressedviolation filename="A.java"/>',
    `<file name="A.java">${violation.replace('priority="3"', 'priority="0"')}</file>`,
    `<file name="A.java">${violation.replace('beginline="1"', 'beginline="2"')}</file>`,
    `<file name="A.java">${violation.replace('SystemPrintln', 'UnexpectedRule')}</file>`,
    `<file name="A.java">${violation.replace('Avoid console output', '')}</file>`,
  ]) assert.throws(() => parseJavaPmdReport(pmd(content), pmdOptions), { kind: 'execution' });
});

test('CPD 拒绝错误报告、范围外位置和不完整重复块', () => {
  const duplication = '<duplication lines="2" tokens="100"><file path="A.java" line="1"/><file path="B.java" line="3"/><codefragment><![CDATA[class A {}]]></codefragment></duplication>';
  const cpd = (content, summaries = '<file path="A.java" totalNumberOfTokens="100"/><file path="B.java" totalNumberOfTokens="200"/>') => parseJavaXml(`<pmd-cpd version="1.0.0" pmdVersion="7.10.0" timestamp="2026-09-11T00:00:00.000Z">${content}${summaries}</pmd-cpd>`);
  const cpdOptions = { root, inputs, version: '7.10.0', minimumTokens: 100 };
  assert.equal(parseJavaCpdReport(cpd(duplication), cpdOptions)[0].tokens, 100);
  assert.throws(() => parseJavaCpdReport(cpd('', ''), cpdOptions), { kind: 'execution' });
  assert.throws(() => parseJavaCpdReport(parseJavaXml('<pmd-cpd/>'), cpdOptions), { kind: 'execution' });
  assert.throws(() => parseJavaCpdReport(cpd('', '<file path="A.java" totalNumberOfTokens="100"/><file path="A.java" totalNumberOfTokens="200"/>'), cpdOptions), { kind: 'execution' });
  for (const content of ['<error/>', '<processingerror/>', duplication.replace('tokens="100"', 'tokens="99"'),
    duplication.replace('path="B.java"', 'path="../Outside.java"'), duplication.replace('line="3"', 'line="0"'),
    duplication.replace('<file path="B.java" line="3"/>', ''), duplication.replace('class A {}', ''),
  ]) assert.throws(() => parseJavaCpdReport(cpd(content), cpdOptions), { kind: 'execution' });
});
