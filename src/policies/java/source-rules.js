import { configurationError } from '../../core/error/repo-guard-error.js';

export const JAVA_SOURCE_FEATURES = Object.freeze([
  ['javaFormat', 'java.format', 'java-format', 'Java 格式'],
  ['javaNaming', 'java.naming', 'java-naming', 'Java 命名'],
  ['javaLayout', 'java.layout', 'java-layout', 'Java 代码结构'],
  ['javaImports', 'java.imports', 'java-imports', 'Java 导入'],
  ['javaSize', 'java.size', 'java-size', 'Java 规模'],
  ['javaDocs', 'java.docs', 'java-docs', 'Java 文档'],
  ['javaLint', 'java.lint', 'java-lint', 'Java 源码规则'],
  ['javaDuplication', 'java.duplication', 'java-duplication', 'Java 重复代码'],
].map(([feature, id, command, label]) => Object.freeze({ feature, id, command, label })));

const check = (name, properties = {}) => ({ name, properties });

const NAMING = [
  check('PackageName', { format: '^[a-z]+(\\.[a-z][a-z0-9]*)*$' }),
  ...['TypeName'].map((name) => check(name, { format: '^[A-Z][a-zA-Z0-9]*$' })),
  ...['MethodName', 'MemberName', 'StaticVariableName', 'LocalVariableName', 'ParameterName', 'CatchParameterName'].map((name) => check(name, { format: '^[a-z][a-zA-Z0-9]*$' })),
  check('ConstantName'),
];
const LAYOUT = [
  check('PackageDeclaration', { matchDirectoryStructure: true }),
  check('OneTopLevelClass'),
  ...[
  'NeedBraces', 'OneStatementPerLine', 'MultipleVariableDeclarations',
  'ModifierOrder', 'OuterTypeFilename', 'EmptyStatement',
  ].map((name) => check(name)),
];
const IMPORTS = [
  check('AvoidStarImport'), check('RedundantImport'), check('UnusedImports'),
  check('IllegalImport', { illegalPkgs: 'sun,jdk.internal' }),
];

export const JAVA_LINT_RULES = Object.freeze([
  { name: 'BrokenNullCheck', category: 'errorprone', message: '空值判断的逻辑运算符导致空引用仍被访问' },
  { name: 'AvoidPrintStackTrace', category: 'bestpractices', message: '不得直接调用 printStackTrace 输出异常堆栈' },
  { name: 'EmptyCatchBlock', category: 'errorprone', message: '捕获异常后不能只留下空代码块', properties: { allowCommentedBlocks: 'false', allowExceptionNameRegex: '^$' } },
  { name: 'SystemPrintln', category: 'bestpractices', message: '不得直接调用 System.out 或 System.err 的打印方法' },
]);

function sizeRules(config) {
  return [
    check('MethodLength', { max: config.maxMethodLines, countEmpty: true }),
    check('ParameterNumber', { max: config.maxParameters }),
    check('CyclomaticComplexity', { max: config.maxCyclomaticComplexity }),
    ...['NestedIfDepth', 'NestedForDepth', 'NestedTryDepth'].map((name) => check(name, { max: config.maxNestingDepth })),
  ];
}

function documentationRules(config) {
  const scopes = ['public', 'protected', 'package', 'private'];
  return [
    check('MissingJavadocType', { scope: config.scope }),
    check('MissingJavadocMethod', { scope: config.scope, allowMissingPropertyJavadoc: false }),
    check('JavadocMethod', { accessModifiers: scopes.slice(0, scopes.indexOf(config.scope) + 1).join(','), validateThrows: false }),
    check('InvalidJavadocPosition'),
  ];
}

export function javaCheckstyleRules(feature, config) {
  const rules = {
    javaNaming: NAMING, javaLayout: LAYOUT, javaImports: IMPORTS,
    javaSize: sizeRules(config), javaDocs: documentationRules(config),
  }[feature];
  if (!rules) throw configurationError('java/source-rule', `不存在 Java 源码规则：${feature}`);
  return {
    checker: feature === 'javaSize' ? [check('FileLength', { max: config.maxFileLines })] : [],
    treeWalker: rules,
  };
}

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function moduleXml({ name, properties }) {
  return `<module name="${name}">${Object.entries(properties).map(([key, value]) => `<property name="${key}" value="${xml(value)}"/>`).join('')}</module>`;
}

export function javaCheckstyleConfiguration(feature, config) {
  const rules = javaCheckstyleRules(feature, config);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE module PUBLIC "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN" "https://checkstyle.org/dtds/configuration_1_3.dtd">\n'
    + `<module name="Checker"><property name="charset" value="UTF-8"/><property name="severity" value="error"/>${rules.checker.map(moduleXml).join('')}<module name="TreeWalker">${rules.treeWalker.map(moduleXml).join('')}</module></module>\n`;
}

export function javaPmdConfiguration() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<ruleset name="repo-guard Java" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"><description>Java 通用源码确定性规则</description>'
    + JAVA_LINT_RULES.map(({ name, category, properties = {} }) => `<rule ref="category/java/${category}.xml/${name}"><properties>${Object.entries(properties).map(([key, value]) => `<property name="${key}" value="${xml(value)}"/>`).join('')}</properties></rule>`).join('')
    + '</ruleset>\n';
}

export function javaSourceRuleMessage(feature, rule) {
  if (feature === 'javaLint') return JAVA_LINT_RULES.find((entry) => entry.name === rule)?.message ?? `Java 源码违反规则 ${rule}`;
  const label = JAVA_SOURCE_FEATURES.find((entry) => entry.feature === feature)?.label ?? 'Java 源码';
  return `${label}不符合 ${rule} 规则`;
}
