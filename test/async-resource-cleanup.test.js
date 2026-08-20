import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG } from '../src/config/defaults.js';
import { vueAsyncResourceCleanupGate } from '../src/gates/quality/vue-async-resource-cleanup-gate.js';
import {
  findAsyncResourceCleanupViolations,
  selectAsyncResourceCleanupFiles,
} from '../src/policies/async-resource-cleanup.js';

const CONFIG = {
  ...DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
  enabled: true,
  include: ['src/**'],
  exclude: [],
  extensions: ['.vue', '.js', '.ts'],
  requestFunctions: ['fetch', 'api.request'],
};

function vue(script, attributes = 'setup') {
  return `<template><main /></template>\n<script ${attributes}>\n${script}\n</script>`;
}

function issues(source, relative = 'src/App.vue') {
  return findAsyncResourceCleanupViolations(source, relative, CONFIG);
}

test('reports untracked and missing timer cleanup as blocking findings', () => {
  const findings = issues(vue(`
    setInterval(refresh, 1000);
    const timer = setTimeout(refresh, dynamicDelay);
  `));
  assert.deepEqual(findings.map(({ issue }) => issue), [
    'async-resource/missing-cleanup',
    'async-resource/missing-cleanup',
  ]);
  assert.match(findings[0].evidence, /句柄未保存/);
  assert.match(findings[1].expected, /clearTimeout/);
});

test('accepts Vue import aliases and cleanup reached through a local helper', () => {
  const findings = issues(vue(`
    import { onUnmounted as disposeOnUnmount } from 'vue';
    const interval = setInterval(refresh, 1000);
    let timeout;
    timeout = setTimeout(refresh, 2000);
    function cleanupTimers() {
      clearInterval(interval);
      clearTimeout(timeout);
    }
    disposeOnUnmount(() => cleanupTimers());
  `));
  assert.deepEqual(findings, []);
});

test('does not treat an uncalled nested function as cleanup', () => {
  const findings = issues(vue(`
    import { onUnmounted } from 'vue';
    const interval = setInterval(refresh, 1000);
    onUnmounted(() => {
      const unused = () => clearInterval(interval);
    });
  `));
  assert.equal(findings.length, 1);
});

test('requires composition cleanup hooks to be registered synchronously from setup', () => {
  const deadHelper = issues(vue(`
    import { onUnmounted } from 'vue';
    const interval = setInterval(refresh, 1000);
    function neverCalled() {
      onUnmounted(() => clearInterval(interval));
    }
  `));
  assert.equal(deadHelper.length, 1);

  const conditional = issues(vue(`
    import { onUnmounted } from 'vue';
    const interval = setInterval(refresh, 1000);
    if (enabled) onUnmounted(() => clearInterval(interval));
  `));
  assert.equal(conditional.length, 1);

  const reachableHelper = issues(vue(`
    import { onUnmounted } from 'vue';
    const interval = setInterval(refresh, 1000);
    function registerCleanup() {
      onUnmounted(() => clearInterval(interval));
    }
    registerCleanup();
  `));
  assert.deepEqual(reachableHelper, []);
});

test('requires activated resources to be released when deactivated', () => {
  const invalid = issues(vue(`
    import { onActivated, onUnmounted } from 'vue';
    let timer;
    onActivated(() => { timer = setInterval(refresh, 1000); });
    onUnmounted(() => clearInterval(timer));
  `));
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].expected, /onDeactivated/);

  const valid = issues(vue(`
    import { onActivated, onDeactivated } from 'vue';
    let timer;
    onActivated(() => { timer = setInterval(refresh, 1000); });
    onDeactivated(() => clearInterval(timer));
  `));
  assert.deepEqual(valid, []);
});

test('follows activated helpers and allows one cleanup helper in two lifecycles', () => {
  const findings = issues(vue(`
    import { onActivated, onDeactivated, onUnmounted } from 'vue';
    let activeTimer;
    const pageTimer = setInterval(refreshPage, 1000);
    function startActive() { activeTimer = setInterval(refreshActive, 1000); }
    function cleanup() {
      clearInterval(activeTimer);
      clearInterval(pageTimer);
    }
    onActivated(() => startActive());
    onDeactivated(cleanup);
    onUnmounted(cleanup);
  `));
  assert.deepEqual(findings, []);
});

test('matches event listeners by target, event, callback and capture', () => {
  const invalid = issues(vue(`
    import { onUnmounted } from 'vue';
    const resize = () => {};
    window.addEventListener('resize', resize, true);
    onUnmounted(() => window.removeEventListener('resize', resize, false));
  `));
  assert.equal(invalid.length, 1);

  const valid = issues(vue(`
    import { onUnmounted } from 'vue';
    const resize = () => {};
    window.addEventListener('resize', resize, true);
    onUnmounted(() => window.removeEventListener('resize', resize, true));
    window.addEventListener(\`scroll\`, resize, undefined);
    onUnmounted(() => window.removeEventListener(\`scroll\`, resize));
    window.addEventListener('load', () => {}, { once: true });
  `));
  assert.deepEqual(valid, []);
});

test('accepts signal listeners only when their controller is aborted', () => {
  const invalid = issues(vue(`
    const controller = new AbortController();
    window.addEventListener('resize', resize, { signal: controller.signal });
  `));
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].expected, /abort/);

  const valid = issues(vue(`
    import { onScopeDispose } from 'vue';
    const controller = new AbortController();
    window.addEventListener('resize', resize, { signal: controller.signal });
    onScopeDispose(() => controller.abort());
  `));
  assert.deepEqual(valid, []);
});

test('checks observers, connections, workers, subscriptions and animation frames', () => {
  const valid = issues(vue(`
    import { onBeforeUnmount } from 'vue';
    const observer = new ResizeObserver(refresh);
    const socket = new WebSocket(url);
    const worker = new Worker(workerUrl);
    const subscription = stream.subscribe(refresh);
    const frame = requestAnimationFrame(refresh);
    onBeforeUnmount(() => {
      observer?.disconnect();
      socket?.close();
      worker.terminate();
      subscription?.unsubscribe();
      cancelAnimationFrame(frame);
    });
  `));
  assert.deepEqual(valid, []);

  const invalid = issues(vue(`
    new MutationObserver(refresh);
    new EventSource(url);
    stream.subscribe(refresh);
    requestAnimationFrame(refresh);
  `));
  assert.equal(invalid.length, 3);
  assert.equal(invalid.every(({ issue }) => issue === 'async-resource/missing-cleanup'), true);
});

test('accepts callable subscription disposers and a custom request options position', () => {
  const findings = issues(vue(`
    import { onUnmounted } from 'vue';
    const stop = stream.subscribe(refresh);
    const controller = new AbortController();
    api.request({ signal: controller.signal });
    onUnmounted(() => {
      stop();
      controller.abort();
    });
  `));
  assert.deepEqual(findings, []);
});

test('ignores one-shot animation frames but checks stored or recursive loops', () => {
  const oneShot = issues(vue(`
    requestAnimationFrame(resolve);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  `));
  assert.deepEqual(oneShot, []);

  const recurring = issues(vue(`
    function render() { requestAnimationFrame(render); }
    requestAnimationFrame(render);
  `));
  assert.equal(recurring.length, 2);
});

test('requires configured requests to use a signal and abort it on unmount', () => {
  const invalid = issues(vue(`
    fetch('/users');
    const controller = new AbortController();
    api.request('/users', { signal: controller.signal });
  `));
  assert.equal(invalid.length, 2);
  assert.match(invalid[0].evidence, /未传入/);

  const valid = issues(vue(`
    import { onUnmounted } from 'vue';
    const controller = new AbortController();
    fetch('/users', { signal: controller.signal });
    onUnmounted(() => controller.abort());
  `));
  assert.deepEqual(valid, []);

  const globalMember = issues(vue(`
    const fetch = client.fetch;
    window.fetch('/users');
  `));
  assert.equal(globalMember.length, 1);
});

test('excludes short timeouts and Promise sleeps', () => {
  const findings = issues(vue(`
    setTimeout(refresh, 0);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  `));
  assert.deepEqual(findings, []);
});

test('ignores shadowed globals and non-script Vue text', () => {
  const source = `
    <template><div>setInterval(() => {}, 1000)</div></template>
    <script src="./external.js"></script>
    <script setup>
      const setInterval = (callback) => callback();
      setInterval(refresh);
    </script>
  `;
  assert.deepEqual(issues(source), []);
});

test('does not confuse a shadowed Vue lifecycle import with the real hook', () => {
  const findings = issues(vue(`
    import { onUnmounted } from 'vue';
    const timer = setInterval(refresh, 1000);
    function register(onUnmounted) {
      onUnmounted(() => clearInterval(timer));
    }
    register(callback);
  `));
  assert.equal(findings.length, 1);
});

test('does not match bindings across separate Vue script blocks', () => {
  const source = `
    <script>
      const timer = setInterval(refresh, 1000);
    </script>
    <script setup>
      import { onUnmounted } from 'vue';
      const timer = 1;
      onUnmounted(() => clearInterval(timer));
    </script>
  `;
  assert.equal(issues(source).length, 1);
});

test('does not accept cleanup registration or release after await', () => {
  const lateRegistration = issues(vue(`
    import { onUnmounted } from 'vue';
    const timer = setInterval(refresh, 1000);
    await initialize();
    onUnmounted(() => clearInterval(timer));
  `));
  assert.equal(lateRegistration.length, 1);

  const lateRelease = issues(vue(`
    import { onUnmounted } from 'vue';
    const timer = setInterval(refresh, 1000);
    onUnmounted(async () => {
      await save();
      clearInterval(timer);
    });
  `));
  assert.equal(lateRelease.length, 1);
});

test('supports Options API and Vue 2 destroy lifecycle aliases', () => {
  const findings = issues(vue(`
    export default {
      mounted() { this.timer = setInterval(this.refresh, 1000); },
      beforeDestroy() { this.cleanup(); },
      methods: { cleanup() { clearInterval(this.timer); } },
    };
  `, ''));
  assert.deepEqual(findings, []);
});

test('does not treat an unrelated object method as a Vue lifecycle', () => {
  const findings = issues(vue(`
    const timer = setInterval(refresh, 1000);
    const helper = {
      unmounted() { clearInterval(timer); },
    };
  `, ''));
  assert.equal(findings.length, 1);
});

test('supports Options API lifecycle properties and activated helpers', () => {
  const findings = issues(vue(`
    function cleanup() { clearInterval(this.timer); }
    export default {
      activated() { this.start(); },
      deactivated: cleanup,
      methods: {
        start() { this.timer = setInterval(this.refresh, 1000); },
      },
    };
  `, ''));
  assert.deepEqual(findings, []);
});

test('reports repeated writes to one resource handle', () => {
  const findings = issues(vue(`
    import { onUnmounted } from 'vue';
    let timer;
    if (first) timer = setInterval(one, 1000);
    else timer = setInterval(two, 1000);
    onUnmounted(() => clearInterval(timer));
  `));
  assert.equal(findings.some(({ issue }) => issue === 'async-resource/overwritten-handle'), true);
});

test('selects only configured Vue and composable paths', () => {
  const files = [
    { relative: 'src/App.vue', absolute: '/src/App.vue' },
    { relative: 'src/composables/useUser.ts', absolute: '/src/composables/useUser.ts' },
    { relative: 'src/utils/wait.ts', absolute: '/src/utils/wait.ts' },
    { relative: 'src/App.spec.ts', absolute: '/src/App.spec.ts' },
  ];
  const selected = selectAsyncResourceCleanupFiles(files, {
    ...DEFAULT_ASYNC_RESOURCE_CLEANUP_CONFIG,
    enabled: true,
  });
  assert.deepEqual(selected.map(({ relative }) => relative), [
    'src/App.vue',
    'src/composables/useUser.ts',
  ]);
});

test('gate returns violation with error severity when enabled', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-async-cleanup-'));
  try {
    const relative = 'src/App.vue';
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, vue('const timer = setInterval(refresh, 1000);'), 'utf8');
    const config = {
      preCommit: { asyncResourceCleanup: CONFIG },
      exceptions: { entries: [] },
    };
    const plan = vueAsyncResourceCleanupGate.plan({
      root,
      config,
      environment: 'pre-commit',
      files: [{ relative, absolute }],
    });
    const result = vueAsyncResourceCleanupGate.run({ root, config, plan });
    assert.equal(result.status, 'violation');
    assert.equal(result.findings[0].severity, 'error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gate returns a structured execution error for invalid source syntax', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-guard-async-cleanup-'));
  try {
    const relative = 'src/App.vue';
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, vue('const = ;'), 'utf8');
    const config = {
      preCommit: { asyncResourceCleanup: CONFIG },
      exceptions: { entries: [] },
    };
    const plan = vueAsyncResourceCleanupGate.plan({
      root,
      config,
      environment: 'pre-commit',
      files: [{ relative, absolute }],
    });
    const result = vueAsyncResourceCleanupGate.run({ root, config, plan });
    assert.equal(result.status, 'execution-error');
    assert.match(result.summary, /异步资源清理门禁无法解析/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
