import path from 'node:path';
import { readFileSync } from 'node:fs';
import micromatch from 'micromatch';
import { extractAsyncResourceFacts } from '../integrations/vue/async-resource-facts.js';
import { sourceLocation } from '../integrations/vue/template-parser.js';
import { findStructuredException } from './exception-registry.js';

export const ASYNC_RESOURCE_CLEANUP_RULE = 'vue/require-async-resource-cleanup';

const RESOURCE_LABELS = Object.freeze({
  'abort-controller': '可取消请求或 signal 监听器',
  'animation-frame': 'requestAnimationFrame',
  closeable: '可关闭连接',
  'event-listener': '事件监听器',
  'geolocation-watch': '定位监听',
  interval: 'setInterval',
  observer: 'Observer',
  subscription: '订阅',
  timeout: '长时 setTimeout',
  worker: 'Worker',
});

function normalizedRelative(file) {
  return (typeof file === 'string' ? file : file.relative).replaceAll('\\', '/');
}

export function selectAsyncResourceCleanupFiles(files, config) {
  if (!config.enabled) return [];
  const extensions = new Set(config.extensions);
  return files.filter((file) => {
    const relative = normalizedRelative(file);
    return extensions.has(path.extname(relative).toLowerCase())
      && micromatch.some(relative, config.include, { dot: true })
      && !micromatch.some(relative, config.exclude, { dot: true });
  });
}

function sameLifetime(acquisition, release) {
  return acquisition.lifetime === release.lifetime;
}

function matchingRelease(acquisition, release) {
  if (!sameLifetime(acquisition, release) || acquisition.kind !== release.kind) return false;
  if (acquisition.kind === 'event-listener') {
    return acquisition.target != null
      && acquisition.event != null
      && acquisition.callback != null
      && acquisition.capture !== 'dynamic'
      && release.target === acquisition.target
      && release.event === acquisition.event
      && release.callback === acquisition.callback
      && release.capture === acquisition.capture;
  }
  if (acquisition.kind === 'geolocation-watch') {
    return acquisition.handle != null
      && acquisition.target != null
      && release.handle === acquisition.handle
      && release.target === acquisition.target;
  }
  return acquisition.handle != null && release.handle === acquisition.handle;
}

function expectedCleanup(acquisition) {
  const hook = acquisition.lifetime === 'deactivate'
    ? 'onDeactivated/deactivated'
    : 'onBeforeUnmount/onUnmounted/onScopeDispose 或组件卸载钩子';
  const actions = {
    'abort-controller': 'AbortController.abort()',
    'animation-frame': 'cancelAnimationFrame()',
    closeable: '.close()',
    'event-listener': '相同目标、事件、回调和 capture 的 removeEventListener()',
    'geolocation-watch': 'clearWatch()',
    interval: 'clearInterval()',
    observer: '.disconnect()',
    subscription: '.unsubscribe() 或 .dispose()',
    timeout: 'clearTimeout()',
    worker: '.terminate()',
  };
  return `在 ${hook} 中调用 ${actions[acquisition.kind]}`;
}

function missingReason(acquisition) {
  if (acquisition.kind === 'abort-controller' && acquisition.request) {
    return `${acquisition.request} 未传入可追踪的 AbortController.signal`;
  }
  if (acquisition.kind === 'event-listener') {
    if (acquisition.event == null) return '事件名称不是静态字符串，无法证明移除的是同一监听器';
    if (acquisition.callback == null) return '监听回调没有稳定引用，无法证明能够精确移除';
    if (acquisition.target == null) return '监听目标不是可追踪的稳定引用';
    if (acquisition.capture === 'dynamic') return 'capture 配置不是静态布尔值，无法证明移除参数一致';
    return '未在对应生命周期中找到参数完全一致的 removeEventListener()';
  }
  if (acquisition.handle == null) return '资源句柄未保存到可追踪的变量或属性';
  return `未在对应生命周期中找到 ${expectedCleanup(acquisition).split('调用 ')[1]}`;
}

function violation(source, relativePath, acquisition, issue, message) {
  return {
    rule: ASYNC_RESOURCE_CLEANUP_RULE,
    issue,
    path: relativePath,
    ...sourceLocation(source, acquisition.offset),
    message,
    evidence: missingReason(acquisition),
    expected: expectedCleanup(acquisition),
    remediation: '保存资源句柄或稳定回调，并在资源所属的 Vue 生命周期结束时显式释放；不要依赖页面刷新、垃圾回收或调用方猜测清理时机。',
  };
}

export function findAsyncResourceCleanupViolations(source, relativePath, config) {
  const { acquisitions, releases } = extractAsyncResourceFacts(source, relativePath, config);
  const violations = acquisitions
    .filter((acquisition) => !releases.some((release) => matchingRelease(acquisition, release)))
    .map((acquisition) => violation(
      source,
      relativePath,
      acquisition,
      'async-resource/missing-cleanup',
      `${RESOURCE_LABELS[acquisition.kind]}创建后没有可靠释放`,
    ));

  const reusable = acquisitions.filter(({ kind, handle }) => (
    handle != null && kind !== 'abort-controller' && kind !== 'event-listener'
  ));
  const seen = new Set();
  for (const acquisition of reusable) {
    const key = `${acquisition.kind}\0${acquisition.handle}\0${acquisition.lifetime}`;
    if (seen.has(key)) {
      violations.push(violation(
        source,
        relativePath,
        acquisition,
        'async-resource/overwritten-handle',
        `${RESOURCE_LABELS[acquisition.kind]}重复写入同一句柄，无法证明旧资源已先释放`,
      ));
    }
    seen.add(key);
  }
  return violations.sort((left, right) => left.line - right.line || left.column - right.column);
}

function normalizedFile(root, file) {
  if (typeof file !== 'string') return file;
  const absolute = path.resolve(root, file);
  return {
    absolute,
    relative: path.relative(root, absolute).replaceAll('\\', '/'),
  };
}

export function inspectAsyncResourceCleanup({ root, files, config, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const candidate of files) {
    const file = normalizedFile(root, candidate);
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findAsyncResourceCleanupViolations(source, file.relative, config)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}
