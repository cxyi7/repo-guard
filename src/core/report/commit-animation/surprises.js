export const COMMIT_TYPES = Object.freeze({
  feat: '新功能 · 礼盒',
  fix: '修复 · 工具箱',
  docs: '文档 · 书本',
  style: '格式 · 小画笔',
  refactor: '重构 · 拼图',
  perf: '性能 · 小火箭',
  test: '测试 · 放大镜',
  build: '构建 · 积木',
  ci: '持续集成 · 小齿轮',
  chore: '维护 · 普通包裹',
});
export const EGG_NAMES = {
  none: '无',
  meteor: '流星来信',
  butterfly: '蝴蝶来访',
  fireworks: '小小烟花',
};
export const EGG_DURATION = 3200;
const EGG_CHANCE = 0.1;

// 由成功事件调用一次；绘制函数不负责抽签。
export function selectEgg(random = Math.random) {
  if (random() >= EGG_CHANCE) return 'none';
  const choices = ['meteor', 'butterfly', 'fireworks'];
  return choices[Math.floor(random() * choices.length)];
}

// 8 × 10 像素道具，透明背景；角色背负和成功送达使用同一份图案。
const CARGO_SPRITES = Object.freeze({
  style: ['......pp', '.....ppp', '....wpp.', '...ww...', '..oo....', '..aa....', '.aa.....', '.aa.....', 'aa......', 'o.......'],
  refactor: ['..tt....', 'tttttp..', 'tttppppp', 'tttttppp', '.ttppppp', '.tttppp.', 'ttttpppp', 'ttttpppp', '..tt.pp.', '........'],
  perf: ['...pp...', '..pwwp..', '..wwww..', '..wbww..', '..wbbw..', '.bwwwwb.', 'bbwwwwbb', '..oooo..', '..aaaa..', '...aa...'],
  test: ['..tttt..', '.tw..wt.', 'tw....wt', 't......t', 't......t', 'tw....wt', '.tw..wt.', '..ttttoo', '......aa', '.......a'],
  build: ['.aa.....', 'aaaaa...', 'awaaa...', 'aaaaa...', '.....tt.', '....tttt', '....twtt', '.bb.tttt', 'bbbbtttt', 'bwbbtttt'],
  ci: ['..oo....', '..bb....', 'oobbbboo', 'bbowwobb', '.bw..wb.', '.bw..wb.', 'bbowwobb', 'oobbbboo', '..bb....', '..oo....'],
});
const CARGO_COLORS = Object.freeze({ o: 'outline', w: 'cream', a: 'amber', t: 'teal', b: 'blue', p: 'pink' });

export function drawCargo(c, x, y, type = 'chore') {
  if (Object.hasOwn(CARGO_SPRITES, type)) {
    CARGO_SPRITES[type].forEach((row, dy) => {
      [...row].forEach((pixel, dx) => {
        if (pixel !== '.') c.box(x + dx, y - 4 + dy, 1, 1, CARGO_COLORS[pixel]);
      });
    });
  } else if (type === 'feat') {
    c.box(x, y, 8, 6, 'outline');
    c.box(x + 1, y + 1, 6, 4, 'pink');
    c.box(x, y, 8, 1, 'red');
    c.box(x + 3, y, 2, 6, 'cream');
    c.box(x + 1, y - 2, 2, 2, 'cream');
    c.box(x + 5, y - 2, 2, 2, 'cream');
  } else if (type === 'fix') {
    c.box(x + 2, y - 2, 4, 2, 'muted');
    c.box(x + 3, y - 1, 2, 1, 'background');
    c.box(x, y, 8, 6, 'outline');
    c.box(x + 1, y + 1, 6, 4, 'blue');
    c.box(x + 1, y + 2, 6, 1, 'cyan');
    c.box(x + 3, y + 1, 2, 2, 'cream');
    // 顶部伸出扳手，黑白模式下也能分辨道具。
    c.box(x + 6, y - 3, 1, 3, 'white');
    c.box(x + 5, y - 4, 1, 2, 'white');
    c.box(x + 7, y - 4, 1, 2, 'white');
  } else if (type === 'docs') {
    c.box(x, y - 2, 2, 8, 'teal');
    c.box(x + 2, y - 1, 3, 7, 'cream');
    c.box(x + 5, y, 3, 6, 'blue');
    c.box(x + 1, y - 1, 1, 1, 'white');
    c.box(x + 3, y, 1, 4, 'amber');
    c.box(x + 6, y + 1, 1, 1, 'white');
    c.box(x, y + 5, 8, 1, 'brown');
  } else {
    c.box(x, y, 8, 6, 'outline');
    c.box(x + 1, y + 1, 6, 4, 'amber');
    c.box(x + 3, y + 1, 2, 2, 'cream');
    c.box(x + 5, y + 3, 2, 1, 'brown');
  }
}

function spark(c, x, y, color) {
  c.set(x, y, 'white');
  c.set(x - 1, y, color);
  c.set(x + 1, y, color);
  c.set(x, y - 1, color);
  c.set(x, y + 1, color);
}

export function drawCelebration(c, kind, age) {
  if (kind === 'none' || age < 0 || age >= EGG_DURATION) return;
  // 动物到达后位于右侧；彩蛋留在左侧天空，不覆盖状态和错误说明。
  const skyWidth = Math.max(12, c.width - 43);
  if (kind === 'meteor') {
    for (let star = 0; star < 3; star += 1) {
      const phase = (age - star * 750) / 1100;
      if (phase < 0 || phase > 1) continue;
      const x = Math.round(3 + phase * (skyWidth - 6)),
        y = Math.round(2 + phase * 11);
      for (let tail = 6; tail >= 1; tail -= 1)
        c.set(x - tail, y - Math.floor(tail / 2), tail > 3 ? 'blue' : 'cyan');
      spark(c, x, y, 'cyan');
    }
  } else if (kind === 'butterfly') {
    const part = Math.min(1, age / 2200);
    const x = Math.round(4 + part * (skyWidth - 9));
    const y = Math.round(9 + Math.sin(age / 300) * 3);
    const open = Math.floor(age / 110) % 2 === 0;
    c.box(x, y - 1, 1, 4, 'cream');
    c.set(x - 1, y - 2, 'cream');
    c.set(x + 1, y - 2, 'cream');
    c.ellipse(x - (open ? 2 : 1), y, open ? 2 : 1, 2, 'pink');
    c.ellipse(x + (open ? 2 : 1), y, open ? 2 : 1, 2, 'cyan');
    c.set(x, y, 'outline');
    c.set(x, y + 1, 'outline');
    c.set(x - 1, y + 2, 'red');
    c.set(x + 1, y + 2, 'teal');
  } else if (kind === 'fireworks') {
    for (let burst = 0; burst < 3; burst += 1) {
      const t = (age - burst * 780) / 1100;
      if (t < 0 || t > 1) continue;
      const x = 5 + ((burst + 1) / 4) * (skyWidth - 8),
        y = [9, 6, 12][burst];
      const color = ['mint', 'pink', 'cyan'][burst];
      if (t < 0.2) {
        c.line(x, 21, x, 21 - (t / 0.2) * (21 - y), color);
        continue;
      }
      const radius = ((t - 0.2) / 0.8) * Math.min(8, skyWidth / 3);
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = (ray * Math.PI) / 4;
        c.set(
          x + Math.cos(angle) * radius,
          y + Math.sin(angle) * radius + t * 2,
          t < 0.75 ? color : 'muted',
        );
      }
      if (t < 0.4) spark(c, x, y, color);
    }
  }
}
