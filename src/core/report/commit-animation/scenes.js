import { drawCargo, drawCelebration } from './surprises.js';
// 真正送入终端的像素数据。每两个纵向像素合成一个半方块字符。
export const PALETTE = {
  background: [12, 18, 25],
  dim: [29, 43, 57],
  muted: [66, 88, 107],
  mint: [130, 207, 180],
  cream: [255, 228, 181],
  cyan: [112, 218, 238],
  blue: [62, 106, 143],
  white: [229, 248, 247],
  amber: [237, 176, 98],
  brown: [156, 91, 47],
  pink: [237, 153, 158],
  red: [232, 126, 131],
  outline: [88, 57, 42],
  orange: [226, 146, 73],
  light: [246, 182, 105],
  shadow: [13, 24, 32],
  teal: [64, 163, 160],
  ink: [43, 38, 38],
  glow: [33, 72, 91],
  sky: [23, 35, 48],
  faint: [18, 28, 39],
};

function canvas(width) {
  const height = 28;
  const pixels = Array.from({ length: height }, () =>
    Array(width).fill('background'),
  );
  const set = (x, y, color) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height) pixels[y][x] = color;
  };
  const box = (x, y, w, h, color) => {
    for (let dy = 0; dy < h; dy += 1)
      for (let dx = 0; dx < w; dx += 1) set(x + dx, y + dy, color);
  };
  const line = (x0, y0, x1, y1, color, thickness = 1) => {
    const length = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= length; i += 1) {
      const part = length ? i / length : 0;
      box(
        Math.round(x0 + (x1 - x0) * part),
        Math.round(y0 + (y1 - y0) * part),
        thickness,
        thickness,
        color,
      );
    }
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y += 1) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x += 1) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, color);
      }
    }
  };
  const polygon = (points, color) => {
    const minX = Math.floor(Math.min(...points.map((p) => p[0]))),
      maxX = Math.ceil(Math.max(...points.map((p) => p[0])));
    const minY = Math.floor(Math.min(...points.map((p) => p[1]))),
      maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
    for (let y = minY; y <= maxY; y += 1)
      for (let x = minX; x <= maxX; x += 1) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i],
            [xj, yj] = points[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
            inside = !inside;
        }
        if (inside) set(x, y, color);
      }
  };
  return { width, height, pixels, set, box, line, ellipse, polygon };
}

const smooth = (value) => value * value * (3 - 2 * value);

export function catPose(state, time) {
  const travelling =
    !state.finished &&
    !state.failed &&
    (state.waiting || (state.index > 0 && state.fraction < 0.62));
  const amount = smooth(Math.min(1, state.fraction / 0.62));
  const station = state.finished ? 7 : Math.max(0, state.index - 1 + amount);
  const cycle = time / 115;
  const arrival = state.finished ? Math.max(0, time - state.elapsed) : 0;
  return {
    station,
    travelling,
    stride: travelling ? Math.sin(cycle) : 0,
    lift: travelling ? Math.max(0, Math.sin(cycle * 2)) : 0,
    blink: !travelling && !state.failed && Math.floor(time / 120) % 27 === 22,
    tail: Math.sin(time / (travelling ? 155 : 310)),
    jump:
      state.finished && arrival < 650
        ? Math.sin((arrival / 650) * Math.PI) * 3
        : 0,
  };
}

function drawCat(c, state, time, commitType) {
  const pose = catPose(state, time);
  const originX = Math.round(2 + (pose.station / 7) * (c.width - 43));
  const bob = Math.round(-pose.lift - pose.jump);
  const body = {
    ...c,
    set: (x, y, color) => c.set(originX + x, y + bob, color),
    box: (x, y, w, h, color) => c.box(originX + x, y + bob, w, h, color),
    line: (x0, y0, x1, y1, color, thickness) =>
      c.line(originX + x0, y0 + bob, originX + x1, y1 + bob, color, thickness),
    ellipse: (x, y, rx, ry, color) =>
      c.ellipse(originX + x, y + bob, rx, ry, color),
    polygon: (points, color) =>
      c.polygon(
        points.map(([x, y]) => [originX + x, y + bob]),
        color,
      ),
  };
  // 降低背景对比度，把注意力留给角色。
  c.line(2, 24, c.width - 3, 24, 'dim');
  for (let i = 0; i < 8; i += 1) {
    const x = 5 + Math.round((i * (c.width - 13)) / 7);
    c.box(
      x,
      26,
      3,
      1,
      i < state.completed ? 'mint' : i === state.index ? 'amber' : 'dim',
    );
  }
  c.line(c.width - 29, 4, c.width - 18, 4, 'sky');
  c.line(c.width - 26, 3, c.width - 21, 3, 'sky');
  // 用小巧的收件箱取代抢占画面的房子。
  const mailboxX = c.width - 9;
  c.box(mailboxX + 3, 18, 2, 6, 'muted');
  c.box(mailboxX, 12, 9, 7, 'blue');
  c.box(mailboxX + 1, 11, 7, 1, 'muted');
  c.box(mailboxX + 1, 14, 6, 1, 'background');
  c.set(mailboxX + 6, 17, state.finished ? 'mint' : 'amber');
  c.line(mailboxX + 8, 13, mailboxX + 8, 8, 'muted');
  c.box(mailboxX + 5, 8, 3, 2, state.finished ? 'mint' : 'pink');
  c.ellipse(originX + 18, 24, 12, 1, 'shadow');
  // 尾巴和远侧腿先绘制，避免四肢像贴在身体外面的方块。
  const tailTip = 4 + Math.round(pose.tail * 2);
  body.line(11, 19, 6, 17, 'outline', 3);
  body.line(6, 17, tailTip, 12, 'outline', 3);
  body.line(11, 19, 6, 17, 'orange', 2);
  body.line(6, 17, tailTip, 12, 'orange', 2);
  body.box(tailTip, 11, 2, 2, 'cream');
  const stride = Math.round(pose.stride * 2);
  body.line(14, 20, 14 - stride, 23, 'brown', 2);
  body.line(23, 20, 23 + stride, 23, 'brown', 2);
  body.ellipse(18, 18, 10, 5, 'outline');
  body.ellipse(18, 17, 9, 4, 'orange');
  body.ellipse(23, 19, 4, 3, 'cream');
  body.line(12, 21, 12 + stride, 23 - Math.round(pose.lift), 'light', 2);
  body.line(25, 20, 25 - stride, 23, 'light', 2);
  body.box(12 + stride, 23 - Math.round(pose.lift), 3, 1, 'cream');
  body.box(24 - stride, 23, 3, 1, 'cream');
  body.line(13, 15, 14, 17, 'brown');
  body.line(16, 14, 17, 16, 'brown');
  // 圆脸、三角耳和浅色口鼻是识别小猫的主要轮廓。
  body.ellipse(24, 10, 8, 7, 'outline');
  body.polygon(
    [
      [16, 8],
      [17, 1],
      [23, 5],
    ],
    'outline',
  );
  body.polygon(
    [
      [25, 5],
      [30, 1],
      [32, 9],
    ],
    'outline',
  );
  body.polygon(
    [
      [18, 7],
      [18, 3],
      [22, 6],
    ],
    'pink',
  );
  body.polygon(
    [
      [27, 6],
      [29, 3],
      [30, 8],
    ],
    'pink',
  );
  body.ellipse(24, 10, 7, 6, 'light');
  body.ellipse(24, 13, 5, 3, 'cream');
  body.line(22, 5, 22, 7, 'brown');
  body.line(25, 5, 25, 7, 'brown');
  body.box(19, 10, 2, pose.blink ? 1 : 2, 'ink');
  body.box(27, 10, 2, pose.blink ? 1 : 2, 'ink');
  if (!pose.blink) {
    body.set(19, 10, 'white');
    body.set(27, 10, 'white');
  }
  body.set(24, 12, 'pink');
  body.set(24, 13, 'brown');
  body.set(23, 14, 'brown');
  body.set(25, 14, 'brown');
  body.line(16, 12, 18, 13, 'cream');
  body.line(30, 13, 32, 12, 'cream');
  body.box(19, 17, 10, 2, 'teal');
  body.box(19, 17, 2, 1, 'cyan');
  body.line(19, 18, 16, 19 + Math.round(pose.tail), 'teal', 2);
  if (!state.finished) drawCargo(body, 9, 10, commitType);
  else {
    // 到达后包裹留在收件箱，角色轻跳一次，头顶出现爱心。
    drawCargo(c, mailboxX - 2, 18, commitType);
    const heartY = Math.max(0, 2 - Math.floor((time - state.elapsed) / 700));
    const hx = originX + 10;
    c.set(hx, heartY, 'pink');
    c.set(hx + 2, heartY, 'pink');
    c.box(hx, heartY + 1, 3, 1, 'pink');
    c.set(hx + 1, heartY + 2, 'pink');
  }
  if (state.failed) {
    body.box(9, 3, 3, 4, 'red');
    body.set(10, 8, 'red');
  } else if (state.index > 0 && state.fraction < 0.22 && !state.finished) {
    const sx = originX - 1;
    c.set(sx, 18, 'mint');
    c.set(sx - 1, 19, 'mint');
    c.set(sx + 1, 19, 'mint');
    c.set(sx, 20, 'mint');
  }
}

function drawDog(c, state, time, commitType) {
  const pose = catPose(state, time);
  const x = Math.round(2 + (pose.station / 7) * (c.width - 43));
  const bob = Math.round(-pose.lift - pose.jump);
  const set = (px, py, color) => c.set(x + px, py + bob, color);
  const box = (px, py, w, h, color) => c.box(x + px, py + bob, w, h, color);
  const line = (x0, y0, x1, y1, color, size) =>
    c.line(x + x0, y0 + bob, x + x1, y1 + bob, color, size);
  const ellipse = (px, py, rx, ry, color) =>
    c.ellipse(x + px, py + bob, rx, ry, color);
  c.line(2, 24, c.width - 3, 24, 'dim');
  for (let i = 0; i < 8; i += 1) {
    c.box(
      5 + Math.round((i * (c.width - 13)) / 7),
      26,
      3,
      1,
      i < state.completed ? 'mint' : i === state.index ? 'amber' : 'dim',
    );
  }
  const mailboxX = c.width - 9;
  c.box(mailboxX + 3, 18, 2, 6, 'muted');
  c.box(mailboxX, 12, 9, 7, 'blue');
  c.box(mailboxX + 1, 11, 7, 1, 'muted');
  c.box(mailboxX + 1, 14, 6, 1, 'background');
  c.line(mailboxX + 8, 13, mailboxX + 8, 8, 'muted');
  c.box(mailboxX + 5, 8, 3, 2, state.finished ? 'mint' : 'amber');
  c.ellipse(x + 18, 24, 12, 1, 'shadow');
  // 小狗有更快的摇尾和随步伐摆动的垂耳，轮廓与小猫独立绘制。
  const wag = Math.sin(time / 95);
  const tailX = 5 + Math.round(wag * 2),
    tailY = 12 + Math.round(wag * 2);
  line(12, 19, 7, 17, 'outline', 3);
  line(7, 17, tailX, tailY, 'outline', 3);
  line(12, 19, 7, 17, 'light', 2);
  line(7, 17, tailX, tailY, 'light', 2);
  box(tailX, tailY, 2, 2, 'cream');
  const stride = Math.round(pose.stride * 2);
  line(13, 19, 13 - stride, 23, 'brown', 2);
  line(23, 19, 23 + stride, 23, 'brown', 2);
  ellipse(17, 18, 10, 5, 'outline');
  ellipse(17, 17, 9, 4, 'light');
  ellipse(13, 17, 4, 3, 'orange');
  ellipse(24, 19, 4, 3, 'cream');
  line(11, 20, 11 + stride, 23 - Math.round(pose.lift), 'light', 2);
  line(25, 20, 25 - stride, state.finished ? 20 : 23, 'cream', 2);
  box(10 + stride, 23 - Math.round(pose.lift), 4, 1, 'cream');
  box(24 - stride, state.finished ? 20 : 23, 4, 1, 'cream');
  // 圆头、长耳、突出的浅色口鼻和黑鼻子，避免像换色的小猫。
  ellipse(24, 10, 8, 8, 'outline');
  ellipse(24, 10, 7, 7, 'light');
  ellipse(24, 8, 2, 5, 'cream');
  const earSwing = pose.travelling ? Math.round(pose.stride) : 0;
  ellipse(17 - earSwing, 10, 3, 7, 'outline');
  ellipse(17 - earSwing, 10, 2, 6, 'brown');
  ellipse(31 + earSwing, 10, 3, 7, 'outline');
  ellipse(31 + earSwing, 10, 2, 6, 'brown');
  line(16 - earSwing, 6, 16 - earSwing, 11, 'orange');
  line(30 + earSwing, 6, 30 + earSwing, 11, 'orange');
  ellipse(24, 13, 5, 3, 'cream');
  box(20, 9, 2, pose.blink ? 1 : 2, 'ink');
  box(27, 9, 2, pose.blink ? 1 : 2, 'ink');
  if (!pose.blink) {
    set(20, 9, 'white');
    set(27, 9, 'white');
  }
  box(23, 11, 3, 2, 'ink');
  set(23, 11, 'muted');
  set(24, 13, 'ink');
  line(22, 14, 26, 14, 'brown');
  if (!state.failed) {
    box(24, 14, 2, 2, 'pink');
    set(24, 15, 'red');
  }
  box(20, 17, 9, 2, 'blue');
  box(20, 17, 3, 1, 'cyan');
  box(24, 19, 2, 2, 'amber');
  if (!state.finished) drawCargo({ box }, 8, 10, commitType);
  else {
    drawCargo(c, mailboxX - 2, 18, commitType);
    const heartY = Math.max(0, 2 - Math.floor((time - state.elapsed) / 700));
    set(10, heartY, 'pink');
    set(12, heartY, 'pink');
    box(10, heartY + 1, 3, 1, 'pink');
    set(11, heartY + 2, 'pink');
  }
  if (state.failed) {
    box(10, 3, 2, 4, 'red');
    set(10, 8, 'red');
  }
}

export function scenePixels(
  theme,
  state,
  width,
  time = state.elapsed,
  options = {},
) {
  const result = canvas(Math.max(48, Math.min(108, width)));
  const animationTime = state.failed ? state.elapsed : time;
  if (theme === 'cat')
    drawCat(result, state, animationTime, options.commitType);
  else if (theme === 'dog')
    drawDog(result, state, animationTime, options.commitType);

  if (state.finished && !state.failed)
    drawCelebration(
      result,
      options.egg || 'none',
      options.successAge ?? Math.max(0, time - state.elapsed),
    );
  return result;
}
