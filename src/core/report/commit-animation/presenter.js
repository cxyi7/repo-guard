import { scenePixels, PALETTE } from './scenes.js';
import { selectEgg, COMMIT_TYPES, EGG_NAMES, EGG_DURATION } from './surprises.js';
import { matchConventionalHeader } from '../../policy/commit-header.js';

const ESC = '\u001b[';

export function supportsCommitAnimation(stream, env = process.env) {
  try { return Boolean(
    stream?.isTTY &&
      stream.columns >= 60 &&
      stream.rows >= 22 &&
      env.TERM !== 'dumb' &&
      !env.CI &&
      env.NO_COLOR === undefined &&
      stream.getColorDepth?.() >= 8,
  ); } catch { return false; }
}

export function commitPropType(message, parents = []) {
  if (parents.length > 1) return 'chore';
  const [header = ''] = String(message).split(/\r?\n/);
  const type = matchConventionalHeader(header)?.[1];
  return Object.hasOwn(COMMIT_TYPES, type) ? type : 'chore';
}

function colorSequence(color, background, depth) {
  const rgb = PALETTE[color];
  if (depth >= 24) return `${ESC}${background ? 48 : 38};2;${rgb.join(';')}m`;
  const [r, g, b] = rgb.map((value) => Math.round((value / 255) * 5));
  return `${ESC}${background ? 48 : 38};5;${16 + 36 * r + 6 * g + b}m`;
}

export function renderPetFrame({
  theme,
  width,
  depth = 24,
  time,
  completed = 0,
  total = 1,
  success = false,
  failed = false,
  commitType = 'chore',
  egg = 'none',
  successAge = 0,
  label = '正在检查',
}) {
  // 位置只随已完成阶段变化，等待时眨眼、摇尾；不根据耗时预测检查进度。
  const milestone = Math.min(
    7,
    Math.floor((completed / Math.max(1, total)) * 7),
  );
  const state = {
    index: milestone,
    completed: milestone,
    fraction: 1,
    finished: success,
    failed,
    waiting: !success && !failed,
    elapsed: success ? time - successAge : time,
  };
  const canvas = scenePixels(theme, state, width, time, {
    commitType,
    egg,
    successAge,
  });
  const rows = [];
  for (let y = 0; y < canvas.height; y += 2) {
    let line = '',
      previous = '';
    for (let x = 0; x < canvas.width; x += 1) {
      const foreground = canvas.pixels[y][x],
        background = canvas.pixels[y + 1][x];
      const colors = `${foreground}/${background}`;
      if (colors !== previous) {
        line +=
          colorSequence(foreground, false, depth) +
          colorSequence(background, true, depth);
        previous = colors;
      }
      line += '▀';
    }
    rows.push(`${line}${ESC}0m`);
  }
  // 标签全部来自固定的中文状态，不包含不可信的提交标题或第三方输出。
  rows.push(
    label,
    success
      ? 'Git 已创建提交'
      : failed
        ? '检查未通过，提交已阻止'
        : '检查完成后继续；尚未创建提交',
  );
  return rows;
}

export function createCommitAnimation(
  config,
  {
    stream = process.stdout,
    env = process.env,
    lifecycle = process,
    now = () => performance.now(),
    schedule = setInterval,
    unschedule = clearInterval,
  } = {},
) {
  let available = config.enabled && supportsCommitAnimation(stream, env);
  let timer = null,
    lines = 0,
    attached = false,
    blocked = false;
  let frame = {};
  let previousRows = [];
  const started = now();
  const signalHandlers = {
    SIGINT: () => interrupt('SIGINT'),
    SIGTERM: () => interrupt('SIGTERM'),
  };

  function write(text) {
    if (stream.destroyed || !stream.writable) {
      available = false;
      return;
    }
    try {
      blocked = !stream.write(text);
    } catch {
      available = false;
    }
  }
  function clear() {
    if (lines) {
      write(`${ESC}${lines}A\r${ESC}0J`);
      lines = 0;
    }
    previousRows = [];
  }
  function detach() {
    if (!attached) return;
    attached = false;
    stream.removeListener('resize', resize);
    stream.removeListener('error', outputError);
    stream.removeListener('drain', drain);
    lifecycle.removeListener('exit', close);
    for (const [signal, handler] of Object.entries(signalHandlers)) {
      lifecycle.removeListener(signal, handler);
    }
  }
  function pause() {
    if (timer !== null) unschedule(timer);
    timer = null;
    clear();
    if (attached) write(`${ESC}0m${ESC}?25h`);
  }
  function close() {
    pause();
    detach();
  }
  function interrupt(signal) {
    const handledElsewhere = lifecycle.listeners(signal)
      .some(handler => handler !== signalHandlers[signal]);
    available = false;
    close();
    // 优先保留 lint-staged 等现有取消处理；无其他处理器时恢复默认信号退出。
    if (!handledElsewhere) lifecycle.kill(lifecycle.pid, signal);
  }
  function resize() {
    // 折行后的旧帧行数不可再使用，避免光标回退覆盖历史日志。
    lines = 0;
    available = false;
    close();
  }
  function outputError() {
    available = false;
    lines = 0;
    close();
  }
  function drain() {
    blocked = false;
  }
  function draw() {
    if (!available || blocked) return;
    try {
      const rows = renderPetFrame({
        theme: config.theme,
        width: Math.min(108, stream.columns - 2),
        depth: stream.getColorDepth(),
        time: now() - started,
        ...frame,
        successAge: frame.success ? now() - frame.successStarted : 0,
      });
      if (rows.every((row, index) => row === previousRows[index])) return;
      if (lines) {
        const changes = rows.map((row, index) => (
          `${row === previousRows[index] ? '' : `${ESC}2K${row}\r`}${ESC}1B`
        )).join('');
        write(`${ESC}${lines}A\r${changes}`);
      } else {
        write(rows.map((row) => `${ESC}2K${row}\r\n`).join(''));
      }
      lines = rows.length;
      previousRows = rows;
    } catch {
      available = false;
      close();
    }
  }
  function start(next = {}) {
    if (!available) return;
    frame = next;
    if (!attached) {
      attached = true;
      stream.on('resize', resize);
      stream.on('error', outputError);
      stream.on('drain', drain);
      lifecycle.on('exit', close);
      for (const [signal, handler] of Object.entries(signalHandlers)) {
        lifecycle.prependListener(signal, handler);
      }
    }
    write(`${ESC}?25l`);
    draw();
    if (available && timer === null) {
      timer = schedule(draw, 50);
      timer.unref?.();
    }
  }
  function fail() {
    if (!available) return;
    start({ failed: true, label: '检查未通过 · 请查看下方完整问题报告' });
    // 保留停止后的角色，让后续报告从下一行开始；不再回退覆盖诊断。
    lines = 0;
    close();
    available = false;
  }
  async function celebrate(
    message = '',
    {
      random = Math.random,
      parents = [],
      previewEgg = 'auto',
      wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    } = {},
  ) {
    if (!available) return;
    const egg = Object.hasOwn(EGG_NAMES, previewEgg) ? previewEgg : selectEgg(random);
    start({
      success: true,
      successStarted: now(),
      egg,
      commitType: config.commitTypeProps ? commitPropType(message, parents) : 'chore',
      label:
        egg === 'none' ? '提交成功 · 已送达' : `提交成功 · ${EGG_NAMES[egg]}`,
    });
    try {
      await wait(egg === 'none' ? 750 : EGG_DURATION);
    } finally {
      close();
    }
  }
  return {
    get active() {
      return Boolean(available);
    },
    start,
    pause,
    close,
    fail,
    celebrate,
  };
}
