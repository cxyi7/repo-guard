import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createPitClassMatcher, matchesPitClass } from '../../../../src/integrations/java/mutation/scope.js';
import { executionError } from '../../../../src/core/error/repo-guard-error.js';

test('PIT 类名仅匹配星号与字面字符，并限制累计计算预算', () => {
  assert.equal(matchesPitClass('example.App$Inner', ['example.App*']), true);
  assert.equal(matchesPitClass('exampleXApp', ['example.App']), false);
  assert.equal(matchesPitClass('example.App$Inner', ['example.App$Inner']), true);
  assert.equal(matchesPitClass('example.App$Inner', ['example.App']), false);
  assert.equal(matchesPitClass('anything', ['*']), true);
  assert.throws(() => matchesPitClass('a'.repeat(1025), ['*']), /超过 1024/);
  assert.throws(() => matchesPitClass('a', ['*'.repeat(257)]), /模式超过/);
  const patterns = Array.from({ length: 32 }, (_, index) => `*${index}${'a'.repeat(55)}b`);
  const matcher = createPitClassMatcher(patterns);
  assert.throws(() => { for (let index = 0; index < 100; index++) matcher(`name${index}${'a'.repeat(1000)}c`); }, /计算预算/);
});
test('反复星号模式不会阻塞匹配线程，原回溯样例在预算内返回', { timeout: 5000 }, async (t) => {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); import(workerData.url).then(({matchesPitClass})=>{ const start=performance.now(); const matched=matchesPitClass('a'.repeat(50)+'c',['*a'.repeat(25)+'b']); parentPort.postMessage({matched,elapsed:performance.now()-start}); }).catch(error=>parentPort.postMessage({error:error.message}));`, { eval: true, workerData: { url: new URL('../../../../src/integrations/java/mutation/scope.js', import.meta.url).href } });
  t.after(() => worker.terminate());
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(executionError('test/pit-scope-timeout', 'PIT 类名模式未在计算预算内返回')), 2000);
    worker.once('message', (message) => { clearTimeout(timer); resolve(message); });
    worker.once('error', (cause) => { clearTimeout(timer); reject(executionError('test/pit-worker', 'PIT 匹配测试线程执行失败', { cause })); });
  });
  assert.equal(result.error, undefined);
  assert.equal(result.matched, false);
  assert.ok(result.elapsed < 1000);
});
