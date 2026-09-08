import { validateCommitAnimationConfiguration } from '../../config/commit-animation-validation.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { createCommitAnimation } from '../../core/report/commit-animation/presenter.js';
import {
  writeConsoleMessage,
  writeGateResultConsole,
} from '../../core/report/console-renderer.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { parseValuedOptions } from './argument-parsing.js';
import { COMMIT_TYPES, EGG_NAMES } from '../../core/report/commit-animation/surprises.js';

export async function runAnimationPreview(argumentsList) {
  const { flags, values } = parseValuedOptions(argumentsList, {
    flags: new Set(['--fail', '--plain']),
    values: new Set(['--theme', '--type', '--egg']),
  });
  const type = values['--type'] ?? 'feat';
  if (!Object.hasOwn(COMMIT_TYPES, type)) {
    throw configurationError(
      'animation/invalid-type',
      `--type 只能是 ${Object.keys(COMMIT_TYPES).join('、')}`,
    );
  }
  const previewEgg = values['--egg'] ?? 'auto';
  if (previewEgg !== 'auto' && !Object.hasOwn(EGG_NAMES, previewEgg)) {
    throw configurationError('animation/invalid-preview-egg', '--egg 只能是 auto、none、meteor、butterfly 或 fireworks');
  }
  const config = validateCommitAnimationConfiguration(
    {
      commitAnimation: {
        enabled: !flags.has('--plain'),
        theme: values['--theme'] ?? 'cat',
      },
    },
    '动画预览',
  );
  const animation = createCommitAnimation(config);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  writeConsoleMessage(
    '动画预览：模拟数据；没有执行检查，也不会创建 Git 提交。',
  );
  if (!animation.active) {
    writeConsoleMessage('当前使用文字预览：窗口、颜色、CI 或输出重定向条件不支持动画。');
  }
  try {
    if (animation.active) {
      for (let completed = 0; completed < 3; completed += 1) {
        animation.start({
          completed,
          total: 3,
          commitType: type,
          label: '模拟检查 · 角色与道具预览',
        });
        await wait(700);
      }
    }
    if (flags.has('--fail')) {
      animation.fail();
      animation.close();
      // 模拟违规使用与真实门禁相同的结构化报告渲染器。
      writeGateResultConsole(
        createGateResult({
          gateId: 'animation.preview',
          status: 'violation',
          summary: '路径命名不符合配置要求（模拟）',
          findings: [
            {
              severity: 'error',
              ruleId: 'path-naming',
              message: '示例文件名不符合小驼峰命名要求。',
              location: { path: 'src/components/user-profile.vue' },
              evidence: '当前文件名为 user-profile.vue（模拟）。',
              expected: '文件名采用 camelCase，例如 userProfile.vue。',
              remediation: {
                goal: '文件名和引用符合命名规则。',
                steps: ['将示例文件重命名为 userProfile.vue，并同步更新引用。'],
                constraints: ['不要为了提交而关闭命名规则。'],
                verification: ['重新暂存相关文件后再次提交。'],
              },
            },
          ],
        }),
        { label: '路径命名检查（模拟）' },
      );
      writeConsoleMessage('模拟提交已阻止；不会播放成功彩蛋。');
    } else {
      await animation.celebrate(`${type}: 预览`, { previewEgg });
      writeConsoleMessage('模拟提交成功。真实功能只在 post-commit 阶段庆祝。');
    }
    return 0;
  } finally {
    animation.close();
  }
}
