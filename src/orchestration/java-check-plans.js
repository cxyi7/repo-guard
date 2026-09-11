// Java 只声明自己的生命周期步骤；各个检查的实现与配置保持独立。
const JAVA_SOURCE_GATE_IDS = Object.freeze([
  'java.format',
  'java.naming',
  'java.layout',
  'java.imports',
  'java.size',
  'java.docs',
  'java.lint',
]);

export const JAVA_SOURCE_STEPS = Object.freeze(JAVA_SOURCE_GATE_IDS.map((gateId) => (
  Object.freeze({ id: gateId, gateId, mutation: 'read-only' })
)));

export const JAVA_ENGINEERING_STEPS = Object.freeze([
  'java.duplication',
  'java.dependencies',
  'java.compile',
  'java.spotbugs',
  'java.architecture',
  'java.test',
  'java.coverage',
  'java.mutation-test',
  'java.build',
]);

export const JAVA_QUALITY_STEPS = Object.freeze([
  { id: 'java.format-fix', gateId: 'java.format', mutation: 'working-tree-fix' },
  ...JAVA_SOURCE_STEPS,
  { id: 'java.files', gateId: 'java.files', mutation: 'read-only' },
  { id: 'java.path-naming', gateId: 'java.path-naming', mutation: 'read-only' },
].map(Object.freeze));
