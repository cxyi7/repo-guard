import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import {
  findVueTemplateElements,
  sourceLocation,
} from './vue-template-parser.js';

export const VUE_IMAGE_ALT_RULE = 'vue/img-alt';
const DECORATIVE_ROLES = new Set(['none', 'presentation']);
const GENERIC_ALT_TEXT = new Set([
  'graphic',
  'icon',
  'image',
  'img',
  'photo',
  'picture',
  '图',
  '图像',
  '图片',
  '图标',
  '照片',
]);
const IMAGE_FILE_NAME = /^[^/\\]+\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const HTML_WHITESPACE_REFERENCE = /&(?:nbsp|#0*160|#x0*a0|#0*32|#x0*20);/gi;

function isBinding(name, attribute) {
  return name === `:${attribute}`
    || name === `v-bind:${attribute}`
    || name.startsWith(`:${attribute}.`)
    || name.startsWith(`v-bind:${attribute}.`);
}

function expressionLiteral(value) {
  const text = value?.trim();
  if (!text || text.length < 2) return null;
  const quote = text[0];
  if ((quote !== '"' && quote !== "'" && quote !== '`') || text.at(-1) !== quote) {
    return null;
  }
  if (quote === '`' && text.includes('${')) return null;
  return text.slice(1, -1);
}

function matchingAttributes(element, name) {
  return element.attributes.filter((candidate) => (
    candidate.name === name || isBinding(candidate.name, name)
  ));
}

function resolvedAttribute(element, name) {
  const [attribute] = matchingAttributes(element, name);
  if (!attribute) return null;
  if (attribute.name === name) {
    return { attribute, kind: 'static', value: attribute.value ?? '' };
  }
  const value = expressionLiteral(attribute.value);
  return value == null
    ? { attribute, kind: 'dynamic', value: null }
    : { attribute, kind: 'bound-literal', value };
}

function invalidStatus(code, reason, repair) {
  return { code, reason, repair, valid: false };
}

function imageAltStatus(element) {
  const spread = element.attributes.find((attribute) => (
    attribute.name === 'v-bind' || attribute.name.startsWith('v-bind.')
  ));
  if (spread) {
    return invalidStatus(
      'dynamic-attribute-spread',
      '原生 <img> 使用无参数 v-bind 批量绑定对象，运行时对象可能提供或覆盖 alt 与 role，门禁无法证明最终图片语义',
      '将 alt 和 role 从批量绑定对象中拆出并显式写在 <img> 上；内容图片使用准确的静态非空 alt，装饰图片使用 alt="" 与静态 none/presentation 角色。其他确需透传的属性可以继续单独绑定',
    );
  }
  if (matchingAttributes(element, 'alt').length > 1) {
    return invalidStatus(
      'duplicate-alt',
      '原生 <img> 重复声明 alt 或其绑定形式，不同编译与运行顺序可能覆盖替代文本，门禁无法确定最终生效值',
      '删除重复声明，只保留一个语义准确、可静态验证的 alt；不要同时保留静态 alt、:alt 或 v-bind:alt',
    );
  }
  if (matchingAttributes(element, 'role').length > 1) {
    return invalidStatus(
      'duplicate-role',
      '原生 <img> 重复声明 role 或其绑定形式，门禁无法确定最终是否会被辅助技术当作装饰图片忽略',
      '删除重复声明并保留唯一、静态且符合图片用途的 role；内容图片通常不需要 none/presentation，装饰图片使用唯一的静态 none/presentation 角色',
    );
  }

  const alt = resolvedAttribute(element, 'alt');
  const role = resolvedAttribute(element, 'role');
  const roleValue = role?.value?.trim().toLowerCase() || '';
  const decorativeRole = DECORATIVE_ROLES.has(roleValue);

  if (!alt) {
    return invalidStatus(
      'missing-alt',
      '原生 <img> 缺少 alt 属性；图片加载失败或由屏幕阅读器访问时，用户无法获得等价信息，也无法判断图片是否只是装饰',
      '若图片承载内容，添加准确描述其信息或用途的非空 alt；若图片纯属装饰，显式使用 alt="" 并添加 role="presentation" 或 role="none"',
    );
  }
  if (alt.kind === 'dynamic') {
    return invalidStatus(
      'dynamic-alt',
      'alt 使用动态表达式，门禁无法证明它在加载、空数据、异常数据等所有运行状态下都为非空且准确的替代文本',
      '将 alt 改为准确的静态文本或可静态解析的绑定字面量，例如 :alt="\'用户头像\'"；如果确实必须由运行时数据决定，应在生成数据处保证语义并由负责人登记精确、限期的结构化例外',
    );
  }

  const altValue = alt.value.trim();
  if (
    altValue.length > 0
    && altValue.replace(HTML_WHITESPACE_REFERENCE, '').trim().length === 0
  ) {
    return invalidStatus(
      'meaningless-alt',
      `alt="${altValue}" 只包含空白字符引用，不能向用户传达图片的内容或功能`,
      '改用简洁、准确的自然语言描述图片在当前页面中的内容或操作目的；若图片纯属装饰，则使用真正的空 alt="" 与静态 none/presentation 角色',
    );
  }
  if (altValue.length === 0) {
    if (role?.kind === 'dynamic') {
      return invalidStatus(
        'dynamic-decorative-role',
        '图片使用空 alt，但 role 是动态表达式；门禁无法证明该图片始终以 none 或 presentation 的装饰语义呈现',
        '若图片确为装饰，将 role 改为静态 role="presentation" 或 role="none" 并保留 alt=""；若图片承载信息，则移除装饰角色并填写准确的非空 alt',
      );
    }
    if (decorativeRole) return { valid: true };
    return invalidStatus(
      'unmarked-decorative-image',
      '图片使用空 alt，却没有用 role="presentation" 或 role="none" 明确声明其为装饰图片，门禁无法区分遗漏说明与有意隐藏',
      '若图片纯属装饰，保留 alt="" 并添加静态 role="presentation" 或 role="none"；若图片传递内容、状态或操作含义，则填写准确的非空 alt',
    );
  }

  if (role?.kind === 'dynamic') {
    return invalidStatus(
      'dynamic-image-role',
      '内容图片具有非空 alt，但 role 使用动态表达式；运行时 role 可能变为 none 或 presentation，从而让辅助技术忽略本应读取的替代文本',
      '移除不必要的动态 role，或将其改为不会隐藏内容图片的静态语义；若图片实际为装饰，则改用 alt="" 和静态 role="none" 或 role="presentation"',
    );
  }

  if (decorativeRole) {
    return invalidStatus(
      'conflicting-decorative-role',
      `图片同时使用非空 alt="${altValue}" 和 role="${roleValue}"；替代文本表示图片承载信息，而装饰角色要求辅助技术忽略图片，两种语义互相冲突`,
      '内容图片应保留准确的非空 alt 并移除 none/presentation 角色；纯装饰图片应保留装饰角色并把 alt 设为空字符串',
    );
  }

  if (GENERIC_ALT_TEXT.has(altValue.toLowerCase())) {
    return invalidStatus(
      'generic-alt',
      `alt="${altValue}" 只是“图片/图像/icon/image”等泛化占位词，没有传达该图片的实际内容或用途`,
      '根据当前业务上下文改写为简洁、具体且不重复相邻文本的说明；例如操作图标应描述操作目的，内容图片应描述其关键信息',
    );
  }

  if (IMAGE_FILE_NAME.test(altValue)) {
    return invalidStatus(
      'filename-alt',
      `alt="${altValue}" 只是图片文件名，文件名通常不能向用户说明图片展示的内容、状态或操作目的`,
      '用面向用户的自然语言描述替换文件名；如果图片不传递任何信息，则改用 alt="" 和静态装饰角色',
    );
  }

  return { valid: true };
}

export function findVueImageAltIssues(source, relativePath = 'component.vue') {
  return findVueTemplateElements(source)
    .filter((element) => element.name === 'img')
    .flatMap((element) => {
      const status = imageAltStatus(element);
      if (status.valid) return [];
      return [{
        ...sourceLocation(source, element.start + 1),
        offset: element.start + 1,
        path: relativePath,
        issue: status.code,
        reason: status.reason,
        repair: status.repair,
        rule: VUE_IMAGE_ALT_RULE,
        tagName: element.name,
      }];
    });
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

export function inspectVueImageAlts({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    if (!file.relative.toLowerCase().endsWith('.vue')) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findVueImageAltIssues(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}

export function buildVueImageAltAiInstructions(violations) {
  const lines = ['Vue 图片 alt 门禁失败，可将以下指令分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
    lines.push(
      '',
      `${index + 1}. 请修复 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的 <img>。`,
      `   规则：${violation.rule}`,
      `   原因：${violation.reason}。`,
      `   针对性修复：${violation.repair}。`,
      '   语义要求：alt 应表达图片在当前页面中的信息或功能，而不是机械复述“图片”；装饰图片必须同时具有 alt="" 和静态 none/presentation 角色。',
      '   兼容要求：保留原有 src、srcset、sizes、懒加载、尺寸、样式、事件、路由和布局行为；只修改建立正确图片替代语义所必需的模板及相关测试。',
      '   禁止绕过：不得用 title、aria-label、文件名、泛化占位词或无法静态验证的动态绑定冒充合适 alt，不得关闭门禁或自行新增、延期、修改结构化例外。',
      '   验证要求：确认图片正常与加载失败时语义都正确，屏幕阅读器能读出内容图片用途并忽略装饰图片；再运行项目已有的 lint、Vue 组件测试和构建命令。',
    );
  });
  lines.push('', `共 ${violations.length} 个图片 alt 问题，提交已停止。`);
  return lines.join('\n');
}
