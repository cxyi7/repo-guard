import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectFunctionDocumentationFiles,
  synchronizeFunctionDocumentationContent,
} from '../src/policies/function-documentation.js';

test('只选择 include 内、未被 exclude 排除且扩展名已启用的函数文档文件', () => {
  const files = [
    { relative: 'src/app.vue', absolute: 'C:/repo/src/app.vue' },
    { relative: 'src/generated/model.ts', absolute: 'C:/repo/src/generated/model.ts' },
    { relative: 'src/main.js', absolute: 'C:/repo/src/main.js' },
    { relative: 'src/main.test.js', absolute: 'C:/repo/src/main.test.js' },
    { relative: 'src/readme.md', absolute: 'C:/repo/src/readme.md' },
    { relative: 'test/main.ts', absolute: 'C:/repo/test/main.ts' },
  ];

  assert.deepEqual(selectFunctionDocumentationFiles(files, {
    enabled: true,
    include: ['src/**'],
    exclude: ['src/generated/**', '**/*.test.*'],
    extensions: ['.vue', '.js', '.ts'],
  }), ['C:/repo/src/app.vue', 'C:/repo/src/main.js']);
  assert.deepEqual(selectFunctionDocumentationFiles(files, {
    enabled: false,
    include: ['**/*'],
    exclude: [],
    extensions: ['.js'],
  }), []);
});

test('为具名 JavaScript 函数同步参数和返回标签并跳过匿名回调', () => {
  const source = [
    'export function query(userId, options = {}) {',
    '  return { userId, options };',
    '}',
    '',
    'const collect = (...items) => items;',
    'const ids = items.map((item) => item.id);',
    '',
  ].join('\n');
  const expected = [
    '/**',
    ' * @param userId',
    ' * @param options',
    ' * @returns',
    ' */',
    'export function query(userId, options = {}) {',
    '  return { userId, options };',
    '}',
    '',
    '/**',
    ' * @param ...items',
    ' * @returns',
    ' */',
    'const collect = (...items) => items;',
    'const ids = items.map((item) => item.id);',
    '',
  ].join('\n');

  const result = synchronizeFunctionDocumentationContent(source, 'src/query.js');
  assert.equal(result.content, expected);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    synchronizeFunctionDocumentationContent(result.content, 'src/query.js').content,
    expected,
  );
});

test('为默认导出的箭头函数同步文档', () => {
  const source = 'export default (input) => input;\n';
  const expected = [
    '/**',
    ' * @param input',
    ' * @returns',
    ' */',
    'export default (input) => input;',
    '',
  ].join('\n');

  const result = synchronizeFunctionDocumentationContent(source, 'src/convert.js');
  assert.equal(result.content, expected);
  assert.deepEqual(result.warnings, []);
});

test('保留人工 Description 和说明并移除 TypeScript JSDoc 中的重复类型', () => {
  const source = [
    '/**',
    ' * @Description: 查询用户',
    ' * @param {string} removed - 已删除参数',
    ' * @param {string} userId - 用户 ID',
    ' * @param {Options} options - 查询配置',
    ' * @param {boolean} options.force - 是否强制刷新',
    ' * @returns {Promise<User>} 用户详情',
    ' * @throws {Error} 请求失败',
    ' * @deprecated 使用 queryUserV2',
    ' */',
    'export async function queryUser(userId: string, options?: Options): Promise<User> {',
    '  return request(userId, options);',
    '}',
    '',
  ].join('\n');
  const expected = [
    '/**',
    ' * @Description: 查询用户',
    ' * @param userId - 用户 ID',
    ' * @param options - 查询配置',
    ' * @param options.force - 是否强制刷新',
    ' * @returns 用户详情',
    ' * @throws {Error} 请求失败',
    ' * @deprecated 使用 queryUserV2',
    ' */',
    'export async function queryUser(userId: string, options?: Options): Promise<User> {',
    '  return request(userId, options);',
    '}',
    '',
  ].join('\n');

  assert.equal(
    synchronizeFunctionDocumentationContent(source, 'src/query-user.ts').content,
    expected,
  );
});

test('移除 TypeScript 多行 JSDoc 类型并保留人工说明', () => {
  const source = [
    '/**',
    ' * @param {{',
    ' *   force: boolean',
    ' * }} options - 查询配置',
    ' * @returns {Promise<{',
    ' *   id: string',
    ' * }>} 用户详情',
    ' */',
    'async function query(options: Options): Promise<User> {',
    '  return request(options);',
    '}',
    '',
  ].join('\n');
  const expected = [
    '/**',
    ' * @param options - 查询配置',
    ' * @returns 用户详情',
    ' */',
    'async function query(options: Options): Promise<User> {',
    '  return request(options);',
    '}',
    '',
  ].join('\n');

  assert.equal(
    synchronizeFunctionDocumentationContent(source, 'src/query.ts').content,
    expected,
  );
});

test('参数和返回值删除后清理陈旧标签但保留人工 Description', () => {
  const source = [
    '/**',
    ' * @Description: 刷新缓存',
    ' * @param cacheKey - 缓存键',
    ' * @returns 刷新结果',
    ' */',
    'function refreshCache() {',
    '  clearCache();',
    '}',
    '',
  ].join('\n');
  const expected = [
    '/**',
    ' * @Description: 刷新缓存',
    ' */',
    'function refreshCache() {',
    '  clearCache();',
    '}',
    '',
  ].join('\n');

  assert.equal(
    synchronizeFunctionDocumentationContent(source, 'src/cache.js').content,
    expected,
  );
});

test('只为直接逃逸的 throw 和返回的 Promise.reject 提示补充 throws', () => {
  const source = [
    'function direct(value) {',
    '  if (!value) throw Error("缺少值");',
    '}',
    '',
    'function caught() {',
    '  try {',
    '    throw Error("已处理");',
    '  } catch {}',
    '}',
    '',
    'function nested() {',
    '  return () => { throw Error("回调异常"); };',
    '}',
    '',
    'const rejectRequest = () => Promise.reject(Error("请求失败"));',
    'const conditionalReject = (failed) => failed ? Promise.reject(Error("失败")) : true;',
    '',
  ].join('\n');

  const result = synchronizeFunctionDocumentationContent(source, 'src/errors.js');
  assert.deepEqual(
    result.warnings.map(({ code, functionName }) => ({ code, functionName })),
    [
      { code: 'function-docs/missing-throws', functionName: 'direct' },
      { code: 'function-docs/missing-throws', functionName: 'rejectRequest' },
      { code: 'function-docs/missing-throws', functionName: 'conditionalReject' },
    ],
  );
  assert.match(result.content, /@param value/);
  assert.match(result.content, /const rejectRequest/);
  assert.doesNotMatch(result.content, /@throws/);
});

test('解构参数不自动修改并返回可定位提示', () => {
  const source = 'function query({ page, pageSize }) {\n  return page + pageSize;\n}\n';
  const result = synchronizeFunctionDocumentationContent(source, 'src/query.js');

  assert.equal(result.content, source);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'function-docs/destructured-parameter');
  assert.deepEqual(result.warnings[0].location, {
    path: 'src/query.js',
    line: 1,
    column: 1,
  });
});

test('Generator 只同步参数并保留人工 returns 标签', () => {
  const source = [
    '/**',
    ' * @returns 迭代器最终结果',
    ' */',
    'function* stream(limit) {',
    '  yield limit;',
    '}',
    '',
  ].join('\n');
  const result = synchronizeFunctionDocumentationContent(source, 'src/stream.js');

  assert.match(result.content, /@param limit\n \* @returns 迭代器最终结果/);
  assert.equal(result.warnings[0].code, 'function-docs/generator-return-unsupported');
});

test('只修改 Vue script 和 script setup 并保留模板样式及完整行号', () => {
  const source = [
    '<!-- <script>function fake(userId) { return userId; }</script> -->',
    '<template><button @click="load">加载</button></template>',
    '<script>',
    'export default {',
    '  methods: {',
    '    load(userId) { return userId; },',
    '  },',
    '};',
    '</script>',
    '<script setup lang="ts">',
    'const submit = (options: Options): Promise<Result> => request(options);',
    '</script>',
    '<style scoped>.button { color: red; }</style>',
    '',
  ].join('\n');
  const result = synchronizeFunctionDocumentationContent(source, 'src/Page.vue');

  assert.match(result.content, /methods: \{\n {4}\/\*\*\n {5}\* @param userId\n {5}\* @returns\n {5}\*\/\n {4}load/);
  assert.match(result.content, /\/\*\*\n \* @param options\n \* @returns\n \*\/\nconst submit/);
  assert.match(result.content, /<template><button @click="load">加载<\/button><\/template>/);
  assert.match(result.content, /<!-- <script>function fake\(userId\) \{ return userId; \}<\/script> -->/);
  assert.doesNotMatch(result.content, /@param userId\n \* @returns\n \*\/\nfunction fake/);
  assert.match(result.content, /<style scoped>\.button \{ color: red; \}<\/style>/);
});

test('跳过使用 src 属性的 Vue 外部 script', () => {
  const source = '<script lang="ts" src="./external.ts"></script>\n';
  const result = synchronizeFunctionDocumentationContent(source, 'src/Page.vue');

  assert.equal(result.content, source);
  assert.deepEqual(result.warnings, []);
});

test('语法错误使用稳定中文错误拒绝写入', () => {
  assert.throws(
    () => synchronizeFunctionDocumentationContent('function broken( {\n', 'src/broken.ts'),
    /函数文档同步无法解析 src\/broken\.ts:\d+:/,
  );
});
