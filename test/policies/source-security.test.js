import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSourceSecurity } from '../../src/config/source-security.js';
import { inspectSourceSecurity } from '../../src/gates/security/source-security-gate.js';

const defaults = () =>
  validateSourceSecurity({}, { role: 'frontend', stack: 'node' });
const inspect = (
  source,
  filename = 'arbitrary/Legacy_NAME.js',
  options = defaults(),
) => inspectSourceSecurity(source, filename, options);
const rules = (source, filename, options) =>
  inspect(source, filename, options)
    .filter((item) => !item.unconfirmed)
    .map((item) => item.rule);

for (const [description, source, filename, expected] of [
  ['直接 eval', 'eval(data)', 'a.js', 'security/no-eval'],
  ['Unicode API', 'ev\\u0061l(data)', 'a.js', 'security/no-eval'],
  ['字面量计算属性', 'window["eval"](data)', 'a.js', 'security/no-eval'],
  ['可选调用', 'window?.eval?.(data)', 'a.ts', 'security/no-eval'],
  ['逗号操作符', '(0, eval)(data)', 'a.js', 'security/no-eval'],
  [
    'Function 引用',
    'const fn = Function',
    'a.js',
    'security/no-function-constructor',
  ],
  [
    '字符串定时器',
    'setTimeout("execute()", 5)',
    'a.js',
    'source-security/string-timer',
  ],
  [
    '定时器模板字面量',
    'window.setInterval(`execute()`, 5)',
    'a.js',
    'source-security/string-timer',
  ],
  [
    '直接 DOM 属性',
    'document.body.innerHTML = html',
    'a.js',
    'source-security/dom-html',
  ],
  [
    'DOM 追加空串不是清空',
    'document.body.innerHTML += ""',
    'a.js',
    'source-security/dom-html',
  ],
  [
    '文档写入',
    'window.document.writeln(html)',
    'a.js',
    'source-security/dom-html',
  ],
  [
    '明确 DOM 方法',
    'document.body.insertAdjacentHTML("beforeend", html)',
    'a.js',
    'source-security/dom-html',
  ],
  [
    'Vue 指令',
    '<template><div v-html="sanitizeHtml(x)" /></template>',
    'a.vue',
    'vue/no-v-html',
  ],
  [
    'iframe 内容',
    '<iframe srcdoc="content"></iframe>',
    'a.html',
    'source-security/srcdoc',
  ],
  [
    'iframe 动态内容仍禁用 API',
    '<template><iframe :srcdoc="content" /></template>',
    'a.vue',
    'source-security/srcdoc',
  ],
  [
    '内联事件',
    '<button onclick="run()">运行</button>',
    'a.html',
    'source-security/inline-event',
  ],
  [
    'DOM 设置事件',
    'document.body.setAttribute("onclick", code)',
    'a.js',
    'source-security/inline-event',
  ],
  [
    '事件字符串写入',
    'document.body.onclick = "run()"',
    'a.js',
    'source-security/inline-event',
  ],
  [
    '协议实体编码',
    '<a href="java&#115;cript:run()">运行</a>',
    'a.html',
    'source-security/url-scheme',
  ],
  [
    '协议控制字符',
    '<a href="java&#x09;script:run()">运行</a>',
    'a.html',
    'source-security/url-scheme',
  ],
  [
    'Vue 字面量绑定',
    '<template><a :href="\'javascript:run()\'">运行</a></template>',
    'a.vue',
    'source-security/url-scheme',
  ],
  [
    'JSX 字面量绑定',
    'const x = <a href={"javascript:run()"}>x</a>',
    'a.tsx',
    'source-security/url-scheme',
  ],
  [
    '表单地址',
    '<form action="data:text/html,x"></form>',
    'a.html',
    'source-security/url-scheme',
  ],
  [
    '脚本地址',
    '<script src="data:text/javascript,x"></script>',
    'a.html',
    'source-security/url-scheme',
  ],
  [
    '新窗口缺少 rel',
    '<a target="_blank">打开</a>',
    'a.html',
    'source-security/new-window',
  ],
  [
    'Vue 新窗口',
    '<template><a target="_blank">打开</a></template>',
    'a.vue',
    'vue/target-blank-security',
  ],
  [
    '窗口选项',
    'window.open(url, "_blank", "noopener=0,noreferrer")',
    'a.js',
    'source-security/new-window',
  ],
  [
    '消息通配符',
    'window.parent.postMessage(data, "*")',
    'a.js',
    'source-security/message-origin',
  ],
  [
    '消息选项',
    'window.postMessage(data, {targetOrigin:"*"})',
    'a.js',
    'source-security/message-origin',
  ],
  [
    '消息缺少来源',
    'window.postMessage(data)',
    'a.js',
    'source-security/message-origin',
  ],
  [
    'HTML 内联脚本',
    '<script>eval(data)</script>',
    'a.html',
    'security/no-eval',
  ],
  [
    'Vue TS 脚本',
    '<script setup lang="ts">const x: string = "x"; eval(x)</script>',
    'a.vue',
    'security/no-eval',
  ],
]) {
  test(`源码规则命中：${description}`, () =>
    assert.ok(rules(source, filename).includes(expected)));
}

for (const [description, source, filename = 'a.js'] of [
  ['注释字符串', '// eval(x)\nconst x = "window.postMessage(x,*)"'],
  [
    '同名局部函数',
    'function run(eval, Function, window, document) { eval(x); new Function(x); window.postMessage(x,"*"); document.body.innerHTML=x; }',
  ],
  ['TS 类型引用', 'type X = Function; type Y = typeof window.eval;', 'a.ts'],
  ['函数定时器', 'setTimeout(() => run(), 1)'],
  ['清空 DOM', 'document.body.innerHTML = ""'],
  ['标准事件注册', 'document.body.addEventListener("click", handler)'],
  [
    'Vue 标准事件',
    '<template><button @click="run">运行</button></template>',
    'a.vue',
  ],
  ['普通图片 data URL', '<img src="data:image/png;base64,aaaa">', 'a.html'],
  ['字符串提到协议', 'const text = "javascript:x"'],
  [
    '保护完整',
    '<a target="_blank" rel="noopener noreferrer">打开</a>',
    'a.html',
  ],
  ['已有窗口', 'window.open(url, "_self")'],
  ['精确目标来源', 'window.parent.postMessage(data, "https://example.com")'],
  [
    '自定义组件名称不表明行为',
    '<template><SafeLink target="_blank" href="javascript:x" /></template>',
    'a.vue',
  ],
  [
    '注释中脚本',
    '<!-- <script>eval(x)</script> --><template><p>x</p></template>',
    'a.vue',
  ],
  [
    '文本区域中伪元素',
    '<textarea><a href="javascript:x">x</a></textarea>',
    'a.html',
  ],
  ['JSX 函数事件', 'const x = <button onClick={() => run()}/>;', 'a.jsx'],
])
  test(`误报反例：${description}`, () =>
    assert.deepEqual(rules(source, filename), []));

for (const [source, filename = 'a.js'] of [
  ['object.innerHTML = text'],
  ['worker.postMessage(data)'],
  ['window.postMessage(data, origin)'],
  ['window.open(url, target, features)'],
  ['setTimeout(handler, 1)'],
  ['<template><a :href="url">打开</a></template>', 'a.vue'],
  [
    '<template><a target="_blank" :rel="`noopener ${x}`">打开</a></template>',
    'a.vue',
  ],
  [
    '<template><a target="_blank" :rel="\'noopener \' + suffix">打开</a></template>',
    'a.vue',
  ],
  ['const x = <a target="_blank" {...props}/>;', 'a.tsx'],
])
  test(`无法确认不会伪装成违规或值验证：${source}`, () => {
    const result = inspect(source, filename);
    assert.ok(result.some((item) => item.unconfirmed));
    assert.equal(result.filter((item) => !item.unconfirmed).length, 0);
  });

test('每组开关独立生效，子选项可以覆盖默认值', () => {
  const options = defaults();
  options.dynamicCode.enabled = false;
  assert.deepEqual(
    rules('eval(x);window.postMessage(x,"*")', 'a.js', options),
    ['source-security/message-origin'],
  );
  options.newWindow.requireNoreferrer = false;
  assert.deepEqual(
    rules('<a target="_blank" rel="noopener">x</a>', 'a.html', options),
    [],
  );
});

test('错误语法不能作为通过', () => {
  assert.throws(() => inspect('const ='), /无法解析/);
  assert.throws(
    () => inspect('<template><div></template>', 'a.vue'),
    /无法完整解析/,
  );
});

test('位置来自原始 Vue 文件，包括前置行和属性', () => {
  const source = '<template>\n  <div v-html="x"/>\n</template>';
  assert.deepEqual(
    inspect(source, 'a.vue').map(({ line, column }) => ({ line, column })),
    [{ line: 2, column: 8 }],
  );
});

test('审查反例：HTML 大写原生标签不能绕过 URL 检查', () => {
  assert.deepEqual(rules('<A HREF="javascript:x">x</A>', 'a.html'), [
    'source-security/url-scheme',
  ]);
});

test('审查反例：窗口保护重复选项的最终禁用值不能被前值掩盖', () => {
  assert.deepEqual(
    rules('window.open(url,"_blank","noopener,noopener=0,noreferrer")'),
    ['source-security/new-window'],
  );
});

test('审查反例：展开参数不应被当作缺少保护配置而误报', () => {
  const result = inspect('window.open(...args); window.postMessage(...args)');
  assert.equal(result.filter((item) => !item.unconfirmed).length, 0);
  assert.equal(result.filter((item) => item.unconfirmed).length, 2);
});

test('审查反例：合法 HTML 允许省略结束标签，仍检查内部违规地址', () => {
  assert.deepEqual(rules('<!doctype html><html><body><p>Hello', 'a.html'), []);
  assert.deepEqual(
    rules(
      '<!doctype html><ul><li><a href="javascript:x">x</a><li>next',
      'a.html',
    ),
    ['source-security/url-scheme'],
  );
});

test('审查反例：rel 的非 ASCII 空白不能伪装成两个保护标记', () => {
  assert.deepEqual(rules('<a target="_blank" rel="noopener&nbsp;noreferrer">x</a>', 'a.html'), ['source-security/new-window']);
});
test('审查反例：窗口选项等号两侧空格不能隐藏禁用值', () => {
  assert.deepEqual(rules('window.open(url,"_blank","noopener = 0,noreferrer")'), ['source-security/new-window']);
});

test('HTML 内联脚本的 CRLF 行列必须对应原始源码', () => {
  const findings = inspect('<script>\r\neval(data)\r\n</script>', 'a.html');
  assert.deepEqual(findings.map(({line,column}) => ({line,column})), [{line:2,column:1}]);
});
