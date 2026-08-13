import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import {
  findVueTemplateAttributes,
  sourceLocation,
} from './vue-template-parser.js';

export const VUE_NO_V_HTML_RULE = 'vue/no-v-html';

export function findVueVHtml(source, relativePath = 'component.vue') {
  return findVueTemplateAttributes(source)
    .filter(({ name }) => (
      name === 'v-html'
      || name.startsWith('v-html:')
      || name.startsWith('v-html.')
    ))
    .map(({ offset }) => ({
      ...sourceLocation(source, offset),
      offset,
      path: relativePath,
      rule: VUE_NO_V_HTML_RULE,
    }));
}

function normalizeFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replace(/\\/g, '/'),
    };
  });
}

export function inspectUnsafeVueHtml({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    if (!file.relative.toLowerCase().endsWith('.vue')) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findVueVHtml(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}

export function buildUnsafeVueHtmlAiInstructions(violations) {
  const lines = ['Vue v-html 安全门禁失败，可将以下指令分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
    lines.push(
      '',
      `${index + 1}. 请移除 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的 v-html。`,
      `   规则：${violation.rule}`,
      '   修复要求：优先使用 Vue 模板、组件、插值或 textContent，以结构化方式渲染内容。',
      '   富文本要求：如果业务确实需要 HTML，必须先建立可信来源和严格消毒边界，并由有权人员审查风险。',
      '   禁止绕过：AI 不得新增、延期或修改结构化例外，不得关闭门禁、改扩展名或使用等价动态 HTML 注入方式。',
      '   验证要求：确认页面展示、交互和可访问性保持正确，并运行项目已有的 lint、测试和构建命令。',
    );
  });
  lines.push('', `共 ${violations.length} 处未经批准的 v-html，提交已停止。`);
  return lines.join('\n');
}
