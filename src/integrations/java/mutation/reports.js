import { parseJavaXml as parseEffectiveXml } from '../engineering/reports.js';
import { assertJavaXmlNode, invalidJavaReport, javaReportInteger, parseJavaXml } from '../source/xml.js';
import { PIT_SCOPE_LIMITS } from '../../../config/java-mutation.js';

const scalarFields = ['sourceFile', 'mutatedClass', 'mutatedMethod', 'methodDescription', 'lineNumber', 'mutator', 'killingTest', 'description'];
const errorStatuses = new Set(['TIMED_OUT', 'NON_VIABLE', 'MEMORY_ERROR', 'NOT_STARTED', 'STARTED', 'RUN_ERROR', 'EQUIVALENT']);
function scalar(node, name) {
  const matches = node.children.filter((item) => item.name === name);
  if (matches.length !== 1) throw invalidJavaReport(`PIT ${name} 字段缺失或重复`);
  assertJavaXmlNode(matches[0], name, { text: true });
  if (name !== 'killingTest' && !matches[0].text.trim()) throw invalidJavaReport(`PIT ${name} 字段不能为空`);
  return matches[0].text.trim();
}
function integerList(node, name, entryName) {
  const matches = node.children.filter((item) => item.name === name);
  if (matches.length !== 1) throw invalidJavaReport(`PIT ${name} 字段缺失或重复`);
  assertJavaXmlNode(matches[0], name, { children: [entryName] });
  const values = matches[0].children.map((entry) => {
    assertJavaXmlNode(entry, entryName, { text: true });
    return javaReportInteger(entry.text.trim(), `PIT ${entryName}`, { minimum: 0 });
  });
  if (!values.length || new Set(values).size !== values.length) throw invalidJavaReport(`PIT ${name} 为空或重复`);
  return values;
}
function parseMutation(node) {
  assertJavaXmlNode(node, 'mutation', { attributes: ['detected', 'status', 'numberOfTestsRun'], required: ['detected', 'status', 'numberOfTestsRun'], children: [...scalarFields, 'indexes', 'blocks'] });
  const status = node.attributes.status;
  if (!['KILLED', 'SURVIVED', 'NO_COVERAGE'].includes(status) && !errorStatuses.has(status)) throw invalidJavaReport('PIT 包含未知变异状态');
  const detected = node.attributes.detected;
  const expectedDetected = ['KILLED', 'TIMED_OUT', 'NON_VIABLE', 'MEMORY_ERROR', 'RUN_ERROR', 'EQUIVALENT'].includes(status);
  if (detected !== String(expectedDetected)) throw invalidJavaReport('PIT 检测标记与状态不一致');
  const testsRun = javaReportInteger(node.attributes.numberOfTestsRun, 'PIT numberOfTestsRun', { minimum: 0 });
  const fields = Object.fromEntries(scalarFields.map((name) => [name, scalar(node, name)]));
  const indexes = integerList(node, 'indexes', 'index');
  integerList(node, 'blocks', 'block');
  const line = javaReportInteger(fields.lineNumber, 'PIT lineNumber');
  if (fields.mutatedClass.length > PIT_SCOPE_LIMITS.classNameLength || !/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(fields.mutatedClass) || /[/\\]/.test(fields.sourceFile)) throw invalidJavaReport('PIT 类名或源文件名无效或超过读取上限');
  if ((['KILLED', 'SURVIVED'].includes(status) && !testsRun)
      || (status === 'NO_COVERAGE' && testsRun !== 0)
      || (status === 'KILLED' && !fields.killingTest)
      || (['SURVIVED', 'NO_COVERAGE'].includes(status) && fields.killingTest)) throw invalidJavaReport('PIT 变异状态与测试执行证据不一致');
  return { status, testsRun, className: fields.mutatedClass, sourceFile: fields.sourceFile, line, method: fields.mutatedMethod, description: fields.description, identity: JSON.stringify([fields.mutatedClass, fields.mutatedMethod, fields.methodDescription, fields.mutator, indexes]) };
}
export function parsePitReport(content) {
  let decoded;
  try { decoded = Buffer.isBuffer(content) ? new TextDecoder('utf-8', { fatal: true }).decode(content) : content; }
  catch (cause) { throw invalidJavaReport('PIT 报告必须采用有效 UTF-8 编码', cause); }
  const root = parseJavaXml(decoded);
  assertJavaXmlNode(root, 'mutations', { attributes: ['partial'], children: ['mutation'] });
  if (root.attributes.partial !== undefined && !['true', 'false'].includes(root.attributes.partial)) throw invalidJavaReport('PIT partial 标记必须是布尔值');
  const mutations = root.children.map(parseMutation);
  if (new Set(mutations.map((entry) => entry.identity)).size !== mutations.length) throw invalidJavaReport('PIT 报告重复计数同一变异');
  return { mutations };
}

function child(node, name) { return node?.children.find((entry) => entry.name === name); }
function value(node, name) { return child(node, name)?.text.trim() ?? ''; }
function mergeControls(node) { return Boolean(node && (Object.keys(node.attributes).some((name) => name.startsWith('combine.')) || node.children.some(mergeControls))); }
export function parsePitEffectivePom(content) {
  const root = parseEffectiveXml(content, 'project');
  const plugins = child(child(root, 'build'), 'plugins')?.children.filter((node) => node.name === 'plugin') ?? [];
  const candidates = plugins.filter((node) => value(node, 'groupId') === 'org.pitest' && value(node, 'artifactId') === 'pitest-maven');
  if (candidates.length !== 1) return { configured: false };
  const plugin = candidates[0];
  const config = child(plugin, 'configuration');
  const executions = child(plugin, 'executions')?.children ?? [];
  return {
    properties: Object.fromEntries((child(root, 'properties')?.children ?? []).map((entry) => [entry.name, entry.text.trim()])),
    configured: true, version: value(plugin, 'version'), unsupportedMerging: mergeControls(plugin),
    executions: executions.map((entry) => value(entry, 'id')),
    configuration: Object.fromEntries((config?.children ?? []).map((entry) => [entry.name, entry.children.length ? entry.children.map((item) => item.text.trim()) : entry.text.trim()])),
    duplicateFields: new Set((config?.children ?? []).map((entry) => entry.name)).size !== (config?.children.length ?? 0),
  };
}
