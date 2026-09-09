import { FRONTEND_PROJECT, parseProjectFixture } from '../helpers/project-config.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { executionError } from '../../src/core/error/repo-guard-error.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateConfig } from '../../src/config/configuration-validation.js';
import { DEFAULT_COMMIT_ANIMATION_CONFIG as defaults } from '../../src/config/commit-animation-validation.js';
import {
  createStarterConfig,
  migrateProjectConfig,
  setFeaturesEnabled,
} from '../../src/orchestration/setup/config-management.js';
import {
  createCommitAnimation,
  supportsCommitAnimation,
  commitPropType,
  renderPetFrame,
} from '../../src/core/report/commit-animation/presenter.js';
import { scenePixels } from '../../src/core/report/commit-animation/scenes.js';
import { selectEgg, COMMIT_TYPES, drawCargo } from '../../src/core/report/commit-animation/surprises.js';
import { DEFAULT_COMMIT_MESSAGE_CONFIG } from '../../src/config/defaults.js';

function terminal(config = {}) {
  const stream = new EventEmitter(),
    lifecycle = new EventEmitter();
  let output = '',
    clock = 0,
    tick = null;
  Object.assign(stream, {
    isTTY: true,
    columns: 90,
    rows: 30,
    writable: true,
    getColorDepth: () => 24,
    write: (text) => {
      output += text;
      return true;
    },
  });
  const animation = createCommitAnimation(
    { ...defaults, enabled: true, ...config },
    {
      stream,
      env: {},
      lifecycle,
      now: () => clock,
      schedule: (callback) => {
        tick = callback;
        return 1;
      },
      unschedule: () => {
        tick = null;
      },
    },
  );
  return {
    animation,
    stream,
    lifecycle,
    get output() {
      return output;
    },
    get scheduled() { return tick !== null; },
    advance(ms) {
      clock += ms;
      tick?.();
    },
  };
}

test('动画配置默认关闭，旧配置迁移和功能开关保留主题', (t) => {
  assert.deepEqual(
    validateConfig({
      version: 1,
      rules: [{ pattern: '**', category: '测试', level: 'audit' }],
    }).commitAnimation,
    defaults,
  );
  assert.deepEqual(createStarterConfig().commitAnimation, defaults);
  const root = mkdtempSync(path.join(tmpdir(), 'guard-animation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'repo-guard.config.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      rules: [{ pattern: '**', category: '测试', level: 'audit' }],
      commitAnimation: { theme: 'dog' },
    }),
  );
  assert.equal(migrateProjectConfig(root, { project: FRONTEND_PROJECT }).config.commitAnimation.theme, 'dog');
  setFeaturesEnabled(root, ['commitAnimation'], true);
  assert.equal(parseProjectFixture(readFileSync(file)).commitAnimation.enabled, true);
  setFeaturesEnabled(root, ['commitAnimation'], false);
  assert.equal(parseProjectFixture(readFileSync(file)).commitAnimation.theme, 'dog');
});

test('拒绝信号主题、未知字段、非法概率及非布尔开关', () => {
  for (const commitAnimation of [
    null,
    [],
    { theme: 'signal' },
    { sound: true },
    { enabled: 'true' },
    { commitTypeProps: 1 },
    { eggChance: -1 },
    { eggChance: 1.1 },
    { eggChance: NaN },
    { eggChance: '0.1' },
    { successEgg: 'random' },
    { successEgg: 'auto' },
    { eggChance: 0.1 },
  ]) {
    assert.throws(
      () =>
        validateConfig({
          version: 1,
          rules: [{ pattern: '**', category: '测试', level: 'audit' }],
          commitAnimation,
        }),
      /commitAnimation/,
    );
  }
  const schema = JSON.parse(readFileSync('config.schema.json'));
  const animationSchema = schema.$defs.singleProjectDocument.properties.reporting.properties.commitAnimation;
  assert.deepEqual(animationSchema.properties.theme.enum, [
    'cat',
    'dog',
  ]);
  assert.deepEqual(
    Object.keys(animationSchema.properties).sort(),
    Object.keys(defaults).sort(),
  );
});

test('仅在适合的终端播放，CI、无颜色和小窗口保留文字', () => {
  const { stream } = terminal();
  assert.equal(supportsCommitAnimation(stream, {}), true);
  for (const env of [{ CI: 'true' }, { TERM: 'dumb' }, { NO_COLOR: '' }]) {
    assert.equal(supportsCommitAnimation(stream, env), false);
  }
  for (const change of [
    { isTTY: false },
    { columns: 59 },
    { rows: 21 },
    { getColorDepth: () => 4 },
  ]) {
    assert.equal(supportsCommitAnimation({ ...stream, ...change }, {}), false);
  }
});

test('提交标题仅提取稳定类型，未知类型退回普通包裹', () => {
  for (const [title, type] of [
    ['feat(ui)!: 新功能', 'feat'],
    ['fix: 修复', 'fix'],
    ['docs(api): 文档', 'docs'],
    ['refactor: 重构', 'refactor'],
    ['Merge branch feat', 'chore'],
    ['\u001b[2Jfeat: 标题', 'chore'],
  ])
    assert.equal(commitPropType(title), type);
});

test('道具覆盖项目全部默认类型，共享标题语法，特殊与自定义类型使用普通包裹', () => {
  assert.deepEqual(Object.keys(COMMIT_TYPES), [...DEFAULT_COMMIT_MESSAGE_CONFIG.types]);
  const sprites = new Set();
  for (const type of DEFAULT_COMMIT_MESSAGE_CONFIG.types) {
    assert.equal(commitPropType(`${type}: 示例`), type);
    assert.equal(commitPropType(`${type}(ui/button)!: 示例`), type);
    const pixels = Array.from({ length: 10 }, () => Array(8).fill('.'));
    drawCargo({ box(x, y, width, height, color) {
      assert.equal(typeof color, 'string');
      for (let dy = 0; dy < height; dy += 1) for (let dx = 0; dx < width; dx += 1) {
        assert.ok(x + dx >= 0 && x + dx < 8 && y + dy >= 0 && y + dy < 10);
        pixels[y + dy][x + dx] = color;
      }
    } }, 0, 4, type);
    sprites.add(JSON.stringify(pixels));
    for (const theme of ['cat', 'dog']) {
      const frame = renderPetFrame({ theme, width: 80, time: 0, commitType: type }).join('');
      assert.ok(frame.includes('▀'));
    }
  }
  assert.equal(sprites.size, 10);
  for (const title of ['fixup! feat: 示例', 'squash! fix: 示例', 'amend! docs: 示例',
    'Revert "feat: 示例"', 'Merge branch main', 'custom: 示例', 'feat:缺少空格', 'feat(非法范围): 示例']) {
    assert.equal(commitPropType(title), 'chore');
  }
  assert.equal(commitPropType('feat: 合并标题', ['parent1', 'parent2']), 'chore');
});

test('两种角色有不同像素且持续运动，失败状态冻结并禁止彩蛋', () => {
  const state = {
    index: 2,
    completed: 2,
    fraction: 1,
    elapsed: 200,
    waiting: true,
  };
  assert.notDeepEqual(
    scenePixels('cat', state, 80).pixels,
    scenePixels('dog', state, 80).pixels,
  );
  assert.notDeepEqual(
    scenePixels('cat', state, 80, 200).pixels,
    scenePixels('cat', state, 80, 500).pixels,
  );
  for (const theme of ['cat', 'dog']) {
    const failed = { ...state, failed: true };
    assert.deepEqual(
      scenePixels(theme, failed, 80, 200).pixels,
      scenePixels(theme, failed, 80, 900, { egg: 'fireworks', successAge: 500 })
        .pixels,
    );
  }
  assert.match(
    renderPetFrame({ theme: 'cat', width: 80, time: 0 }).join('\n'),
    /尚未创建提交/,
  );
});

test('成功彩蛋使用内置概率，触发后只抽取一种', () => {
  let calls = 0;
  assert.equal(selectEgg(() => { calls += 1; return 0.1; }), 'none');
  assert.equal(calls, 1);
  for (const [value, expected] of [[0, 'meteor'], [0.5, 'butterfly'], [0.99, 'fireworks']]) {
    const randomValues = [0.099, value];
    assert.equal(selectEgg(() => randomValues.shift()), expected);
    assert.equal(randomValues.length, 0);
  }
});

test('指定彩蛋仅用于预览，项目配置不能覆盖真实提交的随机规则', async () => {
  const preview = terminal();
  await preview.animation.celebrate('test: 示例', { previewEgg: 'butterfly',
    random: () => assert.fail('预览指定彩蛋时不抽签'), wait: async () => {} });
  assert.match(preview.output, /蝴蝶来访/);
  const real = terminal({ successEgg: 'fireworks', eggChance: 1 });
  let duration = 0;
  await real.animation.celebrate('build: 示例', { random: () => 0.9, wait: async ms => { duration = ms; } });
  assert.equal(duration, 750);
  assert.doesNotMatch(real.output, /小小烟花/);
});

test('只刷新变化行，输出背压时跳过帧，关闭配置完全静默', async () => {
  const fixture = terminal();
  fixture.animation.start();
  const first = fixture.output;
  fixture.advance(0);
  assert.equal(fixture.output, first);
  fixture.advance(150);
  assert.doesNotMatch(fixture.output.slice(first.length), /\r\n/);
  fixture.animation.close();

  const slow = terminal();
  const write = slow.stream.write;
  slow.stream.write = value => { write(value); return false; };
  slow.animation.start();
  const blocked = slow.output;
  slow.advance(500);
  assert.equal(slow.output, blocked);
  slow.stream.write = write;
  slow.stream.emit('drain');
  slow.advance(500);
  assert.ok(slow.output.length > blocked.length);
  slow.animation.close();

  const disabled = terminal({ enabled: false });
  disabled.animation.start();
  await disabled.animation.celebrate('feat: 不应显示', { random: () => assert.fail('关闭后不抽签') });
  disabled.animation.close();
  assert.equal(disabled.output, '');
});

test('失败保留静止角色，停止计时器，后续报告不会被重绘覆盖', () => {
  const fixture = terminal();
  fixture.animation.start();
  fixture.advance(150);
  fixture.animation.fail();
  const snapshot = fixture.output;
  fixture.advance(3000);
  fixture.animation.start();
  assert.equal(fixture.output, snapshot);
  assert.match(snapshot, /检查未通过/);
  assert.ok(snapshot.includes('\u001b[?25h'));
  assert.equal(fixture.lifecycle.listenerCount('exit'), 0);
});

test('窗口缩放不回退旧行数，退出与暂停恢复光标且不接管输入', () => {
  const fixture = terminal();
  fixture.animation.start();
  const before = fixture.output;
  fixture.stream.emit('resize');
  assert.doesNotMatch(fixture.output.slice(before.length).replaceAll('\u001b', ''), /\[\d+A/);
  assert.equal(fixture.animation.active, false);
  assert.equal(fixture.stream.listenerCount('resize'), 0);
  const second = terminal();
  second.animation.start();
  second.lifecycle.emit('exit');
  assert.ok(second.output.endsWith('\u001b[?25h'));
  assert.equal(second.lifecycle.listenerCount('SIGINT'), 0);
});

test('庆祝只抽签一次并限制时长，输出错误不改变门禁状态', async () => {
  const fixture = terminal();
  let calls = 0,
    duration = 0;
  await fixture.animation.celebrate('feat: 新功能', {
    random: () => {
      calls += 1;
      return 0;
    },
    wait: async (ms) => {
      duration = ms;
      fixture.advance(500);
      fixture.advance(500);
    },
  });
  assert.equal(calls, 2);
  assert.equal(duration, 3200);
  assert.match(fixture.output, /Git 已创建提交/);
  const failed = terminal();
  failed.animation.start();
  failed.stream.emit('error', { code: 'EPIPE' });
  assert.equal(failed.animation.active, false);
  assert.equal(failed.lifecycle.listenerCount('exit'), 0);
});

test('中断时先恢复光标，保留原有取消处理，缺省时重新交付信号', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const fixture = terminal();
    let forwarded = null;
    fixture.lifecycle.pid = 123;
    fixture.lifecycle.kill = (pid, received) => { forwarded = [pid, received]; };
    fixture.animation.start();
    fixture.lifecycle.emit(signal);
    assert.deepEqual(forwarded, [123, signal]);
    assert.ok(fixture.output.endsWith('\u001b[?25h'));
    assert.equal(fixture.scheduled, false);
    assert.equal(fixture.lifecycle.listenerCount(signal), 0);

    const existing = terminal();
    let cancelled = false;
    existing.lifecycle.once(signal, () => {
      assert.ok(existing.output.endsWith('\u001b[?25h'));
      cancelled = true;
    });
    existing.lifecycle.kill = () => assert.fail('不能替代原有取消流程');
    existing.animation.start();
    existing.lifecycle.emit(signal);
    assert.equal(cancelled, true);
    assert.equal(existing.scheduled, false);
  }
});

test('终端能力检测和绘制异常均降级，失败后不创建动画计时器', () => {
  const unavailable = terminal();
  unavailable.stream.getColorDepth = () => { throw executionError('animation/test-terminal', '终端不可用'); };
  assert.equal(supportsCommitAnimation(unavailable.stream, {}), false);
  assert.doesNotThrow(() => unavailable.animation.start());
  assert.equal(unavailable.animation.active, false);
  assert.equal(unavailable.scheduled, false);
  assert.equal(unavailable.lifecycle.listenerCount('exit'), 0);
});

test('预览命令没有 Git 副作用，重定向输出无控制字符且有完整模拟报告', () => {
  const result = spawnSync(
    process.execPath,
    [
      'bin/repo-guard.js',
      'animation-preview',
      '--theme',
      'dog',
      '--fail',
      '--plain',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const text = result.stdout + result.stderr;
  assert.equal(text.includes('\u001b'), false);
  assert.match(text, /不会创建 Git 提交/);
  assert.match(text, /user-profile.vue/);
  assert.match(text, /修复目标/);
  assert.match(text, /验证/);
  const invalid = spawnSync(
    process.execPath,
    ['bin/repo-guard.js', 'animation-preview', '--theme', 'signal'],
    { encoding: 'utf8' },
  );
  assert.equal(invalid.status, 1);
});
