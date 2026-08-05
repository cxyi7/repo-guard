import { readFileSync } from 'node:fs';
import micromatch from 'micromatch';
import { collectStagedChanges } from './git-changes.js';
import { runGit } from './git.js';
import { normalizeStagedFiles } from './staged-files.js';

const DEFAULT_MODE = 'strict';
const DEFAULT_WARN_AT = 0.85;
const MATCH_OPTIONS = Object.freeze({
  dot: true,
});

export function countPhysicalLines(content) {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r\n|\n|\r/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function countSectionContentLines(content) {
  const lines = content.split(/\r\n|\n|\r/);
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines.at(-1).trim()) {
    lines.pop();
  }
  return lines.length;
}

export function analyzeVueSections(content) {
  const sections = { template: 0, script: 0, style: 0 };
  const blockPattern = /<(template|script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

  for (const match of content.matchAll(blockPattern)) {
    sections[match[1].toLowerCase()] += countSectionContentLines(match[2]);
  }

  return sections;
}

export function matchMaxFileLineRule(relativePath, config) {
  if (config.exclusions.some((pattern) => (
    micromatch.isMatch(relativePath, pattern, MATCH_OPTIONS)
  ))) {
    return null;
  }

  return config.rules.find(({ pattern }) => (
    micromatch.isMatch(relativePath, pattern, MATCH_OPTIONS)
  )) ?? null;
}

export function selectMaxFileLineFiles(files, config) {
  return files
    .filter(({ relative }) => matchMaxFileLineRule(relative, config))
    .map(({ absolute }) => absolute);
}

function readHeadContent(root, relativePath) {
  const result = runGit(['show', `HEAD:${relativePath}`], {
    allowFailure: true,
    cwd: root,
  });
  return result.status === 0 ? result.stdout : null;
}

function readBaseline(root, relativePath, stagedChanges) {
  const currentContent = readHeadContent(root, relativePath);
  if (currentContent != null) {
    return {
      lineCount: countPhysicalLines(currentContent),
      path: relativePath,
    };
  }

  const rename = stagedChanges.find((change) => (
    change.path === relativePath && change.oldPath
  ));
  if (!rename) {
    return null;
  }

  const renamedContent = readHeadContent(root, rename.oldPath);
  return renamedContent == null
    ? null
    : {
        lineCount: countPhysicalLines(renamedContent),
        path: rename.oldPath,
      };
}

function fileDetails(relative, content, rule) {
  return {
    path: relative,
    lineCount: countPhysicalLines(content),
    maxLines: rule.maxLines,
    pattern: rule.pattern,
    sections: relative.toLowerCase().endsWith('.vue')
      ? analyzeVueSections(content)
      : null,
  };
}

export function evaluateMaxFileLines({ root, files, config }) {
  const normalizedFiles = normalizeStagedFiles(root, files, 'Maximum file lines gate');
  const mode = config.mode ?? DEFAULT_MODE;
  const warnAt = config.warnAt ?? DEFAULT_WARN_AT;
  const violations = [];
  const warnings = [];
  let stagedChanges;

  for (const { absolute, relative } of normalizedFiles) {
    const rule = matchMaxFileLineRule(relative, config);
    if (!rule) {
      continue;
    }

    const content = readFileSync(absolute, 'utf8');
    const details = fileDetails(relative, content, rule);
    if (details.lineCount > rule.maxLines) {
      if (mode === 'noRegression') {
        stagedChanges ??= collectStagedChanges(root);
        const baseline = readBaseline(root, relative, stagedChanges);
        if (baseline && baseline.lineCount > rule.maxLines) {
          if (details.lineCount <= baseline.lineCount) {
            warnings.push({
              ...details,
              kind: 'legacy-over-limit',
              baselineLineCount: baseline.lineCount,
              baselinePath: baseline.path,
            });
            continue;
          }

          violations.push({
            ...details,
            mode,
            baselineLineCount: baseline.lineCount,
            baselinePath: baseline.path,
            passLineCount: baseline.lineCount,
          });
          continue;
        }
      }

      violations.push({ ...details, mode, passLineCount: rule.maxLines });
      continue;
    }

    const warningLineCount = Math.ceil(rule.maxLines * warnAt);
    if (details.lineCount >= warningLineCount) {
      warnings.push({
        ...details,
        kind: 'near-limit',
        warnAt,
        warningLineCount,
      });
    }
  }

  return { violations, warnings };
}

export function inspectMaxFileLines(options) {
  return evaluateMaxFileLines(options).violations;
}

function largestVueSection(sections) {
  if (!sections) {
    return null;
  }
  return Object.entries(sections)
    .sort((left, right) => right[1] - left[1])[0];
}

function vueSectionGuidance(sections) {
  const largest = largestVueSection(sections);
  if (!largest || largest[1] === 0) {
    return [];
  }

  const suggestions = {
    template: '优先把独立页面区域、弹窗、表单、表格或重复结构提取为职责清晰的子组件。',
    script: '优先提取 composable、服务调用、状态逻辑、表单规则、表格配置或独立业务流程。',
    style: '优先按子组件边界下沉样式，或提取可复用样式，同时保持 scoped 和选择器行为。',
  };
  return [
    `   Vue 区域：template ${sections.template} 行；script ${sections.script} 行；style ${sections.style} 行。`,
    `   优先方向：${largest[0]} 是当前最大的有效代码区域。${suggestions[largest[0]]}`,
  ];
}

function refactorGuidance(filePath) {
  if (filePath.toLowerCase().endsWith('.vue')) {
    return [
      '按职责提取子组件、composable、服务、常量或样式；避免只移动代码而不降低组件职责。',
      '保持现有 props、emits、slots、路由交互、响应式行为和 scoped 样式语义不变。',
    ];
  }

  return [
    '按单一职责拆分为命名清晰的模块，提取独立业务流程、工具函数、常量或数据访问逻辑。',
    '保持现有导出 API、调用顺序、副作用、错误处理、类型约束和运行结果不变。',
  ];
}

export function buildMaxFileLinesAiInstructions(violations) {
  const blocks = violations.map((violation, index) => {
    const {
      path,
      lineCount,
      maxLines,
      passLineCount = maxLines,
      baselineLineCount,
      sections,
    } = violation;
    const [splitGuidance, compatibilityGuidance] = refactorGuidance(path);
    const baselineGuidance = baselineLineCount == null
      ? []
      : [
          `   noRegression 基线：HEAD 中为 ${baselineLineCount} 行；本次不得超过 ${passLineCount} 行。`,
          `   长期目标：继续拆分至不超过配置限制 ${maxLines} 行。`,
        ];
    return [
      `${index + 1}. 请重构 ${path}，解决单文件行数超限问题。`,
      `   当前：${lineCount} 行；限制：${maxLines} 行；本次至少需要减少 ${lineCount - passLineCount} 行。`,
      ...baselineGuidance,
      ...vueSectionGuidance(sections),
      `   拆分要求：${splitGuidance}`,
      `   兼容要求：${compatibilityGuidance}`,
      '   修改范围：只修改完成本次重构所必需的文件，不处理无关问题。',
      '   禁止绕过：不要删除必要注释、压缩代码、合并可读语句、修改行数限制、关闭门禁、改扩展名或加入 exclusions。',
      '   验证要求：确认原有功能和界面不变，并运行项目已有的 lint、测试和构建命令。',
      '   完成后重新暂存所有相关文件并提交；新拆出的文件也必须满足行数限制。',
    ].join('\n');
  });

  return [
    '以下文件超过单文件行数限制，可按编号分别将完整指令复制给 AI 进行重构：',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

export function buildMaxFileLinesWarnings(warnings) {
  const lines = warnings.flatMap((warning, index) => {
    const sectionGuidance = vueSectionGuidance(warning.sections);
    if (warning.kind === 'legacy-over-limit') {
      const change = warning.baselineLineCount - warning.lineCount;
      return [
        `${index + 1}. ${warning.path} 仍有 ${warning.lineCount} 行，超过长期限制 ${warning.maxLines} 行。`,
        `   noRegression 基线为 ${warning.baselineLineCount} 行，本次${change > 0 ? `已减少 ${change} 行` : '没有增加行数'}，允许提交。`,
        ...sectionGuidance,
        '   后续让 AI 修改时应继续拆分，不能恢复已减少的行数或扩大文件职责。',
      ];
    }

    const percent = Math.round((warning.lineCount / warning.maxLines) * 100);
    return [
      `${index + 1}. ${warning.path} 当前 ${warning.lineCount}/${warning.maxLines} 行（${percent}%），剩余 ${warning.maxLines - warning.lineCount} 行。`,
      ...sectionGuidance,
      '   文件已接近限制；让 AI 增加功能时应优先提取模块，避免继续扩大当前文件。',
    ];
  });

  return [
    'Maximum file lines warning（不阻止提交）：',
    ...lines,
  ].join('\n');
}

export function runMaxFileLinesFiles({ root, files, config }) {
  const { violations, warnings } = evaluateMaxFileLines({ root, files, config });
  if (warnings.length > 0) {
    console.warn(buildMaxFileLinesWarnings(warnings));
  }
  if (violations.length === 0) {
    console.log(`Maximum file lines passed: ${files.length} staged file(s).`);
    return 0;
  }

  console.error(buildMaxFileLinesAiInstructions(violations));
  console.error(`共 ${violations.length} 个文件超限，提交已停止。`);
  return 1;
}
