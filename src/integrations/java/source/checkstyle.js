import { javaReportedPath } from './files.js';
import { assertJavaXmlNode, invalidJavaReport, javaReportInteger } from './xml.js';

/** 单次 Checkstyle XML 必须覆盖全部传入文件，且只包含本功能要求的规则。 */
export function parseJavaCheckstyleReport(document, { root, inputs, ruleNames, version }) {
  assertJavaXmlNode(document, 'checkstyle', { attributes: ['version'], required: ['version'], children: ['file'] });
  if (document.attributes.version !== version) throw invalidJavaReport('Checkstyle 报告版本与执行工具不一致');
  const checked = new Set();
  const findings = document.children.flatMap((file) => {
    assertJavaXmlNode(file, 'file', { attributes: ['name'], required: ['name'], children: ['error'] });
    const relative = javaReportedPath(file.attributes.name, inputs, root);
    if (checked.has(relative)) throw invalidJavaReport('Checkstyle 报告重复声明同一个文件');
    checked.add(relative);
    return file.children.map((issue) => {
      assertJavaXmlNode(issue, 'error', { attributes: ['line', 'column', 'severity', 'message', 'source'], required: ['line', 'severity', 'message', 'source'] });
      const rule = /\.([^.]+)Check$/.exec(issue.attributes.source)?.[1];
      if (!ruleNames.includes(rule) || issue.attributes.severity !== 'error') {
        throw invalidJavaReport('Checkstyle 检查未完整执行或包含不属于本功能的规则');
      }
      return {
        relative, rule,
        line: javaReportInteger(issue.attributes.line, 'Checkstyle 行号'),
        ...(issue.attributes.column === undefined ? {} : { column: javaReportInteger(issue.attributes.column, 'Checkstyle 列号') }),
        rawMessage: issue.attributes.message,
      };
    });
  });
  if (checked.size !== inputs.length) throw invalidJavaReport('Checkstyle 没有报告全部受控 Java 文件');
  return findings;
}
