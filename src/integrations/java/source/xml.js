import { lstatSync, readFileSync } from 'node:fs';
import { SaxesParser } from 'saxes';
import { executionError, toRepoGuardError } from '../../../core/error/repo-guard-error.js';

const REPORT_LIMIT = 32 * 1024 * 1024;

export function invalidJavaReport(message, cause) {
  return executionError('java/invalid-native-report', `Java 原生报告不可用：${message}`, { cause });
}

/** 严格解析原生 XML，禁止 DTD、实体定义、重复属性及截断文档。 */
export function parseJavaXml(source) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > REPORT_LIMIT) {
    throw invalidJavaReport('报告为空或超过大小上限');
  }
  const parser = new SaxesParser({ xmlns: false });
  const stack = [];
  let document;
  let count = 0;
  parser.on('doctype', () => { throw invalidJavaReport('报告不得包含文档类型或外部实体'); });
  parser.on('processinginstruction', () => { throw invalidJavaReport('报告不得包含处理指令'); });
  parser.on('error', (error) => { throw invalidJavaReport('XML 结构不完整或不合法', error); });
  parser.on('opentag', (tag) => {
    if (++count > 500000 || stack.length > 32) throw invalidJavaReport('XML 结构超过解析上限');
    const node = { name: tag.name, attributes: tag.attributes, children: [], text: '' };
    if (stack.length) stack.at(-1).children.push(node);
    else if (document) throw invalidJavaReport('报告只能有一个根元素');
    else document = node;
    stack.push(node);
  });
  parser.on('closetag', () => stack.pop());
  const appendText = (text) => {
    if (stack.length) stack.at(-1).text += text;
    else if (text.trim()) throw invalidJavaReport('根元素之外包含文本');
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  try { parser.write(source).close(); } catch (cause) {
    if (cause?.code === 'java/invalid-native-report') throw toRepoGuardError(cause);
    throw invalidJavaReport('XML 解析失败', cause);
  }
  if (!document || stack.length) throw invalidJavaReport('报告缺少完整根元素');
  return document;
}

export function readJavaXmlReport(file) {
  try {
    const stats = lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > REPORT_LIMIT) {
      throw invalidJavaReport('报告必须是大小受限的普通文件');
    }
    return parseJavaXml(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)));
  } catch (cause) {
    if (cause?.code === 'java/invalid-native-report') throw toRepoGuardError(cause);
    throw invalidJavaReport('本次检查没有生成有效 UTF-8 XML 报告', cause);
  }
}

export function assertJavaXmlNode(node, name, { attributes = [], required = [], children = [], text = false } = {}) {
  if (node.name !== name || (!text && node.text.trim())
    || Object.keys(node.attributes).some((key) => !attributes.includes(key))
    || required.some((key) => typeof node.attributes[key] !== 'string' || !node.attributes[key].trim())
    || node.children.some((child) => !children.includes(child.name))) {
    throw invalidJavaReport(`${name} 元素或字段不符合当前原生格式`);
  }
}

export function javaReportInteger(value, label, { minimum = 1 } = {}) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    throw invalidJavaReport(`${label} 必须为有效整数`);
  }
  return Number(value);
}
