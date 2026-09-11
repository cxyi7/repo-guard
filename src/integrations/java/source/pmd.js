import { javaReportedPath } from './files.js';
import { assertJavaXmlNode, invalidJavaReport, javaReportInteger } from './xml.js';

const PMD_NAMESPACE_ATTRIBUTES = ['xmlns', 'xmlns:xsi', 'xsi:schemaLocation'];

function versionMatches(document, version) {
  if (document.attributes.version !== version) throw invalidJavaReport('PMD 报告版本与执行工具不一致');
}

function failOnReportError(document) {
  if (document.children.some((node) => ['error', 'configerror', 'processingerror'].includes(node.name))) {
    throw invalidJavaReport('PMD 报告存在解析错误、执行错误或规则配置错误');
  }
  if (document.children.some((node) => node.name === 'suppressedviolation')) {
    throw invalidJavaReport('PMD 报告存在被源码抑制的必需规则；请移除抑制后重新检查');
  }
}

export function parseJavaPmdReport(document, { root, inputs, ruleNames, version }) {
  assertJavaXmlNode(document, 'pmd', {
    attributes: ['version', 'timestamp', ...PMD_NAMESPACE_ATTRIBUTES],
    required: ['version', 'timestamp'],
    children: ['file', 'error', 'configerror', 'suppressedviolation'],
  });
  versionMatches(document, version);
  if (!Number.isFinite(Date.parse(document.attributes.timestamp))) throw invalidJavaReport('PMD 报告时间无效');
  failOnReportError(document);
  const seen = new Set();
  return document.children.flatMap((file) => {
    assertJavaXmlNode(file, 'file', { attributes: ['name'], required: ['name'], children: ['violation'] });
    const relative = javaReportedPath(file.attributes.name, inputs, root);
    if (seen.has(relative)) throw invalidJavaReport('PMD 报告重复声明同一个文件');
    seen.add(relative);
    return file.children.map((violation) => {
      assertJavaXmlNode(violation, 'violation', {
        attributes: ['beginline', 'endline', 'begincolumn', 'endcolumn', 'rule', 'ruleset', 'package', 'class', 'method', 'variable', 'externalInfoUrl', 'priority'],
        required: ['beginline', 'endline', 'begincolumn', 'endcolumn', 'rule', 'ruleset', 'priority'], text: true,
      });
      const attributes = violation.attributes;
      const line = javaReportInteger(attributes.beginline, 'PMD 起始行');
      const endLine = javaReportInteger(attributes.endline, 'PMD 结束行');
      const column = javaReportInteger(attributes.begincolumn, 'PMD 起始列');
      const endColumn = javaReportInteger(attributes.endcolumn, 'PMD 结束列');
      const priority = javaReportInteger(attributes.priority, 'PMD 优先级');
      if (!ruleNames.includes(attributes.rule) || priority > 5 || endLine < line
        || (endLine === line && endColumn < column) || !violation.text.trim()) {
        throw invalidJavaReport('PMD 违规规则、文本或位置字段不合法');
      }
      return { relative, rule: attributes.rule, line, column, endLine, endColumn, rawMessage: violation.text.trim() };
    });
  });
}

export function parseJavaCpdReport(document, { root, inputs, version, minimumTokens }) {
  assertJavaXmlNode(document, 'pmd-cpd', {
    attributes: ['version', 'timestamp', 'pmdVersion', ...PMD_NAMESPACE_ATTRIBUTES],
    required: ['version', 'timestamp', 'pmdVersion'],
    children: ['duplication', 'file', 'error', 'processingerror'],
  });
  // CPD 的 version 表示 XML 格式版本，pmdVersion 才表示运行工具版本。
  if (document.attributes.pmdVersion !== version || document.attributes.version !== '1.0.0'
    || !Number.isFinite(Date.parse(document.attributes.timestamp))) {
    throw invalidJavaReport('CPD 报告版本与执行工具不一致');
  }
  failOnReportError(document);
  const findings = [];
  const checkedFiles = new Set();
  for (const node of document.children) {
    if (node.name === 'file') {
      assertJavaXmlNode(node, 'file', { attributes: ['path', 'totalNumberOfTokens'], required: ['path', 'totalNumberOfTokens'] });
      const relative = javaReportedPath(node.attributes.path, inputs, root);
      if (checkedFiles.has(relative)) throw invalidJavaReport('CPD 报告重复声明已检查文件');
      checkedFiles.add(relative);
      javaReportInteger(node.attributes.totalNumberOfTokens, 'CPD 文件词法标记数量', { minimum: 0 });
      continue;
    }
    assertJavaXmlNode(node, 'duplication', { attributes: ['lines', 'tokens'], required: ['lines', 'tokens'], children: ['file', 'codefragment'] });
    const tokens = javaReportInteger(node.attributes.tokens, 'CPD 重复词法标记数量');
    const lines = javaReportInteger(node.attributes.lines, 'CPD 重复行数');
    const files = node.children.filter((entry) => entry.name === 'file');
    const fragments = node.children.filter((entry) => entry.name === 'codefragment');
    if (tokens < minimumTokens || files.length < 2 || fragments.length !== 1) {
      throw invalidJavaReport('CPD 重复块未达到门槛或缺少完整位置与代码片段');
    }
    assertJavaXmlNode(fragments[0], 'codefragment', { text: true });
    if (!fragments[0].text.trim()) throw invalidJavaReport('CPD 重复代码片段为空');
    const locations = files.map((file) => {
      assertJavaXmlNode(file, 'file', {
        attributes: ['line', 'endline', 'column', 'endcolumn', 'begintoken', 'endtoken', 'path'], required: ['line', 'path'],
      });
      const line = javaReportInteger(file.attributes.line, 'CPD 起始行');
      for (const name of ['endline', 'column', 'endcolumn', 'begintoken', 'endtoken']) {
        if (file.attributes[name] !== undefined) javaReportInteger(file.attributes[name], `CPD ${name}`, { minimum: name.endsWith('token') ? 0 : 1 });
      }
      if (file.attributes.endline !== undefined && Number(file.attributes.endline) < line) throw invalidJavaReport('CPD 结束行早于起始行');
      if (file.attributes.begintoken !== undefined && file.attributes.endtoken !== undefined
        && Number(file.attributes.endtoken) < Number(file.attributes.begintoken)) throw invalidJavaReport('CPD 结束标记早于起始标记');
      if (Number(file.attributes.endline) === line && file.attributes.column !== undefined && file.attributes.endcolumn !== undefined
        && Number(file.attributes.endcolumn) < Number(file.attributes.column)) throw invalidJavaReport('CPD 结束列早于起始列');
      return { relative: javaReportedPath(file.attributes.path, inputs, root), line };
    });
    if (new Set(locations.map(({ relative, line }) => `${relative}:${line}`)).size !== locations.length) {
      throw invalidJavaReport('CPD 重复块包含重复位置');
    }
    findings.push({ ...locations[0], rule: 'cpd', tokens, lines, locations });
  }
  if (checkedFiles.size !== inputs.length) throw invalidJavaReport('CPD 报告未完整列出所有受检文件');
  return findings;
}
